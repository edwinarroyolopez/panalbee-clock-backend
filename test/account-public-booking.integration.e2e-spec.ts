import request from 'supertest';
import {
  seedTenant,
  startTestApp,
  stopTestApp,
  TestApp,
} from './booking-availability-test-app';

const ids = {
  tenant: 'b0000000-0000-4000-8000-000000000001',
  location: 'b0000000-0000-4000-8000-000000000002',
  service: 'b0000000-0000-4000-8000-000000000003',
  staff: 'b0000000-0000-4000-8000-000000000004',
  customer: 'b0000000-0000-4000-8000-000000000005',
  owner: 'b0000000-0000-4000-8000-000000000006',
  account: 'b0000000-0000-4000-8000-000000000007',
  profile: 'b0000000-0000-4000-8000-000000000008',
  secondStaff: 'b0000000-0000-4000-8000-000000000009',
  privateLocation: 'b0000000-0000-4000-8000-00000000000a',
  privateStaff: 'b0000000-0000-4000-8000-00000000000b',
  inactiveStaff: 'b0000000-0000-4000-8000-00000000000c',
  ineligibleStaff: 'b0000000-0000-4000-8000-00000000000d',
  legacyTenant: 'b0000000-0000-4000-8000-000000000011',
  legacyLocation: 'b0000000-0000-4000-8000-000000000012',
  legacyService: 'b0000000-0000-4000-8000-000000000013',
  legacyStaff: 'b0000000-0000-4000-8000-000000000014',
  legacyCustomer: 'b0000000-0000-4000-8000-000000000015',
  legacyOwner: 'b0000000-0000-4000-8000-000000000016',
  emptyTenant: 'b0000000-0000-4000-8000-000000000021',
  emptyLocation: 'b0000000-0000-4000-8000-000000000022',
};

describe('Account public booking policy (integration e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp();
    await seedTenant(testApp.database, {
      tenant: ids.tenant,
      location: ids.location,
      service: ids.service,
      staff: ids.staff,
      customer: ids.customer,
      owner: ids.owner,
      slug: 'managed-booking',
      email: 'managed-booking@example.test',
      phone: '+573002220001',
    });
    await seedTenant(testApp.database, {
      tenant: ids.legacyTenant,
      location: ids.legacyLocation,
      service: ids.legacyService,
      staff: ids.legacyStaff,
      customer: ids.legacyCustomer,
      owner: ids.legacyOwner,
      slug: 'legacy-booking',
      email: 'legacy-booking@example.test',
      phone: '+573002220002',
    });
    await testApp.database.models.account.create({
      _id: ids.account,
      businessName: 'Managed Booking',
      slug: 'managed-booking',
      status: 'ACTIVE',
      ownerUserId: ids.owner,
      tenantId: ids.tenant,
      phone: '+573002220001',
      publicBookingEnabled: true,
    });
    await testApp.database.models.accountPublicProfile.create({
      _id: ids.profile,
      accountId: ids.account,
      headline: 'Managed public profile',
      description: 'Account controlled booking',
      theme: 'default',
      contactInfo: {},
      bookingEnabled: true,
    });
    await testApp.database.models.staff.create({
      _id: ids.secondStaff,
      tenantId: ids.tenant,
      locationId: ids.location,
      displayName: 'Second professional',
    });
    await testApp.database.models.staffService.create({
      tenantId: ids.tenant,
      staffId: ids.secondStaff,
      serviceId: ids.service,
    });
    await testApp.database.models.schedule.create([
      {
        tenantId: ids.tenant,
        locationId: ids.location,
        staffId: ids.secondStaff,
        dayOfWeek: 1,
        startsAt: '09:00',
        endsAt: '17:00',
      },
      {
        tenantId: ids.tenant,
        locationId: ids.location,
        staffId: ids.secondStaff,
        dayOfWeek: 1,
        startsAt: '17:00',
        endsAt: '18:00',
      },
    ]);
    await testApp.database.models.location.create({
      _id: ids.privateLocation,
      tenantId: ids.tenant,
      name: 'Private location',
      timezone: 'America/Bogota',
      publicBookingEnabled: false,
    });
    await testApp.database.models.staff.create({
      _id: ids.privateStaff,
      tenantId: ids.tenant,
      locationId: ids.privateLocation,
      displayName: 'Private professional',
    });
    await testApp.database.models.staffService.create({
      tenantId: ids.tenant,
      staffId: ids.privateStaff,
      serviceId: ids.service,
    });
    await testApp.database.models.schedule.create({
      tenantId: ids.tenant,
      locationId: ids.privateLocation,
      staffId: ids.privateStaff,
      dayOfWeek: 1,
      startsAt: '08:00',
      endsAt: '09:00',
    });
    await testApp.database.models.staff.create([
      {
        _id: ids.inactiveStaff,
        tenantId: ids.tenant,
        locationId: ids.location,
        displayName: 'Inactive professional',
        active: false,
      },
      {
        _id: ids.ineligibleStaff,
        tenantId: ids.tenant,
        locationId: ids.location,
        displayName: 'Ineligible professional',
      },
    ]);
    await testApp.database.models.staffService.create({
      tenantId: ids.tenant,
      staffId: ids.inactiveStaff,
      serviceId: ids.service,
    });
    await testApp.database.models.schedule.create([
      {
        tenantId: ids.tenant,
        locationId: ids.location,
        staffId: ids.inactiveStaff,
        dayOfWeek: 1,
        startsAt: '18:00',
        endsAt: '19:00',
      },
      {
        tenantId: ids.tenant,
        locationId: ids.location,
        staffId: ids.ineligibleStaff,
        dayOfWeek: 1,
        startsAt: '19:00',
        endsAt: '20:00',
      },
    ]);
    await testApp.database.models.tenant.create({
      _id: ids.emptyTenant,
      name: 'Empty legacy tenant',
      slug: 'empty-legacy-booking',
    });
    await testApp.database.models.location.create({
      _id: ids.emptyLocation,
      tenantId: ids.emptyTenant,
      name: 'Empty location',
      timezone: 'America/Bogota',
    });
  });

  afterAll(async () => stopTestApp(testApp));

  function availability(
    slug: string,
    locationId: string,
    serviceId: string,
    staffId: string,
  ) {
    return request(testApp.server)
      .get(`/api/v1/public/${slug}/availability`)
      .query({ locationId, serviceId, staffId, date: '2099-09-14' });
  }

  it('allows an active managed Account and preserves legacy tenant availability', async () => {
    await availability(
      'managed-booking',
      ids.location,
      ids.service,
      ids.staff,
    ).expect(200);
    await availability(
      'legacy-booking',
      ids.legacyLocation,
      ids.legacyService,
      ids.legacyStaff,
    ).expect(200);
    await request(testApp.server)
      .get('/api/v1/public/legacy-booking/context')
      .expect(200)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body).toMatchObject({
          name: 'Tenant legacy-booking',
          slug: 'legacy-booking',
        });
        expect(body).not.toHaveProperty('headline');
      });
  });

  it('keeps Web booking reads available for an eligible legacy tenant without an Account', async () => {
    expect(
      await testApp.database.models.account.countDocuments({
        tenantId: ids.legacyTenant,
      }),
    ).toBe(0);
    await request(testApp.server)
      .get('/api/v1/public/legacy-booking/context')
      .expect(200);
    await request(testApp.server)
      .get('/api/v1/public/legacy-booking/services')
      .expect(200)
      .expect(({ body }: { body: { items: { id: string }[] } }) => {
        expect(body.items.map(({ id }) => id)).toEqual([ids.legacyService]);
      });
    await request(testApp.server)
      .get('/api/v1/public/legacy-booking/staff')
      .expect(200)
      .expect(
        ({
          body,
        }: {
          body: {
            items: { id: string; locationId: string; serviceIds: string[] }[];
          };
        }) => {
          expect(body.items).toEqual([
            expect.objectContaining({
              id: ids.legacyStaff,
              locationId: ids.legacyLocation,
              serviceIds: [ids.legacyService],
            }),
          ]);
        },
      );
    await availability(
      'legacy-booking',
      ids.legacyLocation,
      ids.legacyService,
      ids.legacyStaff,
    ).expect(200);
  });

  it('returns safe grouped business hours for Account and legacy contexts', async () => {
    const managed = await request(testApp.server)
      .get('/api/v1/public/managed-booking/context')
      .expect(200);
    const managedBody = managed.body as {
      locations: { id: string }[];
      businessHours: {
        locationId: string;
        dayOfWeek: number;
        intervals: { startsAt: string; endsAt: string }[];
      }[];
    };

    expect(managedBody.locations).toEqual([
      expect.objectContaining({ id: ids.location }),
    ]);
    expect(managedBody.businessHours).toEqual(
      [
        ...[0, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
          locationId: ids.location,
          dayOfWeek,
          intervals: [{ startsAt: '09:00', endsAt: '17:00' }],
        })),
        {
          locationId: ids.location,
          dayOfWeek: 1,
          intervals: [
            { startsAt: '09:00', endsAt: '17:00' },
            { startsAt: '17:00', endsAt: '18:00' },
          ],
        },
      ].sort((left, right) => left.dayOfWeek - right.dayOfWeek),
    );
    const serializedBusinessHours = JSON.stringify(managedBody.businessHours);
    expect(serializedBusinessHours).not.toContain('tenantId');
    expect(serializedBusinessHours).not.toContain('staffId');
    expect(serializedBusinessHours).not.toContain(ids.secondStaff);
    expect(serializedBusinessHours).not.toContain(ids.privateLocation);
    expect(serializedBusinessHours).not.toContain('19:00');

    await request(testApp.server)
      .get('/api/v1/public/managed-booking/staff')
      .expect(200)
      .expect(({ body }: { body: { items: { id: string }[] } }) => {
        expect(body.items.map(({ id }) => id)).toEqual([
          ids.staff,
          ids.secondStaff,
        ]);
        expect(body.items).not.toContainEqual(
          expect.objectContaining({ id: ids.privateStaff }),
        );
      });

    await request(testApp.server)
      .get('/api/v1/public/legacy-booking/context')
      .expect(200)
      .expect(({ body }: { body: { businessHours: unknown[] } }) => {
        expect(body.businessHours).toHaveLength(7);
      });
    await request(testApp.server)
      .get('/api/v1/public/empty-legacy-booking/context')
      .expect(200)
      .expect(({ body }: { body: { businessHours: unknown[] } }) => {
        expect(body.businessHours).toEqual([]);
      });
  });

  it('blocks availability when either Account or Profile disables booking', async () => {
    await testApp.database.models.accountPublicProfile.updateOne(
      { _id: ids.profile },
      { $set: { bookingEnabled: false } },
    );
    await availability('managed-booking', ids.location, ids.service, ids.staff)
      .expect(404)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('PUBLIC_ACCOUNT_UNAVAILABLE'),
      );
    await testApp.database.models.accountPublicProfile.updateOne(
      { _id: ids.profile },
      { $set: { bookingEnabled: true } },
    );
    await testApp.database.models.account.updateOne(
      { _id: ids.account },
      { $set: { publicBookingEnabled: false } },
    );
    await availability(
      'managed-booking',
      ids.location,
      ids.service,
      ids.staff,
    ).expect(404);
    await testApp.database.models.account.updateOne(
      { _id: ids.account },
      { $set: { publicBookingEnabled: true } },
    );
  });

  it('rechecks effective booking state during public appointment creation', async () => {
    await testApp.database.models.accountPublicProfile.updateOne(
      { _id: ids.profile },
      { $set: { bookingEnabled: false } },
    );
    await request(testApp.server)
      .post('/api/v1/public/managed-booking/appointments')
      .send({
        locationId: ids.location,
        serviceId: ids.service,
        staffId: ids.staff,
        customerName: 'Public Customer',
        customerPhone: '+573009990001',
        startsAt: '2099-09-14T14:00:00Z',
        idempotencyKey: 'managed-booking-disabled',
      })
      .expect(404);
    expect(
      await testApp.database.models.appointment.countDocuments({
        tenantId: ids.tenant,
        idempotencyKey: 'managed-booking-disabled',
      }),
    ).toBe(0);
    expect(
      await testApp.database.models.customer.countDocuments({
        tenantId: ids.tenant,
        phone: '+573009990001',
      }),
    ).toBe(0);
    await testApp.database.models.accountPublicProfile.updateOne(
      { _id: ids.profile },
      { $set: { bookingEnabled: true } },
    );
  });

  it('hides managed public context when Account lifecycle is not public', async () => {
    await testApp.database.models.account.updateOne(
      { _id: ids.account },
      { $set: { status: 'SUSPENDED' } },
    );
    expect(
      await testApp.database.models.tenant.exists({
        _id: ids.tenant,
        status: 'ACTIVE',
      }),
    ).not.toBeNull();
    await request(testApp.server)
      .get('/api/v1/public/managed-booking/context')
      .expect(404);
    await request(testApp.server)
      .get('/api/v1/public/managed-booking/services')
      .expect(404)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('PUBLIC_ACCOUNT_UNAVAILABLE'),
      );
    await request(testApp.server)
      .get('/api/v1/public/managed-booking/staff')
      .expect(404)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('PUBLIC_ACCOUNT_UNAVAILABLE'),
      );
    await availability('managed-booking', ids.location, ids.service, ids.staff)
      .expect(404)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('PUBLIC_ACCOUNT_UNAVAILABLE'),
      );
    await testApp.database.models.account.updateOne(
      { _id: ids.account },
      { $set: { status: 'ACTIVE' } },
    );
  });
});
