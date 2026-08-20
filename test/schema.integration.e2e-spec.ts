import { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import {
  AUDIT_APPEND_ONLY_ERROR,
  INDEX_NAMES,
  syncClockIndexes,
} from '../src/database/models';
import { clearMongo, createCoreTestApplication } from './core-test-app';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ids = {
  tenantA: '00000000-0000-4000-8000-000000000001',
  tenantB: '00000000-0000-4000-8000-000000000002',
};

describe('MongoDB schema and indexes (integration)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    const testApp = await createCoreTestApplication();
    app = testApp.app;
    database = testApp.database;
    await clearMongo(database);
    await database.models.tenant.insertMany([
      { _id: ids.tenantA, name: 'Clock Test', slug: 'clock-test' },
      { _id: ids.tenantB, name: 'Other Test', slug: 'other-test' },
    ]);
  });

  afterAll(async () => app.close());

  it('synchronizes every required named index idempotently', async () => {
    await syncClockIndexes(database.connection);
    await syncClockIndexes(database.connection);

    const actualNames = new Set<string>();
    const mongoDatabase = database.connection.db;
    if (!mongoDatabase) throw new Error('MongoDB connection is not ready');
    for (const collection of await mongoDatabase.collections()) {
      const indexes = await collection.indexes();
      indexes.forEach(({ name }) => {
        if (name) actualNames.add(name);
      });
    }
    for (const name of Object.values(INDEX_NAMES)) {
      expect(actualNames).toContain(name);
    }
  });

  it('generates UUID string identifiers and rejects unknown schema fields', async () => {
    const customer = await database.models.customer.create({
      tenantId: ids.tenantA,
      fullName: 'Ada Test',
    });
    expect(customer._id).toMatch(UUID);
    expect(typeof customer._id).toBe('string');

    expect(
      () =>
        new database.models.customer({
          tenantId: ids.tenantA,
          fullName: 'Unknown Field',
          authorityTenantId: ids.tenantB,
        }),
    ).toThrow(/strict mode/i);
  });

  it('enforces partial customer phone uniqueness per tenant', async () => {
    await database.models.customer.create([
      { tenantId: ids.tenantA, fullName: 'No Phone One' },
      { tenantId: ids.tenantA, fullName: 'No Phone Two' },
      { tenantId: ids.tenantA, fullName: 'Phone One', phone: '+5700000001' },
      { tenantId: ids.tenantB, fullName: 'Phone Other', phone: '+5700000001' },
    ]);

    await expect(
      database.models.customer.create({
        tenantId: ids.tenantA,
        fullName: 'Phone Conflict',
        phone: '+5700000001',
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('keeps audit events append-only through model middleware', async () => {
    const event = await database.models.auditEvent.create({
      tenantId: ids.tenantA,
      actorType: 'SYSTEM',
      action: 'SCHEMA_TEST',
      entityType: 'schema',
      entityId: 'mongo',
      metadata: {},
    });

    await expect(
      database.models.auditEvent.updateOne(
        { _id: event._id },
        { $set: { action: 'MUTATED' } },
      ),
    ).rejects.toThrow(AUDIT_APPEND_ONLY_ERROR);
    await expect(
      database.models.auditEvent.replaceOne(
        { _id: event._id },
        {
          _id: event._id,
          actorType: 'SYSTEM',
          action: 'REPLACED',
          entityType: 'schema',
          entityId: 'mongo',
          metadata: {},
        },
      ),
    ).rejects.toThrow(AUDIT_APPEND_ONLY_ERROR);
    await expect(
      database.models.auditEvent.deleteOne({ _id: event._id }),
    ).rejects.toThrow(AUDIT_APPEND_ONLY_ERROR);
    expect(
      await database.models.auditEvent.exists({
        _id: event._id,
        action: 'SCHEMA_TEST',
      }),
    ).not.toBeNull();
  });

  it('validates actor roles and ordered appointment-time intervals', async () => {
    await expect(
      database.models.user.create({
        email: 'invalid-internal@example.test',
        displayName: 'Invalid Internal',
        passwordHash: 'not-used',
        actorType: 'INTERNAL',
      }),
    ).rejects.toThrow('Internal role is inconsistent');
    await database.models.user.create([
      {
        phone: '+573001110010',
        displayName: 'Phone Admin One',
        passwordHash: 'not-used',
        actorType: 'INTERNAL',
        internalRole: 'PLATFORM_ADMIN',
      },
      {
        phone: '+573001110011',
        displayName: 'Phone Admin Two',
        passwordHash: 'not-used',
        actorType: 'INTERNAL',
        internalRole: 'PLATFORM_ADMIN',
      },
    ]);
    await expect(
      database.models.user.create({
        phone: '+573001110010',
        displayName: 'Duplicate Phone Admin',
        passwordHash: 'not-used',
        actorType: 'INTERNAL',
        internalRole: 'PLATFORM_ADMIN',
      }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(
      database.models.user.create({
        email: 'invalid-tenant@example.test',
        displayName: 'Invalid Tenant User',
        passwordHash: 'not-used',
        actorType: 'TENANT',
        internalRole: 'PLATFORM_ADMIN',
      }),
    ).rejects.toThrow('Internal role is inconsistent');
    await expect(
      database.models.schedule.create({
        tenantId: ids.tenantA,
        locationId: '00000000-0000-4000-8000-000000000003',
        staffId: '00000000-0000-4000-8000-000000000004',
        dayOfWeek: 1,
        startsAt: '12:00',
        endsAt: '11:00',
      }),
    ).rejects.toThrow('End must be after start');
    await expect(
      database.models.appointment.create({
        tenantId: ids.tenantA,
        locationId: '00000000-0000-4000-8000-000000000003',
        serviceId: '00000000-0000-4000-8000-000000000004',
        staffId: '00000000-0000-4000-8000-000000000005',
        customerId: '00000000-0000-4000-8000-000000000006',
        startsAt: new Date('2026-08-20T12:00:00Z'),
        endsAt: new Date('2026-08-20T11:00:00Z'),
        idempotencyKey: 'invalid-interval',
        requestFingerprint: 'invalid-interval',
      }),
    ).rejects.toThrow('End must be after start');
    await expect(
      database.models.availabilityException.create({
        tenantId: ids.tenantA,
        locationId: '00000000-0000-4000-8000-000000000003',
        staffId: '00000000-0000-4000-8000-000000000005',
        kind: 'UNAVAILABLE',
        startsAt: new Date('2026-08-20T12:00:00Z'),
        endsAt: new Date('2026-08-20T11:00:00Z'),
      }),
    ).rejects.toThrow('End must be after start');
  });

  it('provides transaction-capable replica-set persistence', async () => {
    await database.ping();
    await database.assertReplicaSet();
    const locationId = await database.withTransaction(async (session) => {
      const [location] = await database.models.location.create(
        [
          {
            tenantId: ids.tenantA,
            name: 'Transactional Location',
            timezone: 'America/Bogota',
          },
        ],
        { session },
      );
      return location._id;
    });

    expect(locationId).toMatch(UUID);
    expect(
      await database.models.location.exists({ _id: locationId }),
    ).not.toBeNull();
  });
});
