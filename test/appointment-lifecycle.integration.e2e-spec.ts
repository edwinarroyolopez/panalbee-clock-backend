import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR,
  AppointmentStatus,
} from '../src/database/models';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenantA: '7c000000-0000-4000-8000-000000000001',
  locationA: '7c000000-0000-4000-8000-000000000002',
  serviceA: '7c000000-0000-4000-8000-000000000003',
  staffA: '7c000000-0000-4000-8000-000000000004',
  customerA: '7c000000-0000-4000-8000-000000000005',
  ownerA: '7c000000-0000-4000-8000-000000000006',
  tenantB: '7d000000-0000-4000-8000-000000000001',
  locationB: '7d000000-0000-4000-8000-000000000002',
  serviceB: '7d000000-0000-4000-8000-000000000003',
  staffB: '7d000000-0000-4000-8000-000000000004',
  customerB: '7d000000-0000-4000-8000-000000000005',
  ownerB: '7d000000-0000-4000-8000-000000000006',
};

interface AppointmentBody {
  id: string;
  status: AppointmentStatus;
  startedAt: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  requiresOutcome: boolean;
  outcomeState: string;
}

interface TimelineBody {
  items: Array<{ type: string; synthetic?: boolean }>;
}

describe('appointment lifecycle and timeline (integration e2e)', () => {
  let testApp: TestApp;
  let token: string;

  beforeAll(async () => {
    testApp = await startTestApp();
    await seedTenant(testApp.database, {
      tenant: ids.tenantA,
      location: ids.locationA,
      service: ids.serviceA,
      staff: ids.staffA,
      customer: ids.customerA,
      owner: ids.ownerA,
      slug: 'appointment-lifecycle-a',
      email: 'appointment-lifecycle-a@example.test',
      phone: '+12025550701',
    });
    await seedTenant(testApp.database, {
      tenant: ids.tenantB,
      location: ids.locationB,
      service: ids.serviceB,
      staff: ids.staffB,
      customer: ids.customerB,
      owner: ids.ownerB,
      slug: 'appointment-lifecycle-b',
      email: 'appointment-lifecycle-b@example.test',
      phone: '+12025550702',
    });
    token = await login(testApp.server, 'appointment-lifecycle-a@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  it('records creation and preserves a complete synthetic timeline for legacy rows', async () => {
    const created = await request(testApp.server)
      .post('/api/v1/appointments')
      .auth(token, { type: 'bearer' })
      .send({
        locationId: ids.locationA,
        serviceId: ids.serviceA,
        staffId: ids.staffA,
        customerId: ids.customerA,
        startsAt: '2099-09-04T14:00:00Z',
        idempotencyKey: 'lifecycle-created-timeline',
      })
      .expect(201);
    const appointmentId = (created.body as AppointmentBody).id;
    const timeline = await request(testApp.server)
      .get(`/api/v1/appointments/${appointmentId}/timeline`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    const timelineBody = timeline.body as TimelineBody;
    expect(timelineBody.items).toEqual([
      expect.objectContaining({ type: 'CREATED' }),
    ]);
    expect(timelineBody.items[0]).not.toHaveProperty('synthetic');

    const legacyId = await insertAppointment({
      startsAt: new Date(Date.now() + 4 * 60 * 60_000),
      endsAt: new Date(Date.now() + 5 * 60 * 60_000),
    });
    const legacyTimeline = await request(testApp.server)
      .get(`/api/v1/appointments/${legacyId}/timeline`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect((legacyTimeline.body as TimelineBody).items).toEqual([
      expect.objectContaining({ type: 'CREATED', synthetic: true }),
    ]);
  });

  it('starts and completes atomically with exact replay and lock release', async () => {
    const appointmentId = await insertAppointment({
      startsAt: new Date(Date.now() + 10 * 60_000),
      endsAt: new Date(Date.now() + 70 * 60_000),
    });
    await testApp.database.models.appointmentIntervalLock.create({
      tenantId: ids.tenantA,
      staffId: ids.staffA,
      appointmentId,
      intervalStart: new Date(Date.now() + 10 * 60_000),
    });

    const started = await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/start`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-start-command' })
      .expect(200);
    expect(started.body as AppointmentBody).toMatchObject({
      status: 'IN_PROGRESS',
      outcomeState: 'IN_PROGRESS',
      requiresOutcome: false,
    });
    expect((started.body as AppointmentBody).startedAt).toEqual(
      expect.any(String),
    );

    await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/start`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-start-command' })
      .expect(200);
    await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/complete`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: 'lifecycle-start-command',
        note: 'Changed input',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );

    const completed = await request(testApp.server)
      .post(`/api/v1/appointments/${appointmentId}/complete`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: 'lifecycle-complete-command',
        note: 'Service delivered',
      })
      .expect(200);
    expect(completed.body as AppointmentBody).toMatchObject({
      status: 'COMPLETED',
      outcomeState: 'COMPLETED',
      requiresOutcome: false,
    });
    expect((completed.body as AppointmentBody).completedAt).toEqual(
      expect.any(String),
    );
    expect(
      await testApp.database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenantA,
        appointmentId,
      }),
    ).toBe(0);
    expect(
      await testApp.database.models.appointmentTimelineEvent.countDocuments({
        tenantId: ids.tenantA,
        appointmentId,
      }),
    ).toBe(2);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenantA,
        entityId: appointmentId,
      }),
    ).toBe(2);
  });

  it('enforces timing and governed no-show reasons', async () => {
    const futureId = await insertAppointment({
      startsAt: new Date(Date.now() + 2 * 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    await request(testApp.server)
      .post(`/api/v1/appointments/${futureId}/start`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-start-too-early' })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_START_TOO_EARLY'),
      );
    await request(testApp.server)
      .post(`/api/v1/appointments/${futureId}/no-show`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: 'lifecycle-no-show-too-early',
        reason: 'CUSTOMER_DID_NOT_ARRIVE',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_NO_SHOW_TOO_EARLY'),
      );

    const dueId = await insertAppointment({
      startsAt: new Date(Date.now() - 30 * 60_000),
      endsAt: new Date(Date.now() + 30 * 60_000),
    });
    await request(testApp.server)
      .post(`/api/v1/appointments/${dueId}/no-show`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-no-show-other', reason: 'OTHER' })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_NO_SHOW_NOTE_REQUIRED'),
      );
    const noShow = await request(testApp.server)
      .post(`/api/v1/appointments/${dueId}/no-show`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: 'lifecycle-no-show-other',
        reason: 'OTHER',
        note: 'Customer left before check-in',
      })
      .expect(200);
    expect(noShow.body as AppointmentBody).toMatchObject({
      status: 'NO_SHOW',
      outcomeState: 'NO_SHOW',
    });
    await request(testApp.server)
      .post(`/api/v1/appointments/${dueId}/no-show`)
      .auth(token, { type: 'bearer' })
      .send({
        idempotencyKey: 'lifecycle-no-show-other',
        reason: 'OTHER',
        note: 'Contradictory note',
      })
      .expect(409)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('IDEMPOTENCY_KEY_CONFLICT'),
      );
  });

  it('surfaces and resolves overdue appointments without inventing a start', async () => {
    const overdueId = await insertAppointment({
      startsAt: new Date(Date.now() - 2 * 60 * 60_000),
      endsAt: new Date(Date.now() - 60 * 60_000),
    });
    await insertAppointment({
      startsAt: new Date(Date.now() + 2 * 60 * 60_000),
      endsAt: new Date(Date.now() + 3 * 60 * 60_000),
    });
    const listed = await request(testApp.server)
      .get('/api/v1/appointments')
      .query({ attention: 'OUTCOME_REQUIRED' })
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(
      (listed.body as { items: AppointmentBody[] }).items.map(({ id }) => id),
    ).toContain(overdueId);
    expect(
      (listed.body as { items: AppointmentBody[] }).items.every(
        ({ requiresOutcome }) => requiresOutcome,
      ),
    ).toBe(true);
    await request(testApp.server)
      .get('/api/v1/appointments')
      .query({ attention: 'OUTCOME_REQUIRED', status: 'CONFIRMED' })
      .auth(token, { type: 'bearer' })
      .expect(400)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('APPOINTMENT_FILTER_CONFLICT'),
      );

    const completed = await request(testApp.server)
      .post(`/api/v1/appointments/${overdueId}/complete`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-overdue-complete' })
      .expect(200);
    expect(completed.body as AppointmentBody).toMatchObject({
      status: 'COMPLETED',
      requiresOutcome: false,
    });
    const events = await testApp.database.models.appointmentTimelineEvent
      .find({ tenantId: ids.tenantA, appointmentId: overdueId })
      .lean()
      .exec();
    expect(events.map(({ eventType }) => eventType)).toEqual(['COMPLETED']);
    expect(events[0].fromStatus).toBe('CONFIRMED');
  });

  it('serializes concurrent exact replays into one outcome and one event', async () => {
    const appointmentId = await insertAppointment({
      startsAt: new Date(Date.now() - 60 * 60_000),
      endsAt: new Date(Date.now() - 30 * 60_000),
    });
    const path = `/api/v1/appointments/${appointmentId}/no-show`;
    const payload = {
      idempotencyKey: 'lifecycle-concurrent-no-show',
      reason: 'CUSTOMER_DID_NOT_ARRIVE',
    };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(testApp.server)
          .post(path)
          .auth(token, { type: 'bearer' })
          .send(payload),
      ),
    );
    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(
      await testApp.database.models.appointmentTimelineEvent.countDocuments({
        tenantId: ids.tenantA,
        appointmentId,
        eventType: 'NO_SHOW',
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenantA,
        entityId: appointmentId,
        action: 'APPOINTMENT_NO_SHOW',
      }),
    ).toBe(1);
  });

  it('fails closed across tenants and keeps timeline rows append-only', async () => {
    const foreignId = await insertAppointment(
      {
        startsAt: new Date(Date.now() - 2 * 60 * 60_000),
        endsAt: new Date(Date.now() - 60 * 60_000),
      },
      'B',
    );
    await request(testApp.server)
      .post(`/api/v1/appointments/${foreignId}/complete`)
      .auth(token, { type: 'bearer' })
      .send({ idempotencyKey: 'lifecycle-cross-tenant' })
      .expect(404);
    await request(testApp.server)
      .get(`/api/v1/appointments/${foreignId}/timeline`)
      .auth(token, { type: 'bearer' })
      .expect(404);

    const event = await testApp.database.models.appointmentTimelineEvent
      .findOne({ tenantId: ids.tenantA, eventType: 'COMPLETED' })
      .lean()
      .exec();
    expect(event).not.toBeNull();
    await expect(
      testApp.database.models.appointmentTimelineEvent.updateOne(
        { _id: event!._id },
        { $set: { eventType: 'STARTED' } },
      ),
    ).rejects.toThrow(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
    await expect(
      testApp.database.models.appointmentTimelineEvent.deleteOne({
        _id: event!._id,
      }),
    ).rejects.toThrow(APPOINTMENT_TIMELINE_APPEND_ONLY_ERROR);
  });

  async function insertAppointment(
    range: { startsAt: Date; endsAt: Date },
    tenant: 'A' | 'B' = 'A',
  ): Promise<string> {
    const id = randomUUID();
    const isA = tenant === 'A';
    await testApp.database.models.appointment.create({
      _id: id,
      tenantId: isA ? ids.tenantA : ids.tenantB,
      locationId: isA ? ids.locationA : ids.locationB,
      serviceId: isA ? ids.serviceA : ids.serviceB,
      staffId: isA ? ids.staffA : ids.staffB,
      customerId: isA ? ids.customerA : ids.customerB,
      ...range,
      idempotencyKey: `seed-${id}`,
      requestFingerprint: id.replaceAll('-', '').padEnd(64, '0'),
    });
    return id;
  }
});
