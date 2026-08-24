import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AffiliateCodeService } from '../src/affiliates/affiliate-code.service';
import type { TenantAuthContext } from '../src/auth/auth.types';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { syncClockIndexes } from '../src/database/models';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const ids = {
  tenantA: '71000000-0000-4000-8000-000000000001',
  tenantB: '71000000-0000-4000-8000-000000000002',
  customerA: '71000000-0000-4000-8000-000000000003',
  customerB: '71000000-0000-4000-8000-000000000004',
  customerRace: '71000000-0000-4000-8000-000000000005',
  serviceA: '71000000-0000-4000-8000-000000000006',
  serviceB: '71000000-0000-4000-8000-000000000007',
  ownerA: '71000000-0000-4000-8000-000000000008',
  ownerB: '71000000-0000-4000-8000-000000000009',
  agentA: '71000000-0000-4000-8000-00000000000a',
  customerAuth: '71000000-0000-4000-8000-00000000000b',
};

const terms = {
  discountType: 'PERCENT' as const,
  discountBasisPoints: 1_000,
  commissionType: 'PERCENT' as const,
  commissionBasisPoints: 2_000,
};

describe('affiliate code and public quote (integration e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let codes: AffiliateCodeService;
  let ownerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const fixture = await createCoreTestApplication();
    ({ app, server, database } = fixture);
    codes = app.get(AffiliateCodeService);
    await clearMongo(database);
    await syncClockIndexes(database.connection);
    await database.models.tenant.create([
      { _id: ids.tenantA, name: 'Affiliate A', slug: 'affiliate-a' },
      { _id: ids.tenantB, name: 'Affiliate B', slug: 'affiliate-b' },
    ]);
    await database.models.customer.create([
      { _id: ids.customerA, tenantId: ids.tenantA, fullName: 'Affiliate One' },
      { _id: ids.customerB, tenantId: ids.tenantB, fullName: 'Affiliate Two' },
      {
        _id: ids.customerRace,
        tenantId: ids.tenantA,
        fullName: 'Affiliate Race',
      },
      {
        _id: ids.customerAuth,
        tenantId: ids.tenantA,
        fullName: 'Affiliate Auth',
      },
    ]);
    await database.models.service.create([
      {
        _id: ids.serviceA,
        tenantId: ids.tenantA,
        name: 'Service A',
        durationMinutes: 60,
        priceMinor: 10_000,
        currency: 'COP',
      },
      {
        _id: ids.serviceB,
        tenantId: ids.tenantB,
        name: 'Service B',
        durationMinutes: 60,
        priceMinor: 20_000,
        currency: 'COP',
      },
    ]);
    const passwordHash = await hashPassword('affiliate-password');
    await database.models.user.create([
      {
        _id: ids.ownerA,
        email: 'affiliate-owner@example.test',
        displayName: 'Affiliate Owner',
        passwordHash,
        actorType: 'TENANT',
      },
      {
        _id: ids.agentA,
        email: 'affiliate-agent@example.test',
        displayName: 'Affiliate Agent',
        passwordHash,
        actorType: 'TENANT',
      },
    ]);
    await database.models.tenantMembership.create([
      { tenantId: ids.tenantA, userId: ids.ownerA, role: 'OWNER' },
      { tenantId: ids.tenantA, userId: ids.agentA, role: 'AGENT' },
    ]);
    ownerToken = await login(server, 'affiliate-owner@example.test');
    agentToken = await login(server, 'affiliate-agent@example.test');
  });

  afterAll(async () => app.close());

  it('enforces Tenant code uniqueness and allows the same text in another Tenant', async () => {
    await codes.create(authA(), ids.customerA, { code: 'SHARED', ...terms });
    await expect(
      codes.create(authA(), ids.customerRace, { code: 'shared', ...terms }),
    ).rejects.toMatchObject({ reasonCode: 'AFFILIATE_CODE_CONFLICT' });
    const tenantBCode = await codes.create(authB(), ids.customerB, {
      code: 'shared',
      ...terms,
    });
    expect(tenantBCode).toMatchObject({ code: 'SHARED', status: 'ACTIVE' });
    await codes.retire(authB(), ids.customerB, tenantBCode.id);
    await codes.create(authB(), ids.customerB, { code: 'ONLY-IN-B', ...terms });
  });

  it('allows only one current code under concurrent creation', async () => {
    const outcomes = await Promise.allSettled([
      codes.create(authA(), ids.customerRace, terms),
      codes.create(authA(), ids.customerRace, terms),
    ]);
    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(
      await database.models.affiliateCode.countDocuments({
        tenantId: ids.tenantA,
        customerId: ids.customerRace,
        currentSlot: 'CURRENT',
      }),
    ).toBe(1);
  });

  it('returns only safe quote economics and isolates code text by Tenant', async () => {
    const quote = await request(server)
      .post('/api/v1/public/affiliate-a/referrals/quote')
      .send({ code: ' shared ', serviceId: ids.serviceA })
      .expect(201);
    expect(quote.body).toEqual({
      code: 'SHARED',
      grossAmountMinor: 10_000,
      discountAmountMinor: 1_000,
      finalAmountMinor: 9_000,
      currency: 'COP',
    });
    expect(JSON.stringify(quote.body)).not.toMatch(
      /customer|commission|tenant|balance|payout/i,
    );
    const invalid = await request(server)
      .post('/api/v1/public/affiliate-a/referrals/quote')
      .send({ code: 'ONLY-IN-B', serviceId: ids.serviceA })
      .expect(400);
    const invalidBody = invalid.body as { reasonCode: string };
    expect(invalidBody.reasonCode).toBe('REFERRAL_CODE_INVALID');
  });

  it('preserves retired history and releases the current slot', async () => {
    const current = (await codes.list(ids.tenantA, ids.customerA))[0];
    await codes.deactivate(authA(), ids.customerA, current.id);
    await expect(
      request(server)
        .post('/api/v1/public/affiliate-a/referrals/quote')
        .send({ code: current.code, serviceId: ids.serviceA })
        .expect(400),
    ).resolves.toMatchObject({
      body: { reasonCode: 'REFERRAL_CODE_INACTIVE' },
    });
    await codes.retire(authA(), ids.customerA, current.id);
    await expect(
      codes.create(authA(), ids.customerA, { code: 'REPLACEMENT', ...terms }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(await codes.list(ids.tenantA, ids.customerA)).toHaveLength(2);
  });

  it('enforces management roles, DTO authority, tenancy, and audit', async () => {
    const endpoint = `/api/v1/customers/${ids.customerAuth}/affiliate-codes`;
    await request(server)
      .post(endpoint)
      .auth(agentToken, { type: 'bearer' })
      .send({ code: 'AGENT-DENIED', ...terms })
      .expect(403);
    await request(server)
      .get(`/api/v1/customers/${ids.customerAuth}/affiliate`)
      .auth(agentToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .post(`/api/v1/customers/${ids.customerAuth}/affiliate-payouts`)
      .auth(agentToken, { type: 'bearer' })
      .send({
        idempotencyKey: 'agent-payout-denied',
        currency: 'COP',
        amountMinor: 1,
      })
      .expect(403);
    await request(server)
      .post(endpoint)
      .auth(ownerToken, { type: 'bearer' })
      .send({ code: 'BAD-AUTHORITY', tenantId: ids.tenantB, ...terms })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('VALIDATION_FAILED'),
      );
    await request(server)
      .post(endpoint)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        code: 'UNSAFE-MONEY',
        discountType: 'FIXED',
        discountAmountMinor: Number.MAX_SAFE_INTEGER + 1,
        discountCurrency: 'COP',
        commissionType: 'PERCENT',
        commissionBasisPoints: 1_000,
      })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('VALIDATION_FAILED'),
      );
    await request(server)
      .post(endpoint)
      .auth(ownerToken, { type: 'bearer' })
      .send({
        code: 'LOCAL-TIME',
        ...terms,
        startsAt: '2099-01-01T09:00:00',
      })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('VALIDATION_FAILED'),
      );
    await request(server)
      .post(`/api/v1/customers/${ids.customerB}/affiliate-codes`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ code: 'CROSS-TENANT', ...terms })
      .expect(404);
    await request(server)
      .get(`/api/v1/customers/${ids.customerB}/affiliate`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
    const created = await request(server)
      .post(endpoint)
      .auth(ownerToken, { type: 'bearer' })
      .send({ code: 'OWNER-ALLOWED', ...terms })
      .expect(201);
    const createdBody = created.body as { id: string; code: string };
    expect(createdBody).toMatchObject({ code: 'OWNER-ALLOWED' });
    const detail = await request(server)
      .get(`/api/v1/customers/${ids.customerAuth}/affiliate`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    expect(detail.body).toMatchObject({
      customer: { id: ids.customerAuth, fullName: 'Affiliate Auth' },
      codes: [expect.objectContaining({ code: 'OWNER-ALLOWED' })],
      balances: [],
      activity: [],
      payouts: [],
    });
    expect(
      await database.models.auditEvent.countDocuments({
        tenantId: ids.tenantA,
        actorUserId: ids.ownerA,
        action: 'AFFILIATE_CODE_CREATED',
        entityId: createdBody.id,
      }),
    ).toBe(1);
  });
});

function authA(): TenantAuthContext {
  return auth(ids.tenantA, ids.ownerA, 'affiliate-a');
}

function authB(): TenantAuthContext {
  return auth(ids.tenantB, ids.ownerB, 'affiliate-b');
}

function auth(
  tenantId: string,
  userId: string,
  slug: string,
): TenantAuthContext {
  return {
    actorType: 'TENANT',
    userId,
    displayName: 'Owner',
    tenant: { id: tenantId, name: slug, slug },
    tenantRole: 'OWNER',
  };
}

async function login(server: Server, email: string): Promise<string> {
  const response = await request(server)
    .post('/api/v1/auth/login')
    .send({ email, password: 'affiliate-password' })
    .expect(200);
  return (response.body as { accessToken: string }).accessToken;
}
