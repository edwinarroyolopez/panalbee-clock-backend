import request from 'supertest';
import { DateTime } from 'luxon';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';
import { RecordingChannelAdapter } from './channel-test-support';

const ids = {
  tenant: '70000000-0000-4000-8000-000000000001',
  location: '70000000-0000-4000-8000-000000000002',
  service: '70000000-0000-4000-8000-000000000003',
  staff: '70000000-0000-4000-8000-000000000004',
  customer: '70000000-0000-4000-8000-000000000005',
  owner: '70000000-0000-4000-8000-000000000006',
  orphanLockOwner: '70000000-0000-4000-8000-000000000007',
};

interface AppointmentBody {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  notificationStatus?: string;
  notificationErrorCode?: string | null;
}

describe('appointments (integration e2e)', () => {
  const adapter = new RecordingChannelAdapter();
  let testApp: TestApp;
  let token: string;
  let firstAppointmentId: string;
  let rescheduledAppointmentId: string;

  beforeAll(async () => {
    testApp = await startTestApp([adapter]);
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.customer,
      owner: ids.owner,
      slug: 'booking-integration',
      email: 'booking-integration@example.test',
      phone: '+570007000001',
    });
    token = await login(testApp.server, 'booking-integration@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  const payload = {
    locationId: ids.location,
    serviceId: ids.service,
    staffId: ids.staff,
    customerId: ids.customer,
    startsAt: '2099-09-01T14:00:00Z',
    idempotencyKey: 'booking-integration-create-1',
    notes: 'First visit',
  };

  it('creates with authoritative duration and confirmation intent atomically', async () => {
    const response = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send(payload)
      .expect(201);
    const appointment = response.body as AppointmentBody;
    firstAppointmentId = appointment.id;

    expect(appointment).toMatchObject({
      status: 'CONFIRMED',
      startsAt: '2099-09-01T14:00:00.000Z',
      endsAt: '2099-09-01T15:00:00.000Z',
    });
    expect(
      await testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment.id,
        type: 'BOOKING_CONFIRMATION',
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment.id,
      }),
    ).toBe(60);
  });

  it('returns the existing appointment for the same idempotent request', async () => {
    const replay = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send(payload)
      .expect(201);

    expect((replay.body as AppointmentBody).id).toBe(firstAppointmentId);
    expect(
      await testApp.database.models.appointment.countDocuments({
        tenantId: ids.tenant,
        idempotencyKey: payload.idempotencyKey,
      }),
    ).toBe(1);
  });

  it('rejects a changed payload under the same idempotency key', async () => {
    await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({ ...payload, startsAt: '2099-09-01T15:00:00Z' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );
  });

  it('lists only tenant appointments and cancellation releases the slot', async () => {
    const before = await request(testApp.server)
      .get('/api/v1/availability')
      .auth(token, { type: 'bearer' })
      .query({
        locationId: ids.location,
        serviceId: ids.service,
        staffId: ids.staff,
        date: '2099-09-01',
      })
      .expect(200);
    expect(JSON.stringify(before.body)).not.toContain(
      '2099-09-01T14:00:00.000Z',
    );

    const cancellation = await request(testApp.server)
      .post(`/api/v1/appointments/${firstAppointmentId}/cancel`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Customer requested cancellation' })
      .expect(200)
      .expect(({ body }: { body: AppointmentBody }) =>
        expect(body.status).toBe('CANCELLED'),
      );
    expect(cancellation.body).toMatchObject({
      notificationStatus: 'SENT',
      notificationErrorCode: null,
    });
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]).toMatchObject({
      externalAccountId: 'test-whatsapp-account',
      recipientId: '+570007000001',
      intent: {
        kind: 'TEMPLATE',
        name: 'clock_appointment_cancelled',
        language: 'es_CO',
      },
    });
    expect(
      (adapter.sent[0].intent as { variables: string[] }).variables[3],
    ).toBe('Customer requested cancellation');
    const cancellationCounts = await Promise.all([
      testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId: firstAppointmentId,
        type: 'BOOKING_CANCELLED',
      }),
      testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        entityId: firstAppointmentId,
        action: 'APPOINTMENT_CANCELLED',
      }),
    ]);
    await request(testApp.server)
      .post(`/api/v1/appointments/${firstAppointmentId}/cancel`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Customer requested cancellation' })
      .expect(200)
      .expect(({ body }: { body: AppointmentBody }) =>
        expect(body.status).toBe('CANCELLED'),
      );
    await request(testApp.server)
      .post(`/api/v1/appointments/${firstAppointmentId}/cancel`)
      .auth(token, { type: 'bearer' })
      .send({ reason: 'A contradictory cancellation reason' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_NOT_ACTIVE'),
      );
    expect(
      await Promise.all([
        testApp.database.models.notification.countDocuments({
          tenantId: ids.tenant,
          appointmentId: firstAppointmentId,
          type: 'BOOKING_CANCELLED',
        }),
        testApp.database.models.auditEvent.countDocuments({
          tenantId: ids.tenant,
          entityId: firstAppointmentId,
          action: 'APPOINTMENT_CANCELLED',
        }),
      ]),
    ).toEqual(cancellationCounts);
    expect(
      await testApp.database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenant,
        appointmentId: firstAppointmentId,
      }),
    ).toBe(0);

    const after = await request(testApp.server)
      .get('/api/v1/availability')
      .auth(token, { type: 'bearer' })
      .query({
        locationId: ids.location,
        serviceId: ids.service,
        staffId: ids.staff,
        date: '2099-09-01',
      })
      .expect(200);
    expect(JSON.stringify(after.body)).toContain('2099-09-01T14:00:00.000Z');

    const listed = await request(testApp.server)
      .get('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((listed.body as { items: AppointmentBody[] }).items).toEqual([
      expect.objectContaining({ id: firstAppointmentId, status: 'CANCELLED' }),
    ]);
  });

  it('reschedules with authoritative duration and durable lifecycle intent', async () => {
    const created = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({
        ...payload,
        idempotencyKey: 'booking-integration-create-2',
      })
      .expect(201);
    const appointmentId = (created.body as AppointmentBody).id;
    rescheduledAppointmentId = appointmentId;

    await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .auth(token, { type: 'bearer' })
      .send({ startsAt: '2099-09-01T16:00:00Z' })
      .expect(400);

    const response = await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .auth(token, { type: 'bearer' })
      .send({
        startsAt: '2099-09-01T16:00:00Z',
        reason: 'Team member became unavailable',
      })
      .expect(200);
    expect(response.body as AppointmentBody).toMatchObject({
      startsAt: '2099-09-01T16:00:00.000Z',
      endsAt: '2099-09-01T17:00:00.000Z',
      notificationStatus: 'SENT',
    });
    expect(adapter.sent.at(-1)?.intent).toMatchObject({
      kind: 'TEMPLATE',
      name: 'clock_appointment_rescheduled',
      language: 'es_CO',
    });
    expect(
      (adapter.sent.at(-1)?.intent as { variables?: readonly string[] })
        .variables,
    ).toContain('Team member became unavailable');
    const lifecycleCounts = await Promise.all([
      testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId,
        type: 'BOOKING_RESCHEDULED',
      }),
      testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        entityId: appointmentId,
        action: 'APPOINTMENT_RESCHEDULED',
      }),
    ]);
    await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .auth(token, { type: 'bearer' })
      .send({
        startsAt: '2099-09-01T16:00:00Z',
        reason: 'Team member became unavailable',
      })
      .expect(200)
      .expect(({ body }: { body: AppointmentBody }) =>
        expect(body.startsAt).toBe('2099-09-01T16:00:00.000Z'),
      );
    expect(
      await Promise.all([
        testApp.database.models.notification.countDocuments({
          tenantId: ids.tenant,
          appointmentId,
          type: 'BOOKING_RESCHEDULED',
        }),
        testApp.database.models.auditEvent.countDocuments({
          tenantId: ids.tenant,
          entityId: appointmentId,
          action: 'APPOINTMENT_RESCHEDULED',
        }),
      ]),
    ).toEqual(lifecycleCounts);

    const effects = await testApp.database.models.notification
      .find({ tenantId: ids.tenant, appointmentId })
      .sort({ type: 1 })
      .lean()
      .exec();
    expect(effects.map((item) => item.type)).toEqual([
      'BOOKING_CONFIRMATION',
      'BOOKING_RESCHEDULED',
    ]);
    const locks = await testApp.database.models.appointmentIntervalLock
      .find({ tenantId: ids.tenant, appointmentId })
      .sort({ intervalStart: 1 })
      .lean()
      .exec();
    expect(locks).toHaveLength(60);
    expect(locks[0].intervalStart.toISOString()).toBe(
      '2099-09-01T16:00:00.000Z',
    );
    expect(locks.at(-1)?.intervalStart.toISOString()).toBe(
      '2099-09-01T16:59:00.000Z',
    );
  });

  it('rejects create and reschedule timestamps in the system-clock past', async () => {
    const pastStartsAt = DateTime.now()
      .setZone('America/Bogota')
      .minus({ days: 1 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 })
      .toUTC()
      .toISO()!;
    await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({
        ...payload,
        startsAt: pastStartsAt,
        idempotencyKey: 'booking-integration-past-create',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_STARTS_AT_PAST'),
      );
    await request(testApp.server)
      .post(`/api/v1/appointments/${rescheduledAppointmentId}/reschedule`)
      .auth(token, { type: 'bearer' })
      .send({ startsAt: pastStartsAt, reason: 'Unexpected closure' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_STARTS_AT_PAST'),
      );
    expect(
      await testApp.database.models.appointment.countDocuments({
        tenantId: ids.tenant,
        idempotencyKey: 'booking-integration-past-create',
      }),
    ).toBe(0);
  });

  it('rolls back a conflicting lock replacement and preserves the old time', async () => {
    const created = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({
        ...payload,
        startsAt: '2099-09-01T18:00:00Z',
        idempotencyKey: 'booking-integration-create-3',
      })
      .expect(201);
    const appointmentId = (created.body as AppointmentBody).id;
    await testApp.database.models.appointmentIntervalLock.create({
      tenantId: ids.tenant,
      staffId: ids.staff,
      appointmentId: ids.orphanLockOwner,
      intervalStart: new Date('2099-09-01T19:30:00Z'),
    });

    await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/reschedule`)
      .auth(token, { type: 'bearer' })
      .send({
        startsAt: '2099-09-01T19:15:00Z',
        reason: 'Unexpected closure',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_SLOT_CONFLICT'),
      );

    const appointment = await testApp.database.models.appointment
      .findById(appointmentId)
      .lean()
      .exec();
    expect(appointment?.startsAt.toISOString()).toBe(
      '2099-09-01T18:00:00.000Z',
    );
    const locks = await testApp.database.models.appointmentIntervalLock
      .find({ tenantId: ids.tenant, appointmentId })
      .sort({ intervalStart: 1 })
      .lean()
      .exec();
    expect(locks).toHaveLength(60);
    expect(locks[0].intervalStart.toISOString()).toBe(
      '2099-09-01T18:00:00.000Z',
    );
    expect(locks.at(-1)?.intervalStart.toISOString()).toBe(
      '2099-09-01T18:59:00.000Z',
    );
    expect(
      await testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId,
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        entityId: appointmentId,
      }),
    ).toBe(1);
  });

  it('keeps the appointment change and reports a failed notification honestly', async () => {
    const created = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({
        ...payload,
        startsAt: '2099-09-01T20:00:00Z',
        idempotencyKey: 'booking-integration-notification-failure',
      })
      .expect(201);
    adapter.failuresRemaining = 1;

    const cancelled = await request(testApp.server)
      .post(
        `/api/v1/appointments/${(created.body as AppointmentBody).id}/cancel`,
      )
      .auth(token, { type: 'bearer' })
      .send({ reason: 'Unexpected building closure' })
      .expect(200);

    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      notificationStatus: 'FAILED',
      notificationErrorCode: 'CHANNEL_DELIVERY_UNAVAILABLE',
    });
  });
});
