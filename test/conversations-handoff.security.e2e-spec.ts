import { INestApplication } from '@nestjs/common';
import { Server } from 'node:http';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { DatabaseService } from '../src/database/database.service';
import { MessageDeliveryService } from '../src/messaging/message-delivery.service';
import {
  openMessagingApp,
  signedWebhook,
  WhatsAppTestHarness,
  whatsappPayload,
} from './channel-test-support';

const ids = {
  tenantA: '83000000-0000-4000-8000-000000000001',
  tenantB: '83000000-0000-4000-8000-000000000002',
  channelA: '84000000-0000-4000-8000-000000000001',
  channelB: '84000000-0000-4000-8000-000000000002',
  customerA: '85000000-0000-4000-8000-000000000001',
  customerB: '85000000-0000-4000-8000-000000000002',
  conversationA: '86000000-0000-4000-8000-000000000001',
  conversationB: '86000000-0000-4000-8000-000000000002',
  ownerA: '87000000-0000-4000-8000-000000000001',
  agentA: '87000000-0000-4000-8000-000000000002',
  disabledA: '87000000-0000-4000-8000-000000000003',
  ownerB: '87000000-0000-4000-8000-000000000004',
};

interface LoginBody {
  accessToken: string;
}

describe('conversation handoff (security e2e)', () => {
  const harness = new WhatsAppTestHarness();
  const password = 'handoff-test-password';
  let app: INestApplication;
  let database: DatabaseService;
  let server: Server;
  let agentToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    ({ app, database, server } = await openMessagingApp(harness));
    const passwordHash = await hashPassword(password);
    await database.models.tenant.insertMany([
      {
        _id: ids.tenantA,
        name: 'Handoff Tenant A',
        slug: 'handoff-tenant-a',
      },
      {
        _id: ids.tenantB,
        name: 'Handoff Tenant B',
        slug: 'handoff-tenant-b',
      },
    ]);
    await database.models.channel.insertMany([
      {
        _id: ids.channelA,
        tenantId: ids.tenantA,
        type: 'WHATSAPP',
        externalAccountId: 'handoff-phone-a',
      },
      {
        _id: ids.channelB,
        tenantId: ids.tenantB,
        type: 'WHATSAPP',
        externalAccountId: 'handoff-phone-b',
      },
    ]);
    await database.models.customer.insertMany([
      {
        _id: ids.customerA,
        tenantId: ids.tenantA,
        fullName: 'Handoff Customer A',
        phone: '+573001110002',
      },
      {
        _id: ids.customerB,
        tenantId: ids.tenantB,
        fullName: 'Handoff Customer B',
        phone: '+573001110003',
      },
    ]);
    await database.models.conversation.insertMany([
      {
        _id: ids.conversationA,
        tenantId: ids.tenantA,
        customerId: ids.customerA,
        channelId: ids.channelA,
        externalThreadId: '+573001110002',
      },
      {
        _id: ids.conversationB,
        tenantId: ids.tenantB,
        customerId: ids.customerB,
        channelId: ids.channelB,
        externalThreadId: '+573001110003',
      },
    ]);
    await database.models.user.insertMany([
      {
        _id: ids.ownerA,
        email: 'handoff-owner-a@example.test',
        displayName: 'Owner A',
        passwordHash,
        actorType: 'TENANT',
        status: 'ACTIVE',
      },
      {
        _id: ids.agentA,
        email: 'handoff-agent-a@example.test',
        displayName: 'Agent A',
        passwordHash,
        actorType: 'TENANT',
        status: 'ACTIVE',
      },
      {
        _id: ids.disabledA,
        email: 'handoff-disabled-a@example.test',
        displayName: 'Disabled A',
        passwordHash,
        actorType: 'TENANT',
        status: 'DISABLED',
      },
      {
        _id: ids.ownerB,
        email: 'handoff-owner-b@example.test',
        displayName: 'Owner B',
        passwordHash,
        actorType: 'TENANT',
        status: 'ACTIVE',
      },
    ]);
    await database.models.tenantMembership.insertMany([
      { tenantId: ids.tenantA, userId: ids.ownerA, role: 'OWNER' },
      { tenantId: ids.tenantA, userId: ids.agentA, role: 'AGENT' },
      { tenantId: ids.tenantA, userId: ids.disabledA, role: 'AGENT' },
      { tenantId: ids.tenantB, userId: ids.ownerB, role: 'OWNER' },
    ]);
    agentToken = (
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: 'handoff-agent-a@example.test', password })
          .expect(200)
      ).body as LoginBody
    ).accessToken;
    ownerToken = (
      (
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: 'handoff-owner-a@example.test', password })
          .expect(200)
      ).body as LoginBody
    ).accessToken;
  });

  afterAll(async () => app.close());

  it('never exposes a foreign tenant conversation', async () => {
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationB}/handoff`)
      .auth(agentToken, { type: 'bearer' })
      .expect(404);
    const list = await request(server)
      .get('/api/v1/conversations')
      .auth(agentToken, { type: 'bearer' })
      .expect(200);
    expect((list.body as { items: { id: string }[] }).items).toEqual([
      expect.objectContaining({ id: ids.conversationA }),
    ]);
  });

  it('claims HUMAN control, validates assignment, suppresses bot, and traces outbound', async () => {
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/handoff`)
      .auth(agentToken, { type: 'bearer' })
      .expect(201)
      .expect(({ body }: { body: { state: string; controlStatus: string } }) =>
        expect(body).toMatchObject({
          state: 'HUMAN_HANDOFF',
          controlStatus: 'BOT',
        }),
      );
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/handoff/claim`)
      .auth(agentToken, { type: 'bearer' })
      .expect(201)
      .expect(
        ({ body }: { body: { assignedTo: string; controlStatus: string } }) =>
          expect(body).toMatchObject({
            assignedTo: ids.agentA,
            controlStatus: 'HUMAN',
          }),
      );

    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/messages`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ text: 'Unassigned sender must be denied' })
      .expect(403)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('CONVERSATION_NOT_ASSIGNED'),
      );

    for (const assignedTo of [ids.ownerB, ids.disabledA]) {
      await request(server)
        .patch(`/api/v1/conversations/${ids.conversationA}/handoff/assignment`)
        .auth(agentToken, { type: 'bearer' })
        .send({ assignedTo, reason: 'Coverage assignment test' })
        .expect(400)
        .expect(({ body }: { body: { reasonCode: string } }) =>
          expect(body.reasonCode).toBe('HANDOFF_ASSIGNEE_INVALID'),
        );
    }

    const beforeDelivery = harness.requests.length;
    await signedWebhook(
      server,
      whatsappPayload('handoff-phone-a', '573001110002', 'wamid.human.1', {
        type: 'text',
        text: 'Are you there?',
      }),
    ).expect(200);
    expect(harness.requests).toHaveLength(beforeDelivery);
    const [inbound, outbound] = await Promise.all([
      database.models.message.countDocuments({
        tenantId: ids.tenantA,
        conversationId: ids.conversationA,
        direction: 'INBOUND',
      }),
      database.models.message.countDocuments({
        tenantId: ids.tenantA,
        conversationId: ids.conversationA,
        direction: 'OUTBOUND',
      }),
    ]);
    expect({ inbound, outbound }).toEqual({ inbound: 1, outbound: 0 });

    const sent = await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/messages`)
      .auth(agentToken, { type: 'bearer' })
      .set('x-request-id', 'handoff-outbound-request')
      .send({ text: 'A human response' })
      .expect(201);
    expect(sent.body).toMatchObject({ deliveryStatus: 'SENT' });
    expect(
      (sent.body as { providerMessageId: string }).providerMessageId,
    ).toMatch(/^provider-/);

    const history = await request(server)
      .get(`/api/v1/conversations/${ids.conversationA}/messages`)
      .auth(agentToken, { type: 'bearer' })
      .expect(200);
    const items = (history.body as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(2);
    const expectedKeys = [
      'id',
      'direction',
      'kind',
      'content',
      'providerMessageId',
      'deliveryStatus',
      'sentBy',
      'createdAt',
    ].sort();
    expect(Object.keys(items[0]).sort()).toEqual(expectedKeys);
    expect(Object.keys(items[1]).sort()).toEqual(expectedKeys);
    expect(items[0]).toMatchObject({
      direction: 'INBOUND',
      kind: 'TEXT',
      providerMessageId: 'wamid.human.1',
      deliveryStatus: 'RECEIVED',
      sentBy: null,
    });
    expect(items[1]).toMatchObject({
      direction: 'OUTBOUND',
      kind: 'TEXT',
      deliveryStatus: 'SENT',
      sentBy: ids.agentA,
    });

    const message = await database.models.message
      .findOne({
        tenantId: ids.tenantA,
        conversationId: ids.conversationA,
        direction: 'OUTBOUND',
      })
      .lean()
      .exec();
    expect(message).toMatchObject({
      deliveryStatus: 'SENT',
      sentBy: ids.agentA,
    });
    expect(message?.providerMessageId).toMatch(/^provider-/);
    const audit = await database.models.auditEvent
      .findOne({
        tenantId: ids.tenantA,
        entityId: ids.conversationA,
        action: 'CONVERSATION_MESSAGE_QUEUED',
        'metadata.messageId': message?._id,
      })
      .lean()
      .exec();
    expect(audit?.requestId).toBe('handoff-outbound-request');

    harness.failuresRemaining = 1;
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/messages`)
      .auth(agentToken, { type: 'bearer' })
      .send({ text: 'Retry this human response' })
      .expect(502)
      .expect(
        ({ body }: { body: { reasonCode: string; details?: unknown } }) => {
          expect(body.reasonCode).toBe('CHANNEL_PROVIDER_REJECTED');
          expect(body.details).toBeUndefined();
        },
      );
    const failedMessage = await database.models.message
      .findOne({
        tenantId: ids.tenantA,
        conversationId: ids.conversationA,
        'content.intent.text': 'Retry this human response',
      })
      .lean()
      .exec();
    expect(failedMessage?.deliveryStatus).toBe('FAILED');
    await expect(
      app.get(MessageDeliveryService).processPending(1),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    await expect(
      database.models.message.exists({
        _id: failedMessage?._id,
        deliveryStatus: 'SENT',
        providerMessageId: { $type: 'string' },
      }),
    ).resolves.not.toBeNull();

    await request(server)
      .patch(`/api/v1/conversations/${ids.conversationA}/handoff/assignment`)
      .auth(agentToken, { type: 'bearer' })
      .send({ assignedTo: ids.ownerA, reason: 'Owner takes this conversation' })
      .expect(200);
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/messages`)
      .auth(agentToken, { type: 'bearer' })
      .send({ text: 'This agent no longer owns the conversation' })
      .expect(403)
      .expect(({ body }: { body: { reasonCode: string } }) =>
        expect(body.reasonCode).toBe('CONVERSATION_NOT_ASSIGNED'),
      );
    await request(server)
      .post(`/api/v1/conversations/${ids.conversationA}/handoff/release`)
      .auth(ownerToken, { type: 'bearer' })
      .send({ reason: 'Customer request is complete' })
      .expect(201)
      .expect(({ body }: { body: { controlStatus: string; state: string } }) =>
        expect(body).toMatchObject({
          controlStatus: 'BOT',
          state: 'MAIN_MENU',
        }),
      );
  });
});
