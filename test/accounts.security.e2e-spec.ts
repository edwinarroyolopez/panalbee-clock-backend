import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { INDEX_NAMES, syncClockIndexes } from '../src/database/models';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const ids = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  support: 'a0000000-0000-4000-8000-000000000002',
  tenant: 'a0000000-0000-4000-8000-000000000003',
  tenantUser: 'a0000000-0000-4000-8000-000000000004',
  tenantMembership: 'a0000000-0000-4000-8000-000000000005',
  staffUser: 'a0000000-0000-4000-8000-000000000006',
  staffMembership: 'a0000000-0000-4000-8000-000000000007',
};
const password = 'correct-password';
const createPayload = {
  businessName: 'Bee Studio',
  slug: 'Bee-Studio',
  ownerEmail: 'OWNER@EXAMPLE.TEST',
  ownerPhone: '+573001234567',
  planCode: 'STARTER',
  status: 'TRIAL',
  publicBookingEnabled: true,
  locationName: 'Main Studio',
  timezone: 'America/Bogota',
};

describe('Account control plane (security e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;
  let adminToken: string;
  let supportToken: string;
  let tenantToken: string;
  let staffToken: string;
  let accountId: string;
  let accountTenantId: string;
  let ownerUserId: string;

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    server = testApp.server;
    database = testApp.database;
    await clearMongo(database);
    await syncClockIndexes(database.connection);
    await seedOperators(database);
    adminToken = await login('admin@example.test');
    supportToken = await login('support@example.test');
    tenantToken = await login('legacy-owner@example.test');
    staffToken = await login('legacy-staff@example.test');
  });

  afterAll(async () => app.close());

  async function login(email: string): Promise<string> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it('restricts provisioning to admins and validates reserved public slugs', async () => {
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(supportToken, { type: 'bearer' })
      .send(createPayload)
      .expect(403);
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(tenantToken, { type: 'bearer' })
      .send(createPayload)
      .expect(403);
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({ ...createPayload, slug: 'api' })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('ACCOUNT_SLUG_RESERVED'),
      );
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        slug: 'unknown-provisioning-fields',
        password: 'must-not-be-accepted',
        tenantId: ids.tenant,
        accountId: ids.tenant,
      })
      .expect(400)
      .expect(
        ({
          body,
        }: {
          body: { reasonCode: string; details: { field: string }[] };
        }) => {
          expect(body.reasonCode).toBe('VALIDATION_FAILED');
          expect(body.details.map(({ field }) => field).sort()).toEqual(
            expect.arrayContaining(['accountId', 'password', 'tenantId']),
          );
        },
      );
  });

  it('provisions every aggregate member atomically without exposing credentials', async () => {
    const response = await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'account-provisioning-request')
      .send(createPayload)
      .expect(201);
    const body = response.body as {
      id: string;
      tenantId: string;
      owner: { id: string; email: string; phone: string; status: string };
      slug: string;
    };
    accountId = body.id;
    accountTenantId = body.tenantId;
    ownerUserId = body.owner.id;
    expect(body).toMatchObject({
      slug: 'bee-studio',
      owner: {
        email: 'owner@example.test',
        phone: '+573001234567',
        status: 'PENDING_ACTIVATION',
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /password|hash|secret|credential|token/i,
    );

    expect(
      await Promise.all([
        database.models.account.countDocuments({ _id: accountId }),
        database.models.tenant.countDocuments({ _id: accountTenantId }),
        database.models.location.countDocuments({ tenantId: accountTenantId }),
        database.models.user.countDocuments({ _id: ownerUserId }),
        database.models.tenantMembership.countDocuments({
          tenantId: accountTenantId,
          userId: ownerUserId,
          role: 'OWNER',
        }),
        database.models.accountPublicProfile.countDocuments({ accountId }),
        database.models.auditEvent.countDocuments({
          tenantId: accountTenantId,
          entityId: accountId,
          action: 'ACCOUNT_CREATED',
          actorType: 'INTERNAL_USER',
        }),
      ]),
    ).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const audit = await database.models.auditEvent
      .findOne({ entityId: accountId, action: 'ACCOUNT_CREATED' })
      .lean();
    expect(audit).toMatchObject({
      tenantId: accountTenantId,
      actorUserId: ids.admin,
      actorType: 'INTERNAL_USER',
      action: 'ACCOUNT_CREATED',
      entityType: 'account',
      entityId: accountId,
      requestId: 'account-provisioning-request',
    });
    expect(audit?.reason ?? null).toBeNull();
    expect(JSON.stringify(audit)).not.toMatch(
      /password|hash|secret|credential|token/i,
    );
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@example.test', password })
      .expect(401);
  });

  it('maps slug and phone conflicts without leaving partial aggregates', async () => {
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        ownerEmail: 'slug-conflict@example.test',
        ownerPhone: '+573001234570',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('ACCOUNT_SLUG_CONFLICT'),
      );

    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        slug: 'phone-conflict-account',
        ownerEmail: 'phone-conflict@example.test',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('OWNER_PHONE_CONFLICT'),
      );
    expect(
      await Promise.all([
        database.models.account.countDocuments({
          slug: 'phone-conflict-account',
        }),
        database.models.tenant.countDocuments({
          slug: 'phone-conflict-account',
        }),
        database.models.user.countDocuments({
          email: 'phone-conflict@example.test',
        }),
      ]),
    ).toEqual([0, 0, 0]);
  });

  it('projects an initially suspended account and tenant consistently', async () => {
    const response = await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        businessName: 'Suspended Bee Studio',
        slug: 'suspended-bee-studio',
        ownerEmail: 'suspended-owner@example.test',
        ownerPhone: '+573001234571',
        status: 'SUSPENDED',
        locationName: 'Suspended Location',
      })
      .expect(201);
    const suspended = response.body as {
      id: string;
      tenantId: string;
      status: string;
    };
    expect(suspended.status).toBe('SUSPENDED');
    expect(
      await database.models.tenant.exists({
        _id: suspended.tenantId,
        status: 'SUSPENDED',
      }),
    ).not.toBeNull();
    await request(server)
      .get('/api/v1/public/suspended-bee-studio/services')
      .expect(404);
  });

  it('rolls back the full aggregate and audit when the final write fails', async () => {
    const models = database.models;
    const before = await Promise.all([
      models.account.countDocuments(),
      models.tenant.countDocuments(),
      models.location.countDocuments(),
      models.user.countDocuments(),
      models.tenantMembership.countDocuments(),
      models.accountPublicProfile.countDocuments(),
      models.auditEvent.countDocuments(),
    ]);
    const auditFailure = jest
      .spyOn(app.get(AuditService), 'record')
      .mockRejectedValueOnce(new Error('Injected late audit failure'));
    try {
      await request(server)
        .post('/api/v1/backoffice/accounts')
        .auth(adminToken, { type: 'bearer' })
        .send({
          ...createPayload,
          businessName: 'Late Rollback Studio',
          slug: 'late-rollback-studio',
          ownerEmail: 'late-rollback@example.test',
          ownerPhone: '+573001234572',
          locationName: 'Late Rollback Location',
        })
        .expect(500);
    } finally {
      auditFailure.mockRestore();
    }
    expect(
      await Promise.all([
        models.account.countDocuments(),
        models.tenant.countDocuments(),
        models.location.countDocuments(),
        models.user.countDocuments(),
        models.tenantMembership.countDocuments(),
        models.accountPublicProfile.countDocuments(),
        models.auditEvent.countDocuments(),
      ]),
    ).toEqual(before);
  });

  it('rolls back all writes and returns a stable duplicate identity conflict', async () => {
    await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        slug: 'rollback-account',
        ownerPhone: '+573009999999',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('OWNER_EMAIL_CONFLICT'),
      );
    expect(
      await database.models.account.countDocuments({
        slug: 'rollback-account',
      }),
    ).toBe(0);
    expect(
      await database.models.tenant.countDocuments({ slug: 'rollback-account' }),
    ).toBe(0);
    expect(
      await database.models.location.countDocuments({
        name: createPayload.locationName,
        tenantId: { $ne: accountTenantId },
      }),
    ).toBe(0);
  });

  it('isolates the server-resolved tenant audit for admin/support reads', async () => {
    const foreignResponse = await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...createPayload,
        businessName: 'Foreign Bee Studio',
        slug: 'foreign-bee-studio',
        ownerEmail: 'foreign-owner@example.test',
        ownerPhone: '+573001234568',
      })
      .expect(201);
    const foreignAccount = foreignResponse.body as {
      id: string;
      tenantId: string;
    };

    for (const token of [adminToken, supportToken]) {
      await request(server)
        .get('/api/v1/backoffice/accounts')
        .auth(token, { type: 'bearer' })
        .expect(200);
      await request(server)
        .get(`/api/v1/backoffice/accounts/${accountId}`)
        .auth(token, { type: 'bearer' })
        .expect(200);
      await request(server)
        .get(`/api/v1/backoffice/accounts/${accountId}/audit`)
        .query({ tenantId: foreignAccount.tenantId })
        .auth(token, { type: 'bearer' })
        .expect(200)
        .expect(
          ({ body }: { body: { items: Array<Record<string, unknown>> } }) => {
            expect(body.items).toHaveLength(1);
            const item = body.items[0];
            expect(typeof item.id).toBe('string');
            expect(typeof item.createdAt).toBe('string');
            expect(item).toEqual({
              id: item.id,
              actorType: 'INTERNAL_USER',
              actorUserId: ids.admin,
              action: 'ACCOUNT_CREATED',
              entityType: 'account',
              entityId: accountId,
              reason: null,
              requestId: 'account-provisioning-request',
              createdAt: item.createdAt,
            });
            expect(item).not.toHaveProperty('tenantId');
            expect(item).not.toHaveProperty('metadata');
            expect(JSON.stringify(body)).not.toMatch(
              /accessToken|exchangeCode|password|secret/i,
            );
          },
        );
    }
    await request(server)
      .get(`/api/v1/backoffice/accounts/${foreignAccount.id}/audit`)
      .query({ tenantId: accountTenantId })
      .auth(adminToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { items: Array<{ entityId: string }> } }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0].entityId).toBe(foreignAccount.id);
        expect(body.items).not.toContainEqual(
          expect.objectContaining({ entityId: accountId }),
        );
      });
    await request(server)
      .get('/api/v1/backoffice/accounts')
      .auth(tenantToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get(`/api/v1/backoffice/accounts/${accountId}/audit`)
      .auth(tenantToken, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get(
        '/api/v1/backoffice/accounts/a0000000-0000-4000-8000-000000000099/audit',
      )
      .auth(adminToken, { type: 'bearer' })
      .expect(404)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('ACCOUNT_NOT_FOUND'),
      );
  });

  it('projects valid lifecycle transitions and does not audit a no-op', async () => {
    await request(server)
      .patch(`/api/v1/backoffice/tenants/${accountTenantId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .send({ status: 'SUSPENDED', reason: 'Must use account lifecycle' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('ACCOUNT_STATUS_REQUIRED'),
      );
    await request(server)
      .patch(`/api/v1/backoffice/accounts/${accountId}/status`)
      .auth(supportToken, { type: 'bearer' })
      .send({ status: 'ACTIVE', reason: 'Support cannot activate' })
      .expect(403);
    await request(server)
      .patch(`/api/v1/backoffice/accounts/${accountId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'account-activate-request')
      .send({ status: 'ACTIVE', reason: 'Onboarding checks completed' })
      .expect(200);
    expect(
      await database.models.tenant.exists({
        _id: accountTenantId,
        status: 'ACTIVE',
      }),
    ).not.toBeNull();
    const beforeNoOp = await database.models.auditEvent.countDocuments({
      entityId: accountId,
      action: 'ACCOUNT_ACTIVATED',
    });
    await request(server)
      .patch(`/api/v1/backoffice/accounts/${accountId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'account-activate-noop-request')
      .send({ status: 'ACTIVE', reason: 'State already verified active' })
      .expect(200);
    expect(
      await database.models.auditEvent.countDocuments({
        entityId: accountId,
        action: 'ACCOUNT_ACTIVATED',
      }),
    ).toBe(beforeNoOp);

    await request(server)
      .patch(`/api/v1/backoffice/accounts/${accountId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'account-suspend-request')
      .send({ status: 'SUSPENDED', reason: 'Controlled lifecycle test' })
      .expect(200);
    expect(
      await database.models.tenant.exists({
        _id: accountTenantId,
        status: 'SUSPENDED',
      }),
    ).not.toBeNull();
    await request(server)
      .patch(`/api/v1/backoffice/accounts/${accountId}/status`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'account-reactivate-request')
      .send({ status: 'ACTIVE', reason: 'Controlled lifecycle recovery' })
      .expect(200);

    const expectedEvents = [
      {
        action: 'ACCOUNT_ACTIVATED',
        reason: 'Onboarding checks completed',
        requestId: 'account-activate-request',
      },
      {
        action: 'ACCOUNT_SUSPENDED',
        reason: 'Controlled lifecycle test',
        requestId: 'account-suspend-request',
      },
      {
        action: 'ACCOUNT_ACTIVATED',
        reason: 'Controlled lifecycle recovery',
        requestId: 'account-reactivate-request',
      },
    ];
    for (const event of expectedEvents) {
      expect(
        await database.models.auditEvent.countDocuments({
          tenantId: accountTenantId,
          actorUserId: ids.admin,
          actorType: 'INTERNAL_USER',
          entityType: 'account',
          entityId: accountId,
          ...event,
        }),
      ).toBe(1);
    }
    expect(
      await database.models.auditEvent.countDocuments({
        tenantId: accountTenantId,
        entityId: accountId,
        action: 'ACCOUNT_ACTIVATED',
      }),
    ).toBe(2);
    expect(
      await database.models.auditEvent.countDocuments({
        tenantId: accountTenantId,
        entityId: accountId,
        action: 'ACCOUNT_SUSPENDED',
      }),
    ).toBe(1);
    expect(
      await database.models.auditEvent.countDocuments({
        requestId: 'account-activate-noop-request',
      }),
    ).toBe(0);
  });

  it('returns more than 100 account audit events without exposing metadata', async () => {
    await database.models.auditEvent.create(
      Array.from({ length: 105 }, (_, index) => ({
        tenantId: accountTenantId,
        actorUserId: ids.admin,
        actorType: 'INTERNAL_USER',
        action: `AUDIT_RETENTION_${index.toString().padStart(3, '0')}`,
        entityType: 'account',
        entityId: accountId,
        metadata: { internalSequence: index },
      })),
    );
    await request(server)
      .get(`/api/v1/backoffice/accounts/${accountId}/audit`)
      .auth(supportToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: { items: Record<string, unknown>[] } }) => {
        const retained = body.items.filter(({ action }) =>
          String(action).startsWith('AUDIT_RETENTION_'),
        );
        expect(retained).toHaveLength(105);
        expect(body.items.length).toBeGreaterThan(100);
        expect(JSON.stringify(body)).not.toContain('internalSequence');
        expect(body.items.every((item) => !('tenantId' in item))).toBe(true);
      });
  });

  it('authorizes tenant profile updates by role and rejects a foreign route slug', async () => {
    const activeHash = await hashPassword(password);
    await database.models.user.updateOne(
      { _id: ownerUserId },
      { $set: { status: 'ACTIVE', passwordHash: activeHash } },
    );
    const ownerToken = await login('owner@example.test');
    await request(server)
      .get('/api/v1/accounts/bee-studio')
      .auth(ownerToken, { type: 'bearer' })
      .expect(200);
    await request(server)
      .get('/api/v1/accounts/not-bee-studio')
      .auth(ownerToken, { type: 'bearer' })
      .expect(404);
    await request(server)
      .patch('/api/v1/accounts/bee-studio/public-profile')
      .auth(staffToken, { type: 'bearer' })
      .send({ headline: 'Denied' })
      .expect(403);
    await request(server)
      .patch('/api/v1/accounts/not-bee-studio/public-profile')
      .auth(ownerToken, { type: 'bearer' })
      .send({ headline: 'Foreign slug' })
      .expect(404);
    await request(server)
      .patch('/api/v1/accounts/bee-studio/public-profile')
      .auth(ownerToken, { type: 'bearer' })
      .set('x-request-id', 'profile-update-request')
      .send({
        headline: 'Book with Bee Studio',
        contactInfo: { website: 'https://example.test' },
        bookingEnabled: false,
      })
      .expect(200)
      .expect(({ body }: { body: { publicBookingEnabled: boolean } }) =>
        expect(body.publicBookingEnabled).toBe(true),
      );
    expect(
      await database.models.location.countDocuments({
        tenantId: accountTenantId,
        publicBookingEnabled: true,
      }),
    ).toBe(1);
    expect(
      await database.models.account.exists({
        _id: accountId,
        publicBookingEnabled: true,
      }),
    ).not.toBeNull();
    expect(
      await database.models.accountPublicProfile.exists({
        accountId,
        bookingEnabled: false,
      }),
    ).not.toBeNull();
    const profileEvents = await database.models.auditEvent
      .find({
        tenantId: accountTenantId,
        entityId: accountId,
        action: 'PUBLIC_PROFILE_UPDATED',
      })
      .lean();
    expect(profileEvents).toHaveLength(1);
    expect(profileEvents[0]).toMatchObject({
      actorType: 'TENANT_USER',
      actorUserId: ownerUserId,
      entityType: 'account',
      entityId: accountId,
      requestId: 'profile-update-request',
    });
    expect(profileEvents[0].reason ?? null).toBeNull();
  });

  it('serves governed context and only active staff with active service ids', async () => {
    const location = await database.models.location
      .findOne({ tenantId: accountTenantId })
      .lean();
    if (!location) throw new Error('Provisioned location not found');
    const activeService = await database.models.service.create({
      tenantId: accountTenantId,
      name: 'Active service',
      durationMinutes: 30,
    });
    const inactiveService = await database.models.service.create({
      tenantId: accountTenantId,
      name: 'Inactive service',
      durationMinutes: 30,
      active: false,
    });
    const activeStaff = await database.models.staff.create({
      tenantId: accountTenantId,
      locationId: location._id,
      displayName: 'Public professional',
    });
    const inactiveStaff = await database.models.staff.create({
      tenantId: accountTenantId,
      locationId: location._id,
      displayName: 'Private professional',
      active: false,
    });
    await database.models.staffService.create([
      {
        tenantId: accountTenantId,
        staffId: activeStaff._id,
        serviceId: activeService._id,
      },
      {
        tenantId: accountTenantId,
        staffId: activeStaff._id,
        serviceId: inactiveService._id,
      },
      {
        tenantId: accountTenantId,
        staffId: inactiveStaff._id,
        serviceId: activeService._id,
      },
    ]);

    await request(server)
      .get('/api/v1/public/bee-studio/context')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) =>
        expect(body).toMatchObject({
          name: 'Bee Studio',
          slug: 'bee-studio',
          headline: 'Book with Bee Studio',
          bookingEnabled: false,
        }),
      );
    await request(server)
      .get('/api/v1/public/bee-studio/staff')
      .expect(200)
      .expect(
        ({
          body,
        }: {
          body: {
            items: { id: string; serviceIds: string[]; email?: string }[];
          };
        }) => {
          expect(body.items).toEqual([
            {
              id: activeStaff._id,
              locationId: location._id,
              displayName: 'Public professional',
              serviceIds: [activeService._id],
            },
          ]);
          expect(JSON.stringify(body)).not.toContain('owner@example.test');
        },
      );
  });

  it('keeps account/profile schemas strict and their one-to-one indexes unique', async () => {
    expect(
      () =>
        new database.models.account({
          businessName: 'Strict Test',
          slug: 'strict-test',
          status: 'ACTIVE',
          ownerUserId,
          tenantId: accountTenantId,
          phone: '+573001234568',
          publicBookingEnabled: true,
          authorityTenantId: ids.tenant,
        }),
    ).toThrow(/strict mode/i);
    await expect(
      database.models.accountPublicProfile.create({
        accountId,
        headline: 'Duplicate',
        description: '',
        theme: 'default',
        contactInfo: {},
        bookingEnabled: true,
      }),
    ).rejects.toMatchObject({ code: 11000 });
    const accountIndexes = await database.models.account.collection.indexes();
    const profileIndexes =
      await database.models.accountPublicProfile.collection.indexes();
    expect(accountIndexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        INDEX_NAMES.accountSlug,
        INDEX_NAMES.accountTenant,
      ]),
    );
    expect(profileIndexes.map(({ name }) => name)).toContain(
      INDEX_NAMES.accountPublicProfile,
    );
  });
});

async function seedOperators(database: DatabaseService): Promise<void> {
  const passwordHash = await hashPassword(password);
  await database.models.tenant.create({
    _id: ids.tenant,
    name: 'Legacy Tenant',
    slug: 'legacy-tenant',
  });
  await database.models.user.create([
    {
      _id: ids.admin,
      email: 'admin@example.test',
      displayName: 'Admin',
      passwordHash,
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_ADMIN',
    },
    {
      _id: ids.support,
      email: 'support@example.test',
      displayName: 'Support',
      passwordHash,
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_SUPPORT',
    },
    {
      _id: ids.tenantUser,
      email: 'legacy-owner@example.test',
      displayName: 'Legacy Owner',
      passwordHash,
      actorType: 'TENANT',
    },
    {
      _id: ids.staffUser,
      email: 'legacy-staff@example.test',
      displayName: 'Legacy Staff',
      passwordHash,
      actorType: 'TENANT',
    },
  ]);
  await database.models.tenantMembership.create([
    {
      _id: ids.tenantMembership,
      tenantId: ids.tenant,
      userId: ids.tenantUser,
      role: 'OWNER',
    },
    {
      _id: ids.staffMembership,
      tenantId: ids.tenant,
      userId: ids.staffUser,
      role: 'STAFF',
    },
  ]);
}
