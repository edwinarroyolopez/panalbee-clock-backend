import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { ConversationEngineService } from '../conversations/conversation-engine.service';
import { MessageDeliveryService } from './message-delivery.service';

export interface WebhookProcessingSummary {
  accepted: true;
  processed: number;
  duplicates: number;
}

@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly adapters: ChannelAdapterRegistry,
    private readonly conversations: ConversationEngineService,
    private readonly delivery: MessageDeliveryService,
  ) {}

  verify(mode: string, verifyToken: string, challenge: string): string {
    return this.adapters.get('WHATSAPP').verifyChallenge({
      mode,
      verifyToken,
      challenge,
    });
  }

  async receive(
    rawBody: Buffer,
    signature: string | undefined,
    payload: unknown,
  ): Promise<WebhookProcessingSummary> {
    const adapter = this.adapters.get('WHATSAPP');
    adapter.validateSignature(rawBody, signature);
    const events = adapter.normalizeInbound(payload);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    let processed = 0;
    let duplicates = 0;

    for (const event of events) {
      const result = await this.conversations.processInbound(
        'WHATSAPP',
        event,
        payloadHash,
      );
      if (result.duplicate) {
        duplicates += 1;
        continue;
      }
      processed += 1;
      for (const message of result.queuedMessages) {
        try {
          await this.delivery.dispatch(message.id, message.tenantId);
        } catch {
          // The durable message remains FAILED for the delivery worker to retry.
        }
      }
    }
    return { accepted: true, processed, duplicates };
  }
}
