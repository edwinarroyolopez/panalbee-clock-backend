import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { CustomerSearchPage } from '../src/customers/customer-search.dto';
import { INDEX_NAMES } from '../src/database/models';
import { hashPassword } from '../src/auth/password';
import {
  createCoreTestApplication,
  CoreTestApplication,
} from './core-test-app';
import {
  login,
  seedTenant,
  testPassword,
} from './booking-availability-test-app';

const tenant = {
  tenant: randomUUID(),
  location: randomUUID(),
  service: randomUUID(),
  staff: randomUUID(),
  customer: randomUUID(),
  owner: randomUUID(),
  slug: 'experience-search',
  email: 'search-owner@example.test',
  phone: '+12025550191',
};
const foreign = {
  tenant: randomUUID(),
  location: randomUUID(),
  service: randomUUID(),
  staff: randomUUID(),
  customer: randomUUID(),
  owner: randomUUID(),
  slug: 'experience-foreign',
  email: 'search-foreign@example.test',
  phone: '+12025550192',
};

describe('experience-v2 operational customer search (Mongo security)', () => {
  let app: CoreTestApplication;
  let token: string;
  const path = '/api/v1/customers/search';
  const special = randomUUID();
  beforeAll(async () => {
    app = await createCoreTestApplication();
    await seedTenant(app.database, tenant);
    await seedTenant(app.database, foreign);
    await app.database.models.customer.insertMany(
      Array.from({ length: 250 }, (_, index) => ({
        tenantId: tenant.tenant,
        fullName: `Synthetic customer ${index.toString().padStart(3, '0')}`,
        notes: 'Operational note never included in search results',
      })),
    );
    await app.database.models.customer.create({
      _id: special,
      tenantId: tenant.tenant,
      fullName: 'Literal [.*] Customer',
      phone: '+12025550999',
    });
    token = await login(app.server, tenant.email);
  });
  afterAll(async () => app.app.close());

  async function search(
    body: object,
    bearer = token,
  ): Promise<CustomerSearchPage> {
    const response = await request(app.server)
      .post(path)
      .auth(bearer, { type: 'bearer' })
      .send(body)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    return response.body as CustomerSearchPage;
  }

  it('walks all 252 records deterministically without duplicates, foreign data or financial fields', async () => {
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await search({ limit: 50, ...(cursor ? { cursor } : {}) });
      expect(page.items.length).toBeLessThanOrEqual(50);
      for (const item of page.items) {
        expect(Object.keys(item).sort()).toEqual([
          'email',
          'fullName',
          'id',
          'phone',
        ]);
        expect(item.id).not.toBe(foreign.customer);
        found.push(item.id);
      }
      expect(page.pageInfo.hasMore).toBe(page.pageInfo.nextCursor !== null);
      cursor = page.pageInfo.nextCursor;
    } while (cursor);
    expect(found).toHaveLength(252);
    expect(new Set(found).size).toBe(252);
    expect(found).toEqual([...found].sort());
    const indexes = await app.database.models.customer.collection.indexes();
    expect(
      indexes.find((index) => index.name === INDEX_NAMES.customerCursor)?.key,
    ).toEqual({ tenantId: 1, _id: 1 });
  });

  it('searches beyond the first page and treats regular-expression operators literally', async () => {
    const first = await search({ limit: 1 });
    const later = await app.database.models.customer
      .findOne({
        tenantId: tenant.tenant,
        _id: { $gt: first.items[0].id },
        fullName: /^Synthetic/,
      })
      .lean();
    const result = await search({
      query: `  ${later!.fullName.toLowerCase()}  `,
    });
    expect(result.items.map((item) => item.id)).toEqual([later!._id]);
    expect(
      (await search({ query: '[.*]' })).items.map((item) => item.id),
    ).toEqual([special]);
    expect(
      (await search({ query: '+12025550999' })).items.map((item) => item.id),
    ).toEqual([special]);
    expect((await search({ query: foreign.phone })).items).toEqual([]);
    expect((await search({ query: 'does not exist' })).pageInfo).toEqual({
      hasMore: false,
      nextCursor: null,
    });
  });

  it('rejects unauthorized, malformed and authority-bearing search bodies', async () => {
    await request(app.server).post(path).send({}).expect(401);
    for (const body of [
      { tenantId: foreign.tenant },
      { limit: 51 },
      { limit: 0 },
      { limit: 1.5 },
      { query: 'a'.repeat(121) },
      { query: { $ne: null } },
      { cursor: 'invalid' },
      { cursor: { $gt: '' } },
      { sort: 'balance' },
    ]) {
      await request(app.server)
        .post(path)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(400);
    }
  });

  it.each(['MANAGER', 'AGENT', 'STAFF'] as const)(
    'allows current operational reads to %s without expanding financial access',
    async (role) => {
      await app.database.models.tenantMembership.updateOne(
        { tenantId: tenant.tenant, userId: tenant.owner },
        { role },
      );
      const roleToken = await login(app.server, tenant.email);
      expect((await search({ query: '[.*]' }, roleToken)).items[0].id).toBe(
        special,
      );
      if (role !== 'MANAGER') {
        await request(app.server)
          .get(`/api/v1/customers/${special}/affiliate`)
          .auth(roleToken, { type: 'bearer' })
          .expect(403);
      }
      if (role === 'STAFF') {
        await request(app.server)
          .post('/api/v1/customers')
          .auth(roleToken, { type: 'bearer' })
          .send({ fullName: 'Forbidden creation' })
          .expect(403);
      }
      await app.database.models.tenantMembership.updateOne(
        { tenantId: tenant.tenant, userId: tenant.owner },
        { role: 'OWNER' },
      );
    },
  );

  it('permits explicit delegated reads, denies direct platform access and excludes search text from audit', async () => {
    const admin = await app.database.models.user.create({
      email: 'search-platform@example.test',
      displayName: 'Synthetic operator',
      passwordHash: await hashPassword(testPassword),
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_ADMIN',
    });
    const account = await app.database.models.account.create({
      tenantId: tenant.tenant,
      slug: tenant.slug,
      businessName: 'Synthetic search business',
      status: 'ACTIVE',
      ownerUserId: tenant.owner,
      phone: tenant.phone,
      publicBookingEnabled: true,
    });
    const adminToken = await login(app.server, 'search-platform@example.test');
    await request(app.server)
      .post(path)
      .auth(adminToken, { type: 'bearer' })
      .send({})
      .expect(403);
    const start = await request(app.server)
      .post(`/api/v1/backoffice/accounts/${account._id}/delegated-sessions`)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'Inspect synthetic operational query' })
      .expect(201);
    const exchange = await request(app.server)
      .post('/api/v1/auth/delegated-sessions/exchange')
      .send({
        exchangeCode: (start.body as { exchangeCode: string }).exchangeCode,
      })
      .expect(200);
    const delegated = (exchange.body as { accessToken: string }).accessToken;
    expect((await search({ query: '[.*]' }, delegated)).items[0].id).toBe(
      special,
    );
    const audit = await app.database.models.auditEvent
      .find({ actorUserId: admin._id, action: 'DELEGATED_ACTION_COMPLETED' })
      .lean();
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain('[.*]');
  });
});
