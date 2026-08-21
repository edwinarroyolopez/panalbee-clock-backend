import request from 'supertest';
import { DateTime } from 'luxon';
import {
  login,
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: '60000000-0000-4000-8000-000000000001',
  location: '60000000-0000-4000-8000-000000000002',
  service: '60000000-0000-4000-8000-000000000003',
  staff: '60000000-0000-4000-8000-000000000004',
  customer: '60000000-0000-4000-8000-000000000005',
  owner: '60000000-0000-4000-8000-000000000006',
  appointment: '60000000-0000-4000-8000-000000000007',
  nyTenant: '60000000-0000-4000-8000-000000000011',
  nyLocation: '60000000-0000-4000-8000-000000000012',
  nyService: '60000000-0000-4000-8000-000000000013',
  nyStaff: '60000000-0000-4000-8000-000000000014',
  nyCustomer: '60000000-0000-4000-8000-000000000015',
  nyOwner: '60000000-0000-4000-8000-000000000016',
};

interface Slot {
  staffId: string;
  startsAt: string;
  endsAt: string;
  localStartsAt: string;
  localEndsAt: string;
  timezone: string;
  durationMinutes: number;
}

describe('availability computation (integration e2e)', () => {
  let testApp: TestApp;
  let token: string;

  beforeAll(async () => {
    testApp = await startTestApp();
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.customer,
      owner: ids.owner,
      slug: 'availability-bogota',
      email: 'availability-bogota@example.test',
      phone: '+570006000001',
      scheduleStart: '09:00',
      scheduleEnd: '11:00',
    });
    await seedTenant(testApp.database, {
      tenant: ids.nyTenant,
      location: ids.nyLocation,
      service: ids.nyService,
      staff: ids.nyStaff,
      customer: ids.nyCustomer,
      owner: ids.nyOwner,
      slug: 'availability-new-york',
      email: 'availability-new-york@example.test',
      phone: '+12025550101',
      timezone: 'America/New_York',
      scheduleStart: '09:00',
      scheduleEnd: '10:00',
    });
    token = await login(testApp.server, 'availability-bogota@example.test');
  });

  afterAll(async () => stopTestApp(testApp));

  function publicAvailability(
    slug: string,
    locationId: string,
    serviceId: string,
    staffId: string,
    date: string,
  ) {
    return request(testApp.server)
      .get(`/api/v1/public/${slug}/availability`)
      .query({ locationId, serviceId, staffId, date });
  }

  it('exposes only active public booking context by governed slug', async () => {
    await request(testApp.server)
      .get('/api/v1/public/availability-bogota/context')
      .expect(200)
      .expect(
        ({
          body,
        }: {
          body: { slug: string; locations: { id: string; timezone: string }[] };
        }) =>
          expect(body).toMatchObject({
            slug: 'availability-bogota',
            locations: [
              {
                id: ids.location,
                timezone: 'America/Bogota',
              },
            ],
          }),
      );
    await request(testApp.server)
      .get('/api/v1/public/missing-tenant/context')
      .expect(404);
  });

  it('uses complete service duration at deterministic 15-minute steps', async () => {
    const response = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-24',
    ).expect(200);
    const slots = (response.body as { items: Slot[] }).items;

    expect(slots).toHaveLength(5);
    expect(slots[0]).toMatchObject({
      startsAt: '2099-08-24T14:00:00.000Z',
      endsAt: '2099-08-24T15:00:00.000Z',
      localStartsAt: '2099-08-24T09:00',
      localEndsAt: '2099-08-24T10:00',
      durationMinutes: 60,
    });
    expect(slots.at(-1)?.localStartsAt).toBe('2099-08-24T10:00');
  });

  it('honors staff duration overrides and requires the full interval', async () => {
    await testApp.database.models.staffService.updateOne(
      {
        tenantId: ids.tenant,
        staffId: ids.staff,
        serviceId: ids.service,
      },
      { $set: { durationOverrideMinutes: 45 } },
    );
    const response = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-27',
    ).expect(200);
    const slots = (response.body as { items: Slot[] }).items;

    expect(slots).toHaveLength(6);
    expect(slots[0].durationMinutes).toBe(45);
    expect(slots.at(-1)?.localEndsAt).toBe('2099-08-27T11:00');
    await testApp.database.models.staffService.updateOne(
      {
        tenantId: ids.tenant,
        staffId: ids.staff,
        serviceId: ids.service,
      },
      { $unset: { durationOverrideMinutes: 1 } },
    );
  });

  it('subtracts unavailable exceptions from weekly schedules', async () => {
    await testApp.database.models.availabilityException.create({
      tenantId: ids.tenant,
      locationId: ids.location,
      staffId: ids.staff,
      kind: 'UNAVAILABLE',
      startsAt: new Date('2099-08-25T14:30:00Z'),
      endsAt: new Date('2099-08-25T15:00:00Z'),
    });
    const response = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-25',
    ).expect(200);
    const slots = (response.body as { items: Slot[] }).items;

    expect(slots.map((slot) => slot.localStartsAt)).toEqual([
      '2099-08-25T10:00',
    ]);
  });

  it('excludes pending or confirmed appointments but not boundary-adjacent slots', async () => {
    await testApp.database.models.appointment.create({
      _id: ids.appointment,
      tenantId: ids.tenant,
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
      customerId: ids.customer,
      startsAt: new Date('2099-08-26T14:00:00Z'),
      endsAt: new Date('2099-08-26T15:00:00Z'),
      idempotencyKey: 'availability-existing',
      requestFingerprint: 'x',
    });
    const response = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-26',
    ).expect(200);

    expect((response.body as { items: Slot[] }).items).toEqual([
      expect.objectContaining({ startsAt: '2099-08-26T15:00:00.000Z' }),
    ]);
  });

  it('uses Luxon location timezone conversion for UTC and local labels', async () => {
    const response = await publicAvailability(
      'availability-new-york',
      ids.nyLocation,
      ids.nyService,
      ids.nyStaff,
      '2099-07-02',
    ).expect(200);
    const slot = (response.body as { items: Slot[] }).items[0];

    expect(slot).toMatchObject({
      startsAt: '2099-07-02T13:00:00.000Z',
      endsAt: '2099-07-02T14:00:00.000Z',
      localStartsAt: '2099-07-02T09:00',
      localEndsAt: '2099-07-02T10:00',
      timezone: 'America/New_York',
    });
  });

  it('uses Sunday zero and unions AVAILABLE exceptions outside schedules', async () => {
    const sunday = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-23',
    ).expect(200);
    expect((sunday.body as { items: Slot[] }).items[0].localStartsAt).toBe(
      '2099-08-23T09:00',
    );

    await testApp.database.models.schedule.deleteMany({
      tenantId: ids.tenant,
      staffId: ids.staff,
      dayOfWeek: 5,
    });
    await testApp.database.models.availabilityException.create({
      tenantId: ids.tenant,
      locationId: ids.location,
      staffId: ids.staff,
      kind: 'AVAILABLE',
      startsAt: new Date('2099-08-28T14:00:00Z'),
      endsAt: new Date('2099-08-28T16:00:00Z'),
    });
    const available = await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-28',
    ).expect(200);
    expect((available.body as { items: Slot[] }).items).toHaveLength(5);
  });

  it('advances through a DST gap without inventing local times', async () => {
    await testApp.database.models.schedule.create({
      tenantId: ids.nyTenant,
      locationId: ids.nyLocation,
      staffId: ids.nyStaff,
      dayOfWeek: 0,
      startsAt: '01:00',
      endsAt: '04:00',
    });
    const response = await publicAvailability(
      'availability-new-york',
      ids.nyLocation,
      ids.nyService,
      ids.nyStaff,
      '2099-03-08',
    ).expect(200);
    const transitionSlots = (response.body as { items: Slot[] }).items.filter(
      (slot) => slot.localStartsAt < '2099-03-08T04:00',
    );
    expect(transitionSlots.map((slot) => slot.localStartsAt)).toEqual([
      '2099-03-08T01:00',
      '2099-03-08T01:15',
      '2099-03-08T01:30',
      '2099-03-08T01:45',
      '2099-03-08T03:00',
    ]);
    expect(transitionSlots.at(-1)?.endsAt).toBe('2099-03-08T08:00:00.000Z');
  });

  it('returns only starts after the system clock for public and admin reads', async () => {
    const localNow = DateTime.now().setZone('America/Bogota');
    const yesterday = localNow.minus({ days: 1 }).toISODate()!;
    const today = localNow.toISODate()!;
    const query = {
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
    };

    await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      yesterday,
    )
      .expect(200)
      .expect({ items: [] });
    await request(testApp.server)
      .get('/api/v1/availability')
      .auth(token, { type: 'bearer' })
      .query({ ...query, date: yesterday })
      .expect(200)
      .expect({ items: [] });

    const beforeRequests = Date.now();
    for (const response of [
      await publicAvailability(
        'availability-bogota',
        ids.location,
        ids.service,
        ids.staff,
        today,
      ).expect(200),
      await request(testApp.server)
        .get('/api/v1/availability')
        .auth(token, { type: 'bearer' })
        .query({ ...query, date: today })
        .expect(200),
    ]) {
      const slots = (response.body as { items: Slot[] }).items;
      expect(
        slots.every(({ startsAt }) =>
          Boolean(new Date(startsAt).getTime() > beforeRequests),
        ),
      ).toBe(true);
    }
  });

  it('rejects a non-IANA location timezone', async () => {
    await testApp.database.models.location.updateOne(
      { _id: ids.location, tenantId: ids.tenant },
      { $set: { timezone: 'Invalid/Clock_Zone' } },
    );
    await publicAvailability(
      'availability-bogota',
      ids.location,
      ids.service,
      ids.staff,
      '2099-08-24',
    )
      .expect(422)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('LOCATION_TIMEZONE_INVALID'),
      );
    await testApp.database.models.location.updateOne(
      { _id: ids.location, tenantId: ids.tenant },
      { $set: { timezone: 'America/Bogota' } },
    );
  });
});
