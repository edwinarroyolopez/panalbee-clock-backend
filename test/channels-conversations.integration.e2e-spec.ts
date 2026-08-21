import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import { DatabaseService } from '../src/database/database.service';
import {
  openMessagingApp,
  signedWebhook,
  WhatsAppTestHarness,
  whatsappPayload,
} from './channel-test-support';

const ids = {
  tenantA: 'a1000000-0000-4000-8000-000000000001',
  tenantB: 'a1000000-0000-4000-8000-000000000002',
  channelA: 'a2000000-0000-4000-8000-000000000001',
  channelB: 'a2000000-0000-4000-8000-000000000002',
};

describe('channels and persisted conversations (MongoDB integration)', () => {
  const harness = new WhatsAppTestHarness();
  let app: INestApplication;
  let database: DatabaseService;
  let server: Server;

  beforeAll(async () => {
    ({ app, database, server } = await openMessagingApp(harness));
    await database.models.tenant.insertMany([
      {
        _id: ids.tenantA,
        name: 'Channel Tenant A',
        slug: 'channel-tenant-a',
      },
      {
        _id: ids.tenantB,
        name: 'Channel Tenant B',
        slug: 'channel-tenant-b',
      },
    ]);
    await database.models.channel.insertMany([
      {
        _id: ids.channelA,
        tenantId: ids.tenantA,
        type: 'WHATSAPP',
        externalAccountId: 'phone-account-a',
      },
      {
        _id: ids.channelB,
        tenantId: ids.tenantB,
        type: 'WHATSAPP',
        externalAccountId: 'phone-account-b',
      },
    ]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rejects an invalid raw-body signature before persistence', async () => {
    const payload = whatsappPayload(
      'phone-account-a',
      '573001110001',
      'wamid.invalid',
      { type: 'text', text: 'book' },
    );
    await signedWebhook(server, payload, `sha256=${'0'.repeat(64)}`)
      .expect(401)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('WEBHOOK_SIGNATURE_INVALID'),
      );
    await expect(
      database.models.providerEvent.countDocuments({ tenantId: ids.tenantA }),
    ).resolves.toBe(0);
  });

  it('persists one event/message/effect and accepts a duplicate as a no-op', async () => {
    const payload = whatsappPayload(
      'phone-account-a',
      '573001110001',
      'wamid.a.1',
      { type: 'interactive', id: 'book', title: 'Book' },
    );
    await signedWebhook(server, payload).expect(200).expect({
      accepted: true,
      processed: 1,
      duplicates: 0,
    });
    await signedWebhook(server, payload).expect(200).expect({
      accepted: true,
      processed: 0,
      duplicates: 1,
    });

    const [events, inbound, outbound] = await Promise.all([
      database.models.providerEvent.countDocuments({ tenantId: ids.tenantA }),
      database.models.message.countDocuments({
        tenantId: ids.tenantA,
        direction: 'INBOUND',
      }),
      database.models.message.countDocuments({
        tenantId: ids.tenantA,
        direction: 'OUTBOUND',
      }),
    ]);
    expect({ events, inbound, outbound }).toEqual({
      events: 1,
      inbound: 1,
      outbound: 1,
    });
    expect(harness.requests).toHaveLength(1);
  });

  it('loads state/context after application recreation instead of re-inferring', async () => {
    await app.close();
    ({ app, database, server } = await openMessagingApp(harness));
    const payload = whatsappPayload(
      'phone-account-a',
      '573001110001',
      'wamid.a.2',
      { type: 'interactive', id: 'service-a', title: 'Service A' },
    );
    await signedWebhook(server, payload).expect(200);

    const conversation = await database.models.conversation
      .findOne({ tenantId: ids.tenantA, channelId: ids.channelA })
      .lean()
      .exec();
    expect(conversation).toMatchObject({
      state: 'BOOKING_PROFESSIONAL',
      context: { serviceId: 'service-a' },
    });
    const history = await database.models.conversationStateHistory
      .find({ tenantId: ids.tenantA })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    expect(history.map(({ toState }) => toState)).toEqual([
      'MAIN_MENU',
      'BOOKING_SERVICE',
      'BOOKING_PROFESSIONAL',
    ]);
  });

  it('keeps the same channel customer identity isolated by tenant', async () => {
    const payload = whatsappPayload(
      'phone-account-b',
      '573001110001',
      'wamid.b.1',
      { type: 'text', text: 'book' },
    );
    await signedWebhook(server, payload).expect(200);

    const customers = await database.models.customer
      .find({ phone: '+573001110001' })
      .sort({ tenantId: 1 })
      .lean()
      .exec();
    expect(
      customers.map(({ tenantId, phone }) => ({ tenantId, phone })),
    ).toEqual([
      { tenantId: ids.tenantA, phone: '+573001110001' },
      { tenantId: ids.tenantB, phone: '+573001110001' },
    ]);
    for (const customer of customers) {
      await expect(
        database.models.conversation.exists({
          tenantId: customer.tenantId,
          customerId: customer._id,
        }),
      ).resolves.not.toBeNull();
    }
  });
});
