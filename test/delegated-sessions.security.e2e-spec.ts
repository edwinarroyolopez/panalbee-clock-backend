import { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { INDEX_NAMES, syncClockIndexes } from '../src/database/models';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const ids = {
  admin: 'd0000000-0000-4000-8000-000000000001',
  support: 'd0000000-0000-4000-8000-000000000002',
  owner: 'd0000000-0000-4000-8000-000000000003',
  membership: 'd0000000-0000-4000-8000-000000000004',
  tenant: 'd0000000-0000-4000-8000-000000000005',
  account: 'd0000000-0000-4000-8000-000000000006',
  profile: 'd0000000-0000-4000-8000-000000000007',
  location: 'd0000000-0000-4000-8000-000000000008',
  foreignTenant: 'd0000000-0000-4000-8000-000000000009',
  foreignLocation: 'd0000000-0000-4000-8000-000000000010',
  service: 'd0000000-0000-4000-8000-000000000011',
  staff: 'd0000000-0000-4000-8000-000000000012',
  customer: 'd0000000-0000-4000-8000-000000000013',
};
const password = 'correct-password';
const reason = 'Investigate customer configuration safely';

interface StartBody {
  id: string;
  exchangeCode: string;
  expiresAt: string;
  account: { id: string; slug: string };
}

interface ExchangeBody {
  accessToken: string;
  expiresIn: number;
  user: {
    userId: string;
    displayName: string;
    email: string;
    actorType: string;
    internalRole: string;
    tenantRole: string;
    effectiveTenantRole: string;
    tenant: { id: string; slug: string };
    delegatedSession: { id: string; reason: string; expiresAt: string };
  };
}

describe('DelegatedSession (security e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let adminToken: string;
  let supportToken: string;
  let tenantToken: string;

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    server = testApp.server;
    database = testApp.database;
    await clearMongo(database);
    await syncClockIndexes(database.connection);
    await seed(database);
    adminToken = await login('admin@delegated.test');
    supportToken = await login('support@delegated.test');
    tenantToken = await login('owner@delegated.test');
  });

  afterAll(async () => app.close());

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  async function start(
    requestId = 'delegated-session-start-request',
  ): Promise<StartBody> {
    const response = await request(server)
      .post(`/api/v1/backoffice/accounts/${ids.account}/delegated-sessions`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', requestId)
      .send({ reason: `  ${reason}  ` })
      .expect(201);
    return response.body as StartBody;
  }

  async function exchange(exchangeCode: string): Promise<ExchangeBody> {
    const response = await request(server)
      .post('/api/v1/auth/delegated-sessions/exchange')
      .send({ exchangeCode })
      .expect(200);
    return response.body as ExchangeBody;
  }

  it('allows only active platform admins with a valid reason and account', async () => {
    const path = `/api/v1/backoffice/accounts/${ids.account}/delegated-sessions`;
    await request(server).post(path).send({ reason }).expect(401);
    await request(server)
      .post(path)
      .auth(supportToken, { type: 'bearer' })
      .send({ reason })
      .expect(403);
    await request(server)
      .post(path)
      .auth(tenantToken, { type: 'bearer' })
      .send({ reason })
      .expect(403);
    await request(server)
      .post(path)
      .auth(adminToken, { type: 'bearer' })
      .send({})
      .expect(400);
    await request(server)
      .post(path)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'short' })
      .expect(400);

    const started = await start();
    expect(started).toMatchObject({
      account: { id: ids.account, slug: 'delegated-account' },
    });
    expect(started.exchangeCode).toHaveLength(43);
    expect(
      new Date(started.expiresAt).getTime() - Date.now(),
    ).toBeLessThanOrEqual(15 * 60 * 1000);
    const stored = await database.models.delegatedSession
      .findById(started.id)
      .lean();
    expect(stored).toMatchObject({
      platformAdminId: ids.admin,
      targetTenantId: ids.tenant,
      reason,
      status: 'ACTIVE',
      exchangeCodeHash: createHash('sha256')
        .update(started.exchangeCode)
        .digest('hex'),
    });
    expect(JSON.stringify(stored)).not.toContain(started.exchangeCode);
    expect(
      await database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        actorUserId: ids.admin,
        actorType: 'INTERNAL_USER',
        action: 'DELEGATED_SESSION_STARTED',
        entityType: 'account',
        entityId: ids.account,
        reason,
        requestId: 'delegated-session-start-request',
        'metadata.sessionId': started.id,
      }),
    ).toBe(1);

    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${started.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .send({})
      .expect(200);
  });

  it('exchanges once and reconstructs real delegated authority without membership', async () => {
    const started = await start('delegated-exchange-start');
    const exchanged = await exchange(started.exchangeCode);
    expect(exchanged.expiresIn).toBeGreaterThan(0);
    expect(exchanged.expiresIn).toBeLessThanOrEqual(15 * 60);
    expect(exchanged.user).toMatchObject({
      userId: ids.admin,
      displayName: 'Delegated Admin',
      email: 'admin@delegated.test',
      actorType: 'DELEGATED',
      internalRole: 'PLATFORM_ADMIN',
      tenantRole: 'OWNER',
      effectiveTenantRole: 'OWNER',
      tenant: { id: ids.tenant, slug: 'delegated-account' },
      delegatedSession: { id: started.id, reason },
    });
    expect(
      await database.models.tenantMembership.countDocuments({
        userId: ids.admin,
      }),
    ).toBe(0);
    await request(server)
      .post('/api/v1/auth/delegated-sessions/exchange')
      .send({ exchangeCode: started.exchangeCode })
      .expect(401)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('DELEGATED_SESSION_CODE_INVALID'),
      );

    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${started.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
  });

  it('permits OWNER policies, preserves provenance, and isolates child ids', async () => {
    const started = await start('delegated-operation-start');
    const { accessToken } = await exchange(started.exchangeCode);
    await request(server)
      .get('/api/v1/tenants/me')
      .auth(accessToken, { type: 'bearer' })
      .set('x-request-id', 'delegated-get-tenant')
      .expect(200)
      .expect(({ body }: { body: { id: string } }) =>
        expect(body.id).toBe(ids.tenant),
      );
    await request(server)
      .patch(`/api/v1/locations/${ids.location}`)
      .auth(accessToken, { type: 'bearer' })
      .send({ name: 'Delegated Main' })
      .expect(200);
    await request(server)
      .patch('/api/v1/accounts/delegated-account/public-profile')
      .auth(accessToken, { type: 'bearer' })
      .set('x-request-id', 'delegated-profile-update')
      .send({ headline: 'Updated by delegated admin' })
      .expect(200);
    await request(server)
      .get('/api/v1/backoffice/accounts')
      .auth(accessToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .patch(`/api/v1/locations/${ids.foreignLocation}`)
      .auth(accessToken, { type: 'bearer' })
      .set('x-request-id', 'delegated-location-failure')
      .send({ name: 'Foreign overwrite' })
      .expect(404);
    expect(
      await database.models.location.exists({
        _id: ids.foreignLocation,
        name: 'Foreign Main',
      }),
    ).not.toBeNull();

    const profileAudit = await database.models.auditEvent
      .findOne({ action: 'PUBLIC_PROFILE_UPDATED', entityId: ids.account })
      .sort({ createdAt: -1 })
      .lean();
    expect(profileAudit).toMatchObject({
      actorUserId: ids.admin,
      actorType: 'INTERNAL_USER',
      tenantId: ids.tenant,
    });
    const completed = await database.models.auditEvent
      .findOne({
        action: 'DELEGATED_ACTION_COMPLETED',
        entityId: started.id,
        requestId: 'delegated-profile-update',
      })
      .lean();
    expect(completed).toMatchObject({
      actorUserId: ids.admin,
      actorType: 'INTERNAL_USER',
      tenantId: ids.tenant,
      reason,
      metadata: {
        sessionId: started.id,
        method: 'PATCH',
        statusCode: 200,
      },
    });
    expect((completed?.metadata as { path: string }).path).toContain(
      'public-profile',
    );
    expect(
      await database.models.auditEvent.countDocuments({
        action: 'DELEGATED_ACTION_ATTEMPTED',
        entityId: started.id,
        requestId: 'delegated-location-failure',
      }),
    ).toBe(1);
    expect(
      await database.models.auditEvent.countDocuments({
        action: 'DELEGATED_ACTION_COMPLETED',
        entityId: started.id,
        requestId: 'delegated-location-failure',
      }),
    ).toBe(0);
    const attempted = await database.models.auditEvent
      .findOne({
        action: 'DELEGATED_ACTION_ATTEMPTED',
        entityId: started.id,
        requestId: 'delegated-get-tenant',
      })
      .lean();
    expect(attempted).toMatchObject({
      actorUserId: ids.admin,
      actorType: 'INTERNAL_USER',
      tenantId: ids.tenant,
      reason,
      metadata: {
        sessionId: started.id,
        method: 'GET',
      },
    });
    expect((attempted?.metadata as { path: string }).path).toContain(
      'tenants/me',
    );
    expect(JSON.stringify(attempted)).not.toContain(started.exchangeCode);

    await request(server)
      .get(`/api/v1/backoffice/accounts/${ids.account}/audit`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { items: { action: string }[] } }) => {
        const actions = body.items.map(({ action }) => action);
        expect(actions).toContain('DELEGATED_SESSION_STARTED');
        expect(actions).toContain('DELEGATED_ACTION_ATTEMPTED');
        expect(actions).toContain('DELEGATED_ACTION_COMPLETED');
        expect(actions).toContain('PUBLIC_PROFILE_UPDATED');
      });

    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${started.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
  });

  it('revokes immediately and appends the ended event exactly once', async () => {
    const started = await start('delegated-revoke-start');
    const { accessToken } = await exchange(started.exchangeCode);
    const revokePath = `/api/v1/backoffice/delegated-sessions/${started.id}/revoke`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(server)
        .post(revokePath)
        .auth(adminToken, { type: 'bearer' })
        .set('x-request-id', `delegated-revoke-${attempt}`)
        .expect(200)
        .expect(({ body }: { body: { status: string } }) =>
          expect(body.status).toBe('REVOKED'),
        );
    }
    await request(server)
      .get('/api/v1/tenants/me')
      .auth(accessToken, { type: 'bearer' })
      .expect(401);
    expect(
      await database.models.auditEvent.countDocuments({
        action: 'DELEGATED_SESSION_ENDED',
        'metadata.sessionId': started.id,
      }),
    ).toBe(1);
    const ended = await database.models.auditEvent
      .findOne({
        action: 'DELEGATED_SESSION_ENDED',
        'metadata.sessionId': started.id,
      })
      .lean();
    expect(ended).toMatchObject({
      tenantId: ids.tenant,
      actorUserId: ids.admin,
      actorType: 'INTERNAL_USER',
      entityType: 'account',
      entityId: ids.account,
      reason,
      requestId: 'delegated-revoke-0',
      metadata: { sessionId: started.id, status: 'REVOKED' },
    });
    expect(Object.keys(ended?.metadata ?? {}).sort()).toEqual([
      'expiry',
      'sessionId',
      'status',
    ]);
  });

  it('records delegated appointment create, reschedule, and cancel as internal', async () => {
    const started = await start('delegated-appointment-start');
    const { accessToken } = await exchange(started.exchangeCode);
    const created = await request(server)
      .post('/api/v1/appointments')
      .auth(accessToken, { type: 'bearer' })
      .send({
        locationId: ids.location,
        serviceId: ids.service,
        staffId: ids.staff,
        customerId: ids.customer,
        startsAt: '2099-09-03T14:00:00Z',
        idempotencyKey: 'delegated-appointment-create',
      })
      .expect(201);
    const appointmentId = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .auth(accessToken, { type: 'bearer' })
      .send({ startsAt: '2099-09-03T16:00:00Z' })
      .expect(200);
    await request(server)
      .post(`/api/v1/appointments/${appointmentId}/cancel`)
      .auth(accessToken, { type: 'bearer' })
      .send({ reason: 'Delegated customer support request' })
      .expect(200);

    const events = await database.models.auditEvent
      .find({
        entityType: 'appointment',
        entityId: appointmentId,
        action: {
          $in: [
            'APPOINTMENT_CREATED',
            'APPOINTMENT_RESCHEDULED',
            'APPOINTMENT_CANCELLED',
          ],
        },
      })
      .lean();
    expect(events).toHaveLength(3);
    for (const action of [
      'APPOINTMENT_CREATED',
      'APPOINTMENT_RESCHEDULED',
      'APPOINTMENT_CANCELLED',
    ]) {
      expect(events).toContainEqual(
        expect.objectContaining({
          action,
          actorUserId: ids.admin,
          actorType: 'INTERNAL_USER',
          tenantId: ids.tenant,
        }),
      );
    }

    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${started.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
  });

  it('ends the current delegated session but rejects direct actors', async () => {
    await request(server)
      .post('/api/v1/auth/delegated-sessions/end')
      .auth(adminToken, { type: 'bearer' })
      .expect(403);
    const started = await start('delegated-self-end-start');
    const { accessToken } = await exchange(started.exchangeCode);
    await request(server)
      .post('/api/v1/auth/delegated-sessions/end')
      .auth(accessToken, { type: 'bearer' })
      .set('x-request-id', 'delegated-self-end')
      .expect(200)
      .expect(({ body }: { body: { status: string } }) =>
        expect(body.status).toBe('REVOKED'),
      );
    expect(
      await database.models.auditEvent.countDocuments({
        action: 'DELEGATED_SESSION_ENDED',
        'metadata.sessionId': started.id,
      }),
    ).toBe(1);
  });

  it('denies expiry immediately and materializes EXPIRED once', async () => {
    const started = await start('delegated-expiry-start');
    const { accessToken } = await exchange(started.exchangeCode);
    await database.models.delegatedSession.updateOne(
      { _id: started.id },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );
    await request(server)
      .get('/api/v1/tenants/me')
      .auth(accessToken, { type: 'bearer' })
      .expect(401);
    expect(
      await database.models.delegatedSession.exists({
        _id: started.id,
        status: 'EXPIRED',
      }),
    ).not.toBeNull();
    expect(
      await database.models.auditEvent.countDocuments({
        action: 'DELEGATED_SESSION_ENDED',
        'metadata.sessionId': started.id,
        'metadata.status': 'EXPIRED',
      }),
    ).toBe(1);
  });

  it('revalidates disabled admins and suspended accounts on each request', async () => {
    const disabled = await start('delegated-disabled-admin-start');
    const disabledToken = (await exchange(disabled.exchangeCode)).accessToken;
    await database.models.user.updateOne(
      { _id: ids.admin },
      { $set: { status: 'DISABLED' } },
    );
    await request(server)
      .get('/api/v1/tenants/me')
      .auth(disabledToken, { type: 'bearer' })
      .expect(401);
    await database.models.user.updateOne(
      { _id: ids.admin },
      { $set: { status: 'ACTIVE' } },
    );
    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${disabled.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);

    const suspended = await start('delegated-suspended-account-start');
    const suspendedToken = (await exchange(suspended.exchangeCode)).accessToken;
    await database.models.account.updateOne(
      { _id: ids.account },
      { $set: { status: 'SUSPENDED' } },
    );
    await request(server)
      .get('/api/v1/tenants/me')
      .auth(suspendedToken, { type: 'bearer' })
      .expect(401);
    await database.models.account.updateOne(
      { _id: ids.account },
      { $set: { status: 'ACTIVE' } },
    );
    await request(server)
      .post(`/api/v1/backoffice/delegated-sessions/${suspended.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
  });

  it('keeps the schema strict with unique and lookup indexes', async () => {
    expect(
      () =>
        new database.models.delegatedSession({
          platformAdminId: ids.admin,
          targetTenantId: ids.tenant,
          reason,
          expiresAt: new Date(Date.now() + 60_000),
          status: 'ACTIVE',
          exchangeCodeHash: 'a'.repeat(64),
          rawExchangeCode: 'must-not-persist',
        }),
    ).toThrow(/strict mode/i);
    const indexes = await database.models.delegatedSession.collection.indexes();
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        INDEX_NAMES.delegatedSessionExchangeCode,
        INDEX_NAMES.delegatedSessionTargetStatusExpiry,
      ]),
    );
    expect(
      indexes.find(
        ({ name }) => name === INDEX_NAMES.delegatedSessionExchangeCode,
      )?.unique,
    ).toBe(true);
  });
});

async function seed(database: DatabaseService): Promise<void> {
  const passwordHash = await hashPassword(password);
  await database.models.tenant.create([
    {
      _id: ids.tenant,
      name: 'Delegated Account',
      slug: 'delegated-account',
    },
    {
      _id: ids.foreignTenant,
      name: 'Foreign Account',
      slug: 'foreign-account',
    },
  ]);
  await database.models.user.create([
    {
      _id: ids.admin,
      email: 'admin@delegated.test',
      displayName: 'Delegated Admin',
      passwordHash,
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_ADMIN',
    },
    {
      _id: ids.support,
      email: 'support@delegated.test',
      displayName: 'Delegated Support',
      passwordHash,
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_SUPPORT',
    },
    {
      _id: ids.owner,
      email: 'owner@delegated.test',
      displayName: 'Tenant Owner',
      passwordHash,
      actorType: 'TENANT',
    },
  ]);
  await database.models.tenantMembership.create({
    _id: ids.membership,
    tenantId: ids.tenant,
    userId: ids.owner,
    role: 'OWNER',
  });
  await database.models.account.create({
    _id: ids.account,
    businessName: 'Delegated Account',
    slug: 'delegated-account',
    status: 'ACTIVE',
    ownerUserId: ids.owner,
    tenantId: ids.tenant,
    phone: '+573001234567',
    publicBookingEnabled: true,
  });
  await database.models.accountPublicProfile.create({
    _id: ids.profile,
    accountId: ids.account,
    headline: 'Delegated profile',
    description: '',
    theme: 'default',
    contactInfo: {},
    bookingEnabled: true,
  });
  await database.models.location.create([
    {
      _id: ids.location,
      tenantId: ids.tenant,
      name: 'Main',
      timezone: 'America/Bogota',
    },
    {
      _id: ids.foreignLocation,
      tenantId: ids.foreignTenant,
      name: 'Foreign Main',
      timezone: 'America/Bogota',
    },
  ]);
  await database.models.service.create({
    _id: ids.service,
    tenantId: ids.tenant,
    name: 'Delegated service',
    durationMinutes: 60,
  });
  await database.models.staff.create({
    _id: ids.staff,
    tenantId: ids.tenant,
    locationId: ids.location,
    displayName: 'Delegated professional',
  });
  await database.models.staffService.create({
    tenantId: ids.tenant,
    staffId: ids.staff,
    serviceId: ids.service,
  });
  await database.models.customer.create({
    _id: ids.customer,
    tenantId: ids.tenant,
    fullName: 'Delegated Customer',
    phone: '+573009999999',
  });
  await database.models.schedule.create({
    tenantId: ids.tenant,
    locationId: ids.location,
    staffId: ids.staff,
    dayOfWeek: 4,
    startsAt: '08:00',
    endsAt: '18:00',
  });
}
