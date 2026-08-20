import { AppException } from '../../common/app-exception';
import {
  ChannelAdapter,
  ChannelDelivery,
  OutboundChannelMessage,
  ReplyIntent,
  WebhookChallenge,
} from '../channel-adapter';
import { normalizeWhatsAppPayload } from './whatsapp-normalizer';
import {
  validateWhatsAppSignature,
  verifyWhatsAppToken,
} from './whatsapp-signature';

export interface WhatsAppAdapterConfig {
  appSecret?: string;
  verifyToken?: string;
  accessToken?: string;
  graphVersion?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
}

function providerErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code).slice(0, 40)
    : undefined;
}

function providerMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || !messages[0]) return undefined;
  const id = (messages[0] as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channelType = 'WHATSAPP' as const;

  constructor(
    private readonly config: WhatsAppAdapterConfig,
    private readonly transport: typeof fetch = globalThis.fetch,
  ) {}

  verifyChallenge(challenge: WebhookChallenge): string {
    if (challenge.mode !== 'subscribe' || !challenge.challenge) {
      throw new AppException(
        403,
        'WEBHOOK_VERIFICATION_FAILED',
        'Webhook verification failed',
      );
    }
    verifyWhatsAppToken(challenge.verifyToken, this.config.verifyToken);
    return challenge.challenge;
  }

  validateSignature(rawBody: Buffer, signature: string | undefined): void {
    validateWhatsAppSignature(rawBody, signature, this.config.appSecret);
  }

  normalizeInbound(payload: unknown) {
    return normalizeWhatsAppPayload(payload);
  }

  async send(message: OutboundChannelMessage): Promise<ChannelDelivery> {
    if (!this.config.accessToken) {
      throw new AppException(
        503,
        'CHANNEL_CREDENTIALS_MISSING',
        'WhatsApp delivery credentials are not configured',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 10_000,
    );
    try {
      const response = await this.transport(
        this.url(message.externalAccountId),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(this.providerPayload(message)),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = providerErrorCode(payload);
        throw new AppException(
          502,
          'CHANNEL_PROVIDER_REJECTED',
          'WhatsApp rejected the message',
          {
            provider: 'WHATSAPP',
            status: response.status,
            ...(code ? { code } : {}),
          },
        );
      }
      const id = providerMessageId(payload);
      if (!id) {
        throw new AppException(
          502,
          'CHANNEL_PROVIDER_RESPONSE_INVALID',
          'WhatsApp returned an invalid delivery response',
        );
      }
      return { providerMessageId: id };
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(
        503,
        'CHANNEL_DELIVERY_UNAVAILABLE',
        'WhatsApp delivery is temporarily unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private url(externalAccountId: string): string {
    const base = this.config.apiBaseUrl ?? 'https://graph.facebook.com';
    const version = this.config.graphVersion ?? 'v23.0';
    return `${base.replace(/\/$/, '')}/${version}/${encodeURIComponent(externalAccountId)}/messages`;
  }

  private providerPayload(message: OutboundChannelMessage): object {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.recipientId.replace(/^\+/, ''),
      ...this.intentPayload(message.intent),
    };
  }

  private intentPayload(intent: ReplyIntent): object {
    if (intent.kind === 'TEXT') {
      return { type: 'text', text: { body: intent.text } };
    }
    if (intent.kind === 'TEMPLATE') {
      return {
        type: 'template',
        template: {
          name: intent.name,
          language: { code: intent.language },
          ...(intent.variables?.length
            ? {
                components: [
                  {
                    type: 'body',
                    parameters: intent.variables.map((text) => ({
                      type: 'text',
                      text,
                    })),
                  },
                ],
              }
            : {}),
        },
      };
    }
    if (intent.options.length <= 3) {
      return {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: intent.body },
          action: {
            buttons: intent.options.map((option) => ({
              type: 'reply',
              reply: { id: option.id, title: option.title },
            })),
          },
        },
      };
    }
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: intent.body },
        action: {
          button: 'View options',
          sections: [
            {
              title: 'Options',
              rows: intent.options.slice(0, 10).map((option) => ({
                id: option.id,
                title: option.title,
                ...(option.description
                  ? { description: option.description }
                  : {}),
              })),
            },
          ],
        },
      },
    };
  }
}
