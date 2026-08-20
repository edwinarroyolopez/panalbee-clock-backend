import request from 'supertest';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: '90000000-0000-4000-8000-000000000001',
  location: '90000000-0000-4000-8000-000000000002',
  service: '90000000-0000-4000-8000-000000000003',
  staff: '90000000-0000-4000-8000-000000000004',
  customerA: '90000000-0000-4000-8000-000000000005',
  owner: '90000000-0000-4000-8000-000000000006',
  customerB: '90000000-0000-4000-8000-000000000007',
};

describe('appointment confirmation (concurrency e2e)', () => {
  let testApp: TestApp;
  let token: string;

  beforeAll(async () => {
    testApp = await startTestApp();
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.customerA,
      owner: ids.owner,
      slug: 'booking-concurrency',
      email: 'booking-concurrency@example.test',
      phone: '+570009000001',
    });
    await testApp.database.models.customer.create({
      _id: ids.customerB,
      tenantId: ids.tenant,
      fullName: 'Grace Customer',
      phone: '+570009000002',
    });
    token = await login(testApp.server, 'booking-concurrency@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  it('allows exactly one of two partially overlapping concurrent requests', async () => {
    const common = {
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
    };
    const responses = await Promise.all([
      request(testApp.server)
        .post('/api/v1/appointments')
        .auth(token, { type: 'bearer' })
        .send({
          ...common,
          customerId: ids.customerA,
          startsAt: '2099-09-03T14:00:00Z',
          idempotencyKey: 'concurrent-confirmation-a',
        }),
      request(testApp.server)
        .post('/api/v1/appointments')
        .auth(token, { type: 'bearer' })
        .send({
          ...common,
          customerId: ids.customerB,
          startsAt: '2099-09-03T14:15:00Z',
          idempotencyKey: 'concurrent-confirmation-b',
        }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect((conflict.body as { reasonCode: string }).reasonCode).toBe(
      'APPOINTMENT_SLOT_CONFLICT',
    );

    const appointments = await testApp.database.models.appointment
      .find({
        tenantId: ids.tenant,
        staffId: ids.staff,
        idempotencyKey: {
          $in: ['concurrent-confirmation-a', 'concurrent-confirmation-b'],
        },
      })
      .lean()
      .exec();
    expect(appointments).toHaveLength(1);
    const appointment = appointments[0];
    const locks = await testApp.database.models.appointmentIntervalLock
      .find({ tenantId: ids.tenant, appointmentId: appointment._id })
      .sort({ intervalStart: 1 })
      .lean()
      .exec();
    expect(locks).toHaveLength(60);
    expect(
      await testApp.database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenant,
        staffId: ids.staff,
      }),
    ).toBe(60);
    expect(locks[0].intervalStart.toISOString()).toBe(
      appointment.startsAt.toISOString(),
    );
    expect(locks.at(-1)?.intervalStart.getTime()).toBe(
      appointment.endsAt.getTime() - 60_000,
    );
    expect(
      locks.every(
        (lock, index) =>
          lock.intervalStart.getUTCSeconds() === 0 &&
          lock.intervalStart.getUTCMilliseconds() === 0 &&
          lock.intervalStart.getTime() ===
            appointment.startsAt.getTime() + index * 60_000,
      ),
    ).toBe(true);
    expect(
      await testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        type: 'BOOKING_CONFIRMATION',
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        action: 'APPOINTMENT_CREATED',
      }),
    ).toBe(1);
  });

  it('recovers a concurrent public idempotency duplicate with the same token', async () => {
    const body = {
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
      customerName: 'Ada Customer',
      customerPhone: '+570009000001',
      startsAt: '2099-09-04T18:00:00Z',
      idempotencyKey: 'concurrent-public-idempotency',
    };
    const responses = await Promise.all([
      request(testApp.server)
        .post('/api/v1/public/booking-concurrency/appointments')
        .send(body),
      request(testApp.server)
        .post('/api/v1/public/booking-concurrency/appointments')
        .send(body),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    const results = responses.map(
      ({ body: responseBody }) =>
        responseBody as { id: string; managementToken: string },
    );
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(
      new Set(results.map(({ managementToken }) => managementToken)).size,
    ).toBe(1);

    const appointment = await testApp.database.models.appointment
      .findOne({
        tenantId: ids.tenant,
        idempotencyKey: body.idempotencyKey,
      })
      .lean()
      .exec();
    expect(appointment).not.toBeNull();
    expect(
      await testApp.database.models.appointment.countDocuments({
        tenantId: ids.tenant,
        idempotencyKey: body.idempotencyKey,
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.appointmentIntervalLock.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment!._id,
      }),
    ).toBe(60);
    expect(
      await testApp.database.models.notification.countDocuments({
        tenantId: ids.tenant,
        appointmentId: appointment!._id,
        type: 'BOOKING_CONFIRMATION',
      }),
    ).toBe(1);
    expect(
      await testApp.database.models.auditEvent.countDocuments({
        tenantId: ids.tenant,
        entityId: appointment!._id,
        action: 'APPOINTMENT_CREATED',
      }),
    ).toBe(1);
  });

  it('atomically upserts one new public customer for two concurrent bookings', async () => {
    const customerPhone = '+12025550999';
    const common = {
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
      customerName: 'Concurrent New Customer',
      customerPhone,
    };
    const responses = await Promise.all([
      request(testApp.server)
        .post('/api/v1/public/booking-concurrency/appointments')
        .send({
          ...common,
          customerEmail: 'concurrent@example.test',
          startsAt: '2099-09-05T14:00:00Z',
          idempotencyKey: 'concurrent-customer-upsert-a',
        }),
      request(testApp.server)
        .post('/api/v1/public/booking-concurrency/appointments')
        .send({
          ...common,
          startsAt: '2099-09-05T15:00:00Z',
          idempotencyKey: 'concurrent-customer-upsert-b',
        }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);

    const customers = await testApp.database.models.customer
      .find({ tenantId: ids.tenant, phone: customerPhone })
      .lean()
      .exec();
    expect(customers).toHaveLength(1);
    expect(customers[0].email).toBe('concurrent@example.test');
    const appointments = await testApp.database.models.appointment
      .find({
        tenantId: ids.tenant,
        idempotencyKey: {
          $in: ['concurrent-customer-upsert-a', 'concurrent-customer-upsert-b'],
        },
      })
      .lean()
      .exec();
    expect(appointments).toHaveLength(2);
    expect(new Set(appointments.map(({ customerId }) => customerId))).toEqual(
      new Set([customers[0]._id]),
    );
  });
});
