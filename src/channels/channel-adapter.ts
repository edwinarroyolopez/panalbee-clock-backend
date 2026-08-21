export type ChannelType =
  'WHATSAPP' | 'WEB' | 'INSTAGRAM' | 'MESSENGER' | 'OTHER';

export interface WebhookChallenge {
  mode: string;
  verifyToken: string;
  challenge: string;
}

export type NormalizedInput =
  | { kind: 'TEXT'; text: string }
  | {
      kind: 'INTERACTIVE';
      selectionId: string;
      title?: string;
    };

export interface NormalizedInboundEvent {
  providerEventId: string;
  providerMessageId: string;
  externalAccountId: string;
  externalThreadId: string;
  customerDisplayName?: string;
  occurredAt?: string;
  input: NormalizedInput;
}

export type ReplyIntent =
  | { kind: 'TEXT'; text: string }
  | {
      kind: 'INTERACTIVE';
      body: string;
      options: ReadonlyArray<{
        id: string;
        title: string;
        description?: string;
      }>;
    }
  | {
      kind: 'TEMPLATE';
      name: string;
      language: string;
      variables?: readonly string[];
    };

export interface OutboundChannelMessage {
  externalAccountId: string;
  recipientId: string;
  intent: ReplyIntent;
  idempotencyKey?: string;
}

export interface ChannelDelivery {
  providerMessageId: string;
}

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  verifyChallenge(challenge: WebhookChallenge): string;
  validateSignature(rawBody: Buffer, signature: string | undefined): void;
  normalizeInbound(payload: unknown): NormalizedInboundEvent[];
  send(message: OutboundChannelMessage): Promise<ChannelDelivery>;
}
