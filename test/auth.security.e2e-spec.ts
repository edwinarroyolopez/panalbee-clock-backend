import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const ids = {
  tenantA: '10000000-0000-4000-8000-000000000001',
  tenantB: '10000000-0000-4000-8000-000000000002',
  locationA: '20000000-0000-4000-8000-000000000001',
  locationB: '20000000-0000-4000-8000-000000000002',
  ownerA: '30000000-0000-4000-8000-000000000001',
  staffUserA: '30000000-0000-4000-8000-000000000002',
  ownerB: '30000000-0000-4000-8000-000000000003',
  support: '30000000-0000-4000-8000-000000000004',
  admin: '30000000-0000-4000-8000-000000000005',
  serviceB: '40000000-0000-4000-8000-000000000001',
  staffMemberA: '50000000-0000-4000-8000-000000000001',
};

const password = 'correct-password';
const adminPhone = '+573001110099';

interface TokenBody {
  accessToken: string;
  user: {
    actorType: string;
    tenant?: { id: string };
    tenantRole?: string;
  };
}

describe('authentication and tenancy (security e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    server = testApp.server;
    database = testApp.database;
    await clearMongo(database);
    await seedSecurityFixture(database);

    for (const email of [
      'owner-a@example.test',
      'staff-a@example.test',
      'owner-b@example.test',
      'support@example.test',
      'admin@example.test',
    ]) {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[email] = (response.body as TokenBody).accessToken;
    }
    const phoneResponse = await request(server)
      .post('/api/v1/auth/login')
      .send({ phone: adminPhone, password })
      .expect(200);
    tokens[adminPhone] = (phoneResponse.body as TokenBody).accessToken;
  });

  afterAll(async () => app.close());

  it('logs in and resolves /auth/me from current server membership', async () => {
    const token = tokens['owner-a@example.test'];
    await request(server)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: TokenBody['user'] }) =>
        expect(body).toMatchObject({
          actorType: 'TENANT',
          tenant: { id: ids.tenantA },
          tenantRole: 'OWNER',
        }),
      );

    await database.models.tenantMembership.updateOne(
      { tenantId: ids.tenantA, userId: ids.ownerA },
      { $set: { role: 'MANAGER' } },
    );
    await request(server)
      .get('/api/v1/auth/me')
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: TokenBody['user'] }) =>
        expect(body.tenantRole).toBe('MANAGER'),
      );
    await database.models.tenantMembership.updateOne(
      { tenantId: ids.tenantA, userId: ids.ownerA },
      { $set: { role: 'OWNER' } },
    );

    await request(server)
      .get('/api/v1/tenants/me')
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { id: string } }) =>
        expect(body.id).toBe(ids.tenantA),
      );
  });

  it('prevents tenant A from reading or mutating tenant B', async () => {
    const token = tokens['owner-a@example.test'];
    await request(server)
      .get(`/api/v1/locations/${ids.locationB}`)
      .auth(token, { type: 'bearer' })
      .expect(404);
    await request(server)
      .patch(`/api/v1/locations/${ids.locationB}`)
      .auth(token, { type: 'bearer' })
      .send({ name: 'Compromised' })
      .expect(404);
    await request(server)
      .post(`/api/v1/staff/${ids.staffMemberA}/services`)
      .auth(token, { type: 'bearer' })
      .send({ serviceId: ids.serviceB })
      .expect(404);

    const location = await database.models.location
      .findOne({ _id: ids.locationB, tenantId: ids.tenantB })
      .lean();
    expect(location?.name).toBe('Location B');
  });

  it('rejects a body tenantId instead of treating it as authority', async () => {
    await request(server)
      .patch(`/api/v1/locations/${ids.locationA}`)
      .auth(tokens['owner-a@example.test'], { type: 'bearer' })
      .send({ name: 'Changed', tenantId: ids.tenantB })
      .expect(400)
      .expect(({ body }: { body: unknown }) =>
        expect(JSON.stringify(body)).toContain('tenantId'),
      );
  });

  it('denies a tenant role that cannot mutate locations', async () => {
    await request(server)
      .patch(`/api/v1/locations/${ids.locationA}`)
      .auth(tokens['staff-a@example.test'], { type: 'bearer' })
      .send({ name: 'Staff Changed' })
      .expect(403);
  });

  it('serves public context only for an active tenant', async () => {
    await request(server)
      .get('/api/v1/public/tenant-a/context')
      .expect(200)
      .expect(({ body }: { body: { locations: { id: string }[] } }) =>
        expect(body.locations).toEqual([
          expect.objectContaining({ id: ids.locationA }),
        ]),
      );
    await database.models.tenant.updateOne(
      { _id: ids.tenantA },
      { $set: { status: 'SUSPENDED' } },
    );
    await request(server).get('/api/v1/public/tenant-a/context').expect(404);
    await database.models.tenant.updateOne(
      { _id: ids.tenantA },
      { $set: { status: 'ACTIVE' } },
    );
  });

  it('denies tenant users Backoffice authority', async () => {
    await request(server)
      .get('/api/v1/backoffice/tenants')
      .auth(tokens['owner-a@example.test'], { type: 'bearer' })
      .expect(403);
  });

  it('authenticates an internal operator by E.164 phone', async () => {
    await request(server)
      .get('/api/v1/auth/me')
      .auth(tokens[adminPhone], { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) =>
        expect(body).toMatchObject({
          actorType: 'INTERNAL',
          internalRole: 'PLATFORM_ADMIN',
          phone: adminPhone,
        }),
      );
  });

  it('requires exactly one login identifier', async () => {
    await request(server)
      .post('/api/v1/auth/login')
      .send({ password })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('LOGIN_IDENTITY_INVALID'),
      );
    await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@example.test',
        phone: adminPhone,
        password,
      })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('LOGIN_IDENTITY_INVALID'),
      );
  });

  it('allows support to list tenants but denies admin mutation', async () => {
    const token = tokens['support@example.test'];
    await request(server)
      .get('/api/v1/backoffice/tenants')
      .auth(token, { type: 'bearer' })
      .expect(200);
    await request(server)
      .patch(`/api/v1/backoffice/tenants/${ids.tenantB}/status`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'SUSPENDED', reason: 'Requested by support' })
      .expect(403);
  });

  it('requires an admin reason and atomically appends an audit event', async () => {
    const token = tokens['admin@example.test'];
    await request(server)
      .patch(`/api/v1/backoffice/tenants/${ids.tenantB}/status`)
      .auth(token, { type: 'bearer' })
      .send({ status: 'SUSPENDED', reason: 'short' })
      .expect(400);
    expect(
      await database.models.tenant.exists({
        _id: ids.tenantB,
        status: 'ACTIVE',
      }),
    ).not.toBeNull();

    const requestId = 'admin-status-test-request';
    await request(server)
      .patch(`/api/v1/backoffice/tenants/${ids.tenantB}/status`)
      .auth(token, { type: 'bearer' })
      .set('x-request-id', requestId)
      .send({ status: 'SUSPENDED', reason: 'Repeated policy violations' })
      .expect(200)
      .expect(({ body }: { body: { status: string } }) =>
        expect(body.status).toBe('SUSPENDED'),
      );

    const audit = await database.models.auditEvent
      .findOne({ tenantId: ids.tenantB, action: 'TENANT_STATUS_CHANGED' })
      .lean();
    expect(audit).toMatchObject({
      actorUserId: ids.admin,
      reason: 'Repeated policy violations',
      requestId,
      metadata: { previousStatus: 'ACTIVE', newStatus: 'SUSPENDED' },
    });

    await request(server)
      .get('/api/v1/backoffice/audit')
      .auth(tokens['support@example.test'], { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { items: Record<string, unknown>[] } }) => {
        expect(body.items).toEqual([
          expect.objectContaining({ action: 'TENANT_STATUS_CHANGED' }),
        ]);
        expect(body.items[0]).not.toHaveProperty('metadata');
        expect(body.items[0]).not.toHaveProperty('requestId');
        expect(body.items[0]).not.toHaveProperty('actorUserId');
      });
  });
});

async function seedSecurityFixture(database: DatabaseService): Promise<void> {
  const passwordHash = await hashPassword(password);
  await database.models.tenant.insertMany([
    { _id: ids.tenantA, name: 'Tenant A', slug: 'tenant-a' },
    { _id: ids.tenantB, name: 'Tenant B', slug: 'tenant-b' },
  ]);
  await database.models.location.insertMany([
    {
      _id: ids.locationA,
      tenantId: ids.tenantA,
      name: 'Location A',
      timezone: 'America/Bogota',
    },
    {
      _id: ids.locationB,
      tenantId: ids.tenantB,
      name: 'Location B',
      timezone: 'America/Bogota',
    },
  ]);
  await database.models.user.insertMany([
    tenantUser(ids.ownerA, 'owner-a@example.test', 'Owner A', passwordHash),
    tenantUser(ids.staffUserA, 'staff-a@example.test', 'Staff A', passwordHash),
    tenantUser(ids.ownerB, 'owner-b@example.test', 'Owner B', passwordHash),
    internalUser(
      ids.support,
      'support@example.test',
      'Platform Support',
      passwordHash,
      'PLATFORM_SUPPORT',
    ),
    internalUser(
      ids.admin,
      'admin@example.test',
      'Platform Admin',
      passwordHash,
      'PLATFORM_ADMIN',
      adminPhone,
    ),
  ]);
  await database.models.tenantMembership.insertMany([
    { tenantId: ids.tenantA, userId: ids.ownerA, role: 'OWNER' },
    { tenantId: ids.tenantA, userId: ids.staffUserA, role: 'STAFF' },
    { tenantId: ids.tenantB, userId: ids.ownerB, role: 'OWNER' },
  ]);
  await database.models.service.create({
    _id: ids.serviceB,
    tenantId: ids.tenantB,
    name: 'Tenant B Service',
    durationMinutes: 30,
  });
  await database.models.staff.create({
    _id: ids.staffMemberA,
    tenantId: ids.tenantA,
    locationId: ids.locationA,
    displayName: 'Staff Member A',
  });
}

function tenantUser(
  _id: string,
  email: string,
  displayName: string,
  passwordHash: string,
) {
  return {
    _id,
    email,
    displayName,
    passwordHash,
    actorType: 'TENANT' as const,
  };
}

function internalUser(
  _id: string,
  email: string,
  displayName: string,
  passwordHash: string,
  internalRole: 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT',
  phone?: string,
) {
  return {
    _id,
    email,
    displayName,
    passwordHash,
    actorType: 'INTERNAL' as const,
    internalRole,
    ...(phone ? { phone } : {}),
  };
}
