import { createHash } from 'node:crypto';
import request from 'supertest';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const a = {
  tenant: '80000000-0000-4000-8000-000000000001',
  location: '80000000-0000-4000-8000-000000000002',
  service: '80000000-0000-4000-8000-000000000003',
  staff: '80000000-0000-4000-8000-000000000004',
  customer: '80000000-0000-4000-8000-000000000005',
  owner: '80000000-0000-4000-8000-000000000006',
};
const b = {
  tenant: '81000000-0000-4000-8000-000000000001',
  location: '81000000-0000-4000-8000-000000000002',
  service: '81000000-0000-4000-8000-000000000003',
  staff: '81000000-0000-4000-8000-000000000004',
  customer: '81000000-0000-4000-8000-000000000005',
  owner: '81000000-0000-4000-8000-000000000006',
};

interface PublicAppointment {
  id: string;
  customerId: string;
  startsAt: string;
  managementToken?: string;
}

describe('booking tenancy and ownership (security e2e)', () => {
  let testApp: TestApp;
  let tokenA: string;

  beforeAll(async () => {
    testApp = await startTestApp();
    await seedTenant(testApp.database, {
      ...a,
      slug: 'booking-security-a',
      email: 'booking-security-a@example.test',
      phone: '+570008000001',
    });
    await seedTenant(testApp.database, {
      ...b,
      slug: 'booking-security-b',
      email: 'booking-security-b@example.test',
      phone: '+570008100001',
    });
    tokenA = await login(testApp.server, 'booking-security-a@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  it('does not read a foreign customer or accept foreign nested IDs', async () => {
    await request(testApp.server)
      .get(`/api/v1/customers/${b.customer}`)
      .auth(tokenA, { type: 'bearer' })
      .expect(404);

    const base = {
      locationId: a.location,
      serviceId: a.service,
      staffId: a.staff,
      customerId: a.customer,
      startsAt: '2026-09-02T14:00:00Z',
      idempotencyKey: 'security-foreign-resource',
    };
    for (const foreign of [
      { locationId: b.location },
      { serviceId: b.service },
      { staffId: b.staff },
      { customerId: b.customer },
    ]) {
      await request(testApp.server)
        .post('/api/v1/appointments')
        .auth(tokenA, { type: 'bearer' })
        .send({ ...base, ...foreign })
        .expect(404)
        .expect(({ body }: { body: { reasonCode: string } }) =>
          expect(body.reasonCode).toBe('APPOINTMENT_RELATION_NOT_FOUND'),
        );
    }

    await request(testApp.server)
      .post('/api/v1/staff')
      .auth(tokenA, { type: 'bearer' })
      .send({ locationId: b.location, displayName: 'Foreign Staff' })
      .expect(404);
    await request(testApp.server)
      .post(`/api/v1/staff/${a.staff}/services`)
      .auth(tokenA, { type: 'bearer' })
      .send({ serviceId: b.service })
      .expect(404);
    await request(testApp.server)
      .post('/api/v1/schedules')
      .auth(tokenA, { type: 'bearer' })
      .send({
        locationId: b.location,
        staffId: a.staff,
        dayOfWeek: 1,
        startsAt: '12:00',
        endsAt: '13:00',
      })
      .expect(404);
  });

  it('rejects client-supplied authority fields under global strict validation', async () => {
    await request(testApp.server)
      .post('/api/v1/services')
      .auth(tokenA, { type: 'bearer' })
      .send({
        name: 'Injected Service',
        durationMinutes: 30,
        tenantId: b.tenant,
      })
      .expect(400)
      .expect(({ body }: { body: unknown }) =>
        expect(JSON.stringify(body)).toContain('tenantId'),
      );
  });

  it('scopes public service and availability reads by active tenant slug', async () => {
    const services = await request(testApp.server)
      .get('/api/v1/public/booking-security-a/services')
      .expect(200);
    expect((services.body as { items: { id: string }[] }).items).toEqual([
      expect.objectContaining({ id: a.service }),
    ]);
    await request(testApp.server)
      .get('/api/v1/public/booking-security-a/availability')
      .query({
        locationId: b.location,
        serviceId: b.service,
        staffId: b.staff,
        date: '2026-09-02',
      })
      .expect(404);

    await testApp.database.models.tenant.updateOne(
      { _id: b.tenant },
      { $set: { status: 'SUSPENDED' } },
    );
    await request(testApp.server)
      .get('/api/v1/public/booking-security-b/services')
      .expect(404);
    await testApp.database.models.tenant.updateOne(
      { _id: b.tenant },
      { $set: { status: 'ACTIVE' } },
    );
  });

  it('stores only a token hash, reuses a customer, and recovers token on replay', async () => {
    const body = {
      locationId: a.location,
      serviceId: a.service,
      staffId: a.staff,
      customerName: 'Public Customer',
      customerPhone: '+12025550888',
      customerEmail: 'PUBLIC@example.test',
      startsAt: '2026-09-02T14:00:00Z',
      idempotencyKey: 'security-public-create-1',
    };
    const created = await request(testApp.server)
      .post('/api/v1/public/booking-security-a/appointments')
      .send(body)
      .expect(201);
    const appointment = created.body as PublicAppointment;
    expect(appointment.managementToken).toEqual(expect.any(String));
    expect(appointment.managementToken!.length).toBeGreaterThanOrEqual(40);

    const stored = await testApp.database.models.appointment
      .findOne({ tenantId: a.tenant, _id: appointment.id })
      .lean()
      .exec();
    expect(stored?.managementTokenHash).toBe(
      createHash('sha256').update(appointment.managementToken!).digest('hex'),
    );
    expect(stored?.managementTokenHash).not.toBe(appointment.managementToken);

    const replay = await request(testApp.server)
      .post('/api/v1/public/booking-security-a/appointments')
      .send(body)
      .expect(201);
    expect(replay.body as PublicAppointment).toMatchObject({
      id: appointment.id,
    });
    expect((replay.body as PublicAppointment).managementToken).toBe(
      appointment.managementToken,
    );
    expect(
      await testApp.database.models.customer.countDocuments({
        tenantId: a.tenant,
        phone: body.customerPhone,
      }),
    ).toBe(1);
  });

  it('requires slug and opaque token ownership for list, cancel, and reschedule', async () => {
    const first = await testApp.database.models.appointment
      .findOne({
        tenantId: a.tenant,
        idempotencyKey: 'security-public-create-1',
      })
      .lean()
      .exec();
    const tokenCannotBeRecovered = first!.managementTokenHash!;
    await request(testApp.server)
      .get('/api/v1/public/booking-security-a/appointments')
      .query({ managementToken: tokenCannotBeRecovered })
      .expect(200)
      .expect({ items: [] });

    const second = await request(testApp.server)
      .post('/api/v1/public/booking-security-a/appointments')
      .send({
        locationId: a.location,
        serviceId: a.service,
        staffId: a.staff,
        customerName: 'Public Customer',
        customerPhone: '+12025550888',
        startsAt: '2026-09-02T15:00:00Z',
        idempotencyKey: 'security-public-create-2',
      })
      .expect(201);
    const appointment = second.body as PublicAppointment;
    const managementToken = appointment.managementToken!;

    await request(testApp.server)
      .get('/api/v1/public/booking-security-a/appointments')
      .query({ managementToken })
      .expect(200)
      .expect(({ body }: { body: { items: PublicAppointment[] } }) =>
        expect(body.items).toEqual([
          expect.objectContaining({
            id: appointment.id,
            locationName: 'Main',
            serviceName: 'Consultation',
            staffName: 'Alex',
            timezone: 'America/Bogota',
            localStartsAt: '2026-09-02T10:00',
            localEndsAt: '2026-09-02T11:00',
          }),
        ]),
      );
    await request(testApp.server)
      .get('/api/v1/public/booking-security-b/appointments')
      .query({ managementToken })
      .expect(200)
      .expect({ items: [] });
    await request(testApp.server)
      .post(
        `/api/v1/public/booking-security-a/appointments/${appointment.id}/reschedule`,
      )
      .send({
        managementToken: `${managementToken}x`,
        startsAt: '2026-09-02T16:00:00Z',
      })
      .expect(404);
    await request(testApp.server)
      .post(
        `/api/v1/public/booking-security-a/appointments/${appointment.id}/reschedule`,
      )
      .send({ managementToken, startsAt: '2026-09-02T16:00:00Z' })
      .expect(200)
      .expect(({ body }: { body: PublicAppointment }) =>
        expect(body.startsAt).toBe('2026-09-02T16:00:00.000Z'),
      );
    await request(testApp.server)
      .post(
        `/api/v1/public/booking-security-b/appointments/${appointment.id}/cancel`,
      )
      .send({ managementToken, reason: 'Wrong tenant slug' })
      .expect(404);
    await request(testApp.server)
      .post(
        `/api/v1/public/booking-security-a/appointments/${appointment.id}/cancel`,
      )
      .send({
        managementToken: `${managementToken}x`,
        reason: 'Wrong management token',
      })
      .expect(404);
    await request(testApp.server)
      .post(
        `/api/v1/public/booking-security-a/appointments/${appointment.id}/cancel`,
      )
      .send({ managementToken, reason: 'Public customer requested this' })
      .expect(200);
  });
});
