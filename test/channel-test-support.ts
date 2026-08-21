import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboundChannelMessage } from '../src/channels/channel-adapter';
import { CHANNEL_ADAPTERS } from '../src/channels/channel-adapter.registry';
import { WhatsAppAdapter } from '../src/channels/whatsapp/whatsapp.adapter';
import { configureApplication } from '../src/common/configure-application';
import { DatabaseService } from '../src/database/database.service';
import { MessagingModule } from '../src/messaging/messaging.module';

export const whatsappSecret = 'integration-whatsapp-secret';
export const whatsappVerifyToken = 'integration-verify-token';

export class WhatsAppTestHarness {
  readonly requests: Array<{ url: string; body: unknown }> = [];
  failuresRemaining = 0;
  readonly adapter: WhatsAppAdapter;

  constructor() {
    const transport = ((input: string | URL | Request, init?: RequestInit) => {
      const rawBody = typeof init?.body === 'string' ? init.body : undefined;
      const body: unknown = rawBody ? JSON.parse(rawBody) : undefined;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      this.requests.push({ url, body });
      if (this.failuresRemaining > 0) {
        this.failuresRemaining -= 1;
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 131000 } }), {
            status: 503,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            messages: [{ id: `provider-${this.requests.length}` }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as typeof fetch;
    this.adapter = new WhatsAppAdapter(
      {
        appSecret: whatsappSecret,
        verifyToken: whatsappVerifyToken,
        accessToken: 'integration-access-token',
        apiBaseUrl: 'https://meta.test',
      },
      transport,
    );
  }
}

export async function openMessagingApp(harness: WhatsAppTestHarness): Promise<{
  app: INestApplication;
  database: DatabaseService;
  server: Server;
}> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule, MessagingModule],
  })
    .overrideProvider(CHANNEL_ADAPTERS)
    .useValue([harness.adapter])
    .compile();
  const app = moduleFixture.createNestApplication({ rawBody: true });
  configureApplication(app);
  await app.init();
  return {
    app,
    database: app.get(DatabaseService),
    server: app.getHttpServer() as Server,
  };
}

export function whatsappPayload(
  accountId: string,
  from: string,
  messageId: string,
  input:
    | { type: 'text'; text: string }
    | { type: 'interactive'; id: string; title: string },
): object {
  const message =
    input.type === 'text'
      ? { type: 'text', text: { body: input.text } }
      : {
          type: 'interactive',
          interactive: {
            type: 'list_reply',
            list_reply: { id: input.id, title: input.title },
          },
        };
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: accountId },
              contacts: [{ wa_id: from, profile: { name: 'Ada Test' } }],
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: '1787184000',
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function signedWebhook(
  server: Server,
  payload: object,
  signatureOverride?: string,
): request.Test {
  const raw = JSON.stringify(payload);
  const signature =
    signatureOverride ??
    `sha256=${createHmac('sha256', whatsappSecret).update(raw).digest('hex')}`;
  return request(server)
    .post('/api/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signature)
    .send(raw);
}

export class RecordingChannelAdapter {
  readonly channelType = 'WHATSAPP' as const;
  readonly sent: OutboundChannelMessage[] = [];
  failuresRemaining = 0;

  verifyChallenge(): string {
    throw new Error('not used');
  }

  validateSignature(): void {
    throw new Error('not used');
  }

  normalizeInbound(): never[] {
    return [];
  }

  send(message: OutboundChannelMessage) {
    this.sent.push(message);
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error('test delivery failure'));
    }
    return Promise.resolve({
      providerMessageId: `recorded-${this.sent.length}`,
    });
  }
}
