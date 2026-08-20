import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { CHANNEL_ADAPTERS } from '../src/channels/channel-adapter.registry';
import { configureApplication } from '../src/common/configure-application';
import { DatabaseService } from '../src/database/database.service';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { RecordingChannelAdapter } from './channel-test-support';

const ids = {
  tenant: '88000000-0000-4000-8000-000000000001',
  location: '88000000-0000-4000-8000-000000000002',
  customer: '88000000-0000-4000-8000-000000000003',
  service: '88000000-0000-4000-8000-000000000004',
  staff: '88000000-0000-4000-8000-000000000005',
  appointment: '88000000-0000-4000-8000-000000000006',
  channel: '88000000-0000-4000-8000-000000000007',
};

describe('durable conversation notifications (MongoDB integration)', () => {
  const adapter = new RecordingChannelAdapter();
  let app: INestApplication;
  let database: DatabaseService;
  let notifications: NotificationService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule, NotificationsModule],
    })
      .overrideProvider(CHANNEL_ADAPTERS)
      .useValue([adapter])
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    notifications = app.get(NotificationService);

    await database.models.tenant.create({
      _id: ids.tenant,
      name: 'Notification Tenant',
      slug: 'notification-tenant',
    });
    await database.models.location.create({
      _id: ids.location,
      tenantId: ids.tenant,
      name: 'Notification Location',
      timezone: 'America/Bogota',
    });
    await database.models.customer.create({
      _id: ids.customer,
      tenantId: ids.tenant,
      fullName: 'Notification Customer',
      phone: '+573001110004',
    });
    await database.models.service.create({
      _id: ids.service,
      tenantId: ids.tenant,
      name: 'Notification Service',
      durationMinutes: 60,
    });
    await database.models.staff.create({
      _id: ids.staff,
      tenantId: ids.tenant,
      locationId: ids.location,
      displayName: 'Notification Staff',
    });
    await database.models.appointment.create({
      _id: ids.appointment,
      tenantId: ids.tenant,
      locationId: ids.location,
      serviceId: ids.service,
      staffId: ids.staff,
      customerId: ids.customer,
      startsAt: new Date('2026-09-01T14:00:00Z'),
      endsAt: new Date('2026-09-01T15:00:00Z'),
      idempotencyKey: 'notification-appointment',
      requestFingerprint: 'notification-fingerprint',
    });
    await database.models.channel.create({
      _id: ids.channel,
      tenantId: ids.tenant,
      type: 'WHATSAPP',
      externalAccountId: 'notification-phone',
    });
  });

  afterAll(async () => app.close());

  it('creates exactly one durable intent and rejects conflicting reuse', async () => {
    const input = {
      tenantId: ids.tenant,
      appointmentId: ids.appointment,
      customerId: ids.customer,
      channelId: ids.channel,
      type: 'BOOKING_CONFIRMATION' as const,
      scheduledFor: new Date('2026-08-20T00:00:00Z'),
      idempotencyKey: 'booking-confirmation:notification-appointment',
    };
    const first = await notifications.createIntent(input);
    const replay = await notifications.createIntent(input);
    expect(replay.id).toBe(first.id);
    await expect(
      notifications.createIntent({
        ...input,
        type: 'BOOKING_CANCELLED',
      }),
    ).rejects.toMatchObject({
      reasonCode: 'NOTIFICATION_IDEMPOTENCY_CONFLICT',
    });
    await expect(
      database.models.notification.countDocuments({ tenantId: ids.tenant }),
    ).resolves.toBe(1);
  });

  it('reclaims stale work, persists failure, retries once, and never redelivers SENT', async () => {
    await database.models.notification.updateOne(
      { tenantId: ids.tenant },
      {
        $set: {
          status: 'PROCESSING',
          leaseUntil: new Date(Date.now() - 1_000),
        },
      },
    );
    adapter.failuresRemaining = 1;
    await expect(
      notifications.processPending(1, 5, ids.tenant),
    ).resolves.toEqual({ sent: 0, failed: 1 });
    const failed = await database.models.notification
      .findOne({ tenantId: ids.tenant })
      .lean()
      .exec();
    expect(failed).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastErrorCode: 'CHANNEL_DELIVERY_UNAVAILABLE',
    });
    expect(failed?.leaseUntil).toBeUndefined();

    await expect(
      notifications.processPending(1, 5, ids.tenant),
    ).resolves.toEqual({ sent: 1, failed: 0 });
    const sent = await database.models.notification
      .findOne({ tenantId: ids.tenant })
      .lean()
      .exec();
    expect(sent).toMatchObject({
      status: 'SENT',
      attempts: 2,
    });
    expect(sent?.lastErrorCode ?? null).toBeNull();
    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent[1]).toMatchObject({
      externalAccountId: 'notification-phone',
      recipientId: '+573001110004',
      idempotencyKey: 'booking-confirmation:notification-appointment',
      intent: { kind: 'TEMPLATE', name: 'booking_confirmation' },
    });

    await expect(
      notifications.processPending(1, 5, ids.tenant),
    ).resolves.toEqual({ sent: 0, failed: 0 });
    expect(adapter.sent).toHaveLength(2);
    const audit = await database.models.auditEvent
      .findOne({ tenantId: ids.tenant, action: 'NOTIFICATION_SENT' })
      .lean()
      .exec();
    expect(audit?.metadata).toEqual({ providerMessageId: 'recorded-2' });
  });
});
