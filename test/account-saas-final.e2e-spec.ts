import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { syncClockIndexes } from '../src/database/models';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const admin = {
  id: 'f0000000-0000-4000-8000-000000000001',
  email: 'platform-admin@saas-final.test',
  password: 'platform-admin-password',
};
const accountPayload = {
  businessName: 'Final Bee Studio',
  slug: 'final-bee-studio',
  ownerEmail: 'owner@saas-final.test',
  ownerPhone: '+573001234599',
  planCode: 'PRO',
  status: 'ACTIVE',
  publicBookingEnabled: true,
  locationName: 'Final Main Studio',
  timezone: 'America/Bogota',
};
const delegatedReason = 'Complete the connected SaaS onboarding scenario';
const availabilityDate = '2099-09-07';
const appointmentStartsAt = '2099-09-07T14:00:00.000Z';

describe('Account SaaS final connected scenario (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let database: DatabaseService;

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    server = testApp.server;
    database = testApp.database;
    await database.assertReplicaSet();
    await clearMongo(database);
    await syncClockIndexes(database.connection);
    await database.models.user.create({
      _id: admin.id,
      email: admin.email,
      displayName: 'Final Platform Admin',
      passwordHash: await hashPassword(admin.password),
      actorType: 'INTERNAL',
      internalRole: 'PLATFORM_ADMIN',
    });
  });

  afterAll(async () => app.close());

  it('provisions, operates through delegation, books publicly, audits, and revokes', async () => {
    const loginResponse = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password })
      .expect(200);
    const adminToken = (loginResponse.body as { accessToken: string })
      .accessToken;

    const provisioned = await request(server)
      .post('/api/v1/backoffice/accounts')
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-account-create')
      .send(accountPayload)
      .expect(201);
    const account = provisioned.body as {
      id: string;
      tenantId: string;
      slug: string;
      owner: { id: string; email: string; status: string };
      publicProfile: { bookingEnabled: boolean };
    };
    expect(account).toMatchObject({
      slug: accountPayload.slug,
      owner: {
        email: accountPayload.ownerEmail,
        status: 'PENDING_ACTIVATION',
      },
      publicProfile: { bookingEnabled: true },
    });

    const location = await database.models.location
      .findOne({ tenantId: account.tenantId })
      .lean()
      .exec();
    if (!location) throw new Error('Provisioned location not found');
    expect(
      await Promise.all([
        database.models.account.countDocuments({
          _id: account.id,
          tenantId: account.tenantId,
          ownerUserId: account.owner.id,
          status: 'ACTIVE',
        }),
        database.models.tenant.countDocuments({
          _id: account.tenantId,
          slug: accountPayload.slug,
          status: 'ACTIVE',
        }),
        database.models.user.countDocuments({
          _id: account.owner.id,
          email: accountPayload.ownerEmail,
          actorType: 'TENANT',
          status: 'PENDING_ACTIVATION',
        }),
        database.models.tenantMembership.countDocuments({
          tenantId: account.tenantId,
          userId: account.owner.id,
          role: 'OWNER',
        }),
        database.models.accountPublicProfile.countDocuments({
          accountId: account.id,
          bookingEnabled: true,
        }),
        database.models.auditEvent.countDocuments({
          entityType: 'account',
          entityId: account.id,
          action: 'ACCOUNT_CREATED',
          actorUserId: admin.id,
          actorType: 'INTERNAL_USER',
        }),
      ]),
    ).toEqual([1, 1, 1, 1, 1, 1]);

    const startedResponse = await request(server)
      .post(`/api/v1/backoffice/accounts/${account.id}/delegated-sessions`)
      .auth(adminToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-delegated-start')
      .send({ reason: delegatedReason })
      .expect(201);
    const started = startedResponse.body as {
      id: string;
      exchangeCode: string;
    };
    const exchangedResponse = await request(server)
      .post('/api/v1/auth/delegated-sessions/exchange')
      .send({ exchangeCode: started.exchangeCode })
      .expect(200);
    const exchanged = exchangedResponse.body as {
      accessToken: string;
      user: {
        userId: string;
        actorType: string;
        tenantRole: string;
        tenant: { id: string; slug: string };
        delegatedSession: { id: string; reason: string };
      };
    };
    const delegatedToken = exchanged.accessToken;
    expect(exchanged.user).toMatchObject({
      userId: admin.id,
      actorType: 'DELEGATED',
      tenantRole: 'OWNER',
      tenant: { id: account.tenantId, slug: accountPayload.slug },
      delegatedSession: { id: started.id, reason: delegatedReason },
    });
    expect(
      await database.models.tenantMembership.countDocuments({
        userId: admin.id,
      }),
    ).toBe(0);

    const serviceResponse = await request(server)
      .post('/api/v1/services')
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-service-create')
      .send({
        name: 'Final Consultation',
        description: 'Connected final scenario service',
        durationMinutes: 30,
        priceMinor: 90000,
        currency: 'COP',
      })
      .expect(201);
    const service = serviceResponse.body as { id: string };
    const staffResponse = await request(server)
      .post('/api/v1/staff')
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-staff-create')
      .send({
        locationId: location._id,
        displayName: 'Final Professional',
      })
      .expect(201);
    const staff = staffResponse.body as { id: string };
    await request(server)
      .post(`/api/v1/staff/${staff.id}/services`)
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-service-assign')
      .send({ serviceId: service.id })
      .expect(201);
    await request(server)
      .post('/api/v1/schedules')
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-schedule-create')
      .send({
        locationId: location._id,
        staffId: staff.id,
        dayOfWeek: 1,
        startsAt: '09:00',
        endsAt: '12:00',
      })
      .expect(201);
    await request(server)
      .patch(`/api/v1/accounts/${account.slug}/public-profile`)
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-profile-update')
      .send({
        headline: 'Book the final connected experience',
        description: 'A profile configured through delegated administration.',
        contactInfo: { website: 'https://final-bee.example.test' },
        bookingEnabled: true,
      })
      .expect(200);

    await request(server)
      .get(`/api/v1/public/${account.slug}/context`)
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) =>
        expect(body).toMatchObject({
          name: accountPayload.businessName,
          slug: account.slug,
          headline: 'Book the final connected experience',
          bookingEnabled: true,
          locations: [
            expect.objectContaining({
              id: location._id,
              timezone: accountPayload.timezone,
            }),
          ],
        }),
      );
    await request(server)
      .get(`/api/v1/public/${account.slug}/services`)
      .expect(200)
      .expect(({ body }: { body: { items: { id: string }[] } }) =>
        expect(body.items).toEqual([
          expect.objectContaining({ id: service.id, durationMinutes: 30 }),
        ]),
      );
    await request(server)
      .get(`/api/v1/public/${account.slug}/staff`)
      .expect(200)
      .expect(({ body }: { body: { items: { id: string }[] } }) =>
        expect(body.items).toEqual([
          expect.objectContaining({
            id: staff.id,
            locationId: location._id,
            serviceIds: [service.id],
          }),
        ]),
      );
    const availabilityResponse = await request(server)
      .get(`/api/v1/public/${account.slug}/availability`)
      .query({
        locationId: location._id,
        serviceId: service.id,
        staffId: staff.id,
        date: availabilityDate,
      })
      .expect(200);
    expect(
      (availabilityResponse.body as { items: { startsAt: string }[] }).items,
    ).toContainEqual(
      expect.objectContaining({
        startsAt: appointmentStartsAt,
        endsAt: '2099-09-07T14:30:00.000Z',
      }),
    );

    const appointmentResponse = await request(server)
      .post(`/api/v1/public/${account.slug}/appointments`)
      .send({
        locationId: location._id,
        serviceId: service.id,
        staffId: staff.id,
        customerName: 'Final Public Customer',
        customerPhone: '+573009998877',
        customerEmail: 'customer@saas-final.test',
        startsAt: appointmentStartsAt,
        idempotencyKey: 'saas-final-public-appointment',
      })
      .expect(201);
    const appointment = appointmentResponse.body as {
      id: string;
      managementToken: string;
    };
    expect(appointment.managementToken).toMatch(/^[A-Za-z0-9_-]{40,128}$/);
    expect(
      await Promise.all([
        database.models.appointment.countDocuments({
          _id: appointment.id,
          tenantId: account.tenantId,
        }),
        database.models.appointmentIntervalLock.countDocuments({
          tenantId: account.tenantId,
          appointmentId: appointment.id,
        }),
        database.models.customer.countDocuments({
          tenantId: account.tenantId,
          phone: '+573009998877',
        }),
        database.models.auditEvent.countDocuments({
          tenantId: account.tenantId,
          entityType: 'appointment',
          entityId: appointment.id,
          action: 'APPOINTMENT_CREATED',
          actorType: 'CUSTOMER',
        }),
      ]),
    ).toEqual([1, 30, 1, 1]);

    await request(server)
      .get('/api/v1/appointments')
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-appointment-list')
      .expect(200)
      .expect(({ body }: { body: { items: { id: string }[] } }) =>
        expect(body.items).toEqual([
          expect.objectContaining({ id: appointment.id }),
        ]),
      );
    await request(server)
      .post('/api/v1/auth/delegated-sessions/end')
      .auth(delegatedToken, { type: 'bearer' })
      .set('x-request-id', 'saas-final-delegated-end')
      .expect(200)
      .expect(({ body }: { body: { status: string } }) =>
        expect(body.status).toBe('REVOKED'),
      );
    await request(server)
      .get('/api/v1/appointments')
      .auth(delegatedToken, { type: 'bearer' })
      .expect(401);

    const auditResponse = await request(server)
      .get(`/api/v1/backoffice/accounts/${account.id}/audit`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);
    const auditItems = (
      auditResponse.body as {
        items: Array<{
          id: string;
          action: string;
          actorType: string;
          actorUserId: string | null;
          entityType: string;
          entityId: string;
          reason: string | null;
          requestId: string | null;
          createdAt: string;
        }>;
      }
    ).items;
    for (const action of [
      'ACCOUNT_CREATED',
      'DELEGATED_SESSION_STARTED',
      'DELEGATED_SESSION_ENDED',
      'PUBLIC_PROFILE_UPDATED',
    ]) {
      expect(auditItems).toContainEqual(
        expect.objectContaining({ action, actorType: 'INTERNAL_USER' }),
      );
    }
    expect(auditItems).toContainEqual(
      expect.objectContaining({
        action: 'DELEGATED_ACTION_COMPLETED',
        actorType: 'INTERNAL_USER',
      }),
    );
    expect(auditItems).toContainEqual(
      expect.objectContaining({
        action: 'APPOINTMENT_CREATED',
        actorType: 'CUSTOMER',
        actorUserId: null,
        entityType: 'appointment',
        entityId: appointment.id,
        reason: null,
        requestId: null,
      }),
    );
    for (const item of auditItems) {
      expect(Object.keys(item).sort()).toEqual([
        'action',
        'actorType',
        'actorUserId',
        'createdAt',
        'entityId',
        'entityType',
        'id',
        'reason',
        'requestId',
      ]);
    }
    expect(JSON.stringify(auditResponse.body)).not.toMatch(
      /metadata|accessToken|exchangeCode|managementToken/i,
    );

    const requiredAccountEvents = await database.models.auditEvent
      .find({
        tenantId: account.tenantId,
        entityType: 'account',
        entityId: account.id,
        action: {
          $in: [
            'ACCOUNT_CREATED',
            'DELEGATED_SESSION_STARTED',
            'DELEGATED_SESSION_ENDED',
            'PUBLIC_PROFILE_UPDATED',
          ],
        },
      })
      .lean()
      .exec();
    expect(requiredAccountEvents).toHaveLength(4);
    for (const event of requiredAccountEvents) {
      expect(event).toMatchObject({
        actorUserId: admin.id,
        actorType: 'INTERNAL_USER',
      });
    }
    const delegatedProvenance = await database.models.auditEvent
      .findOne({
        tenantId: account.tenantId,
        action: 'DELEGATED_ACTION_COMPLETED',
        entityType: 'delegated_session',
        entityId: started.id,
        requestId: 'saas-final-profile-update',
      })
      .lean()
      .exec();
    expect(delegatedProvenance).toMatchObject({
      actorUserId: admin.id,
      actorType: 'INTERNAL_USER',
      reason: delegatedReason,
      metadata: {
        sessionId: started.id,
        method: 'PATCH',
        statusCode: 200,
      },
    });
    expect((delegatedProvenance?.metadata as { path: string }).path).toContain(
      'public-profile',
    );
    expect(
      await database.models.delegatedSession.countDocuments({
        _id: started.id,
        platformAdminId: admin.id,
        targetTenantId: account.tenantId,
        status: 'REVOKED',
      }),
    ).toBe(1);
  });
});
