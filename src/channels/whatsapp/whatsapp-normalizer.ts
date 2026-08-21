import { AppException } from '../../common/app-exception';
import { NormalizedInboundEvent, NormalizedInput } from '../channel-adapter';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((entry): entry is UnknownRecord => !!entry)
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeWhatsAppPhone(value: string): string {
  const digits = value.trim().replace(/^\+/, '');
  if (!/^\d{7,15}$/.test(digits)) {
    throw new AppException(
      400,
      'WHATSAPP_PAYLOAD_INVALID',
      'WhatsApp payload is invalid',
    );
  }
  return `+${digits}`;
}

function normalizedInput(message: UnknownRecord): NormalizedInput | undefined {
  const messageType = text(message.type);
  if (messageType === 'text') {
    const body = text(record(message.text)?.body);
    return body ? { kind: 'TEXT', text: body } : undefined;
  }
  if (messageType !== 'interactive') return undefined;

  const interactive = record(message.interactive);
  const reply =
    record(interactive?.button_reply) ?? record(interactive?.list_reply);
  const selectionId = text(reply?.id);
  if (!selectionId) return undefined;
  const title = text(reply?.title);
  return {
    kind: 'INTERACTIVE',
    selectionId,
    ...(title ? { title } : {}),
  };
}

function occurredAt(timestamp: unknown): string | undefined {
  const value = text(timestamp);
  if (!value || !/^\d{1,13}$/.test(value)) return undefined;
  const date = new Date(Number(value) * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeWhatsAppPayload(
  payload: unknown,
): NormalizedInboundEvent[] {
  const root = record(payload);
  if (!root) {
    throw new AppException(
      400,
      'WHATSAPP_PAYLOAD_INVALID',
      'WhatsApp payload is invalid',
    );
  }

  const events: NormalizedInboundEvent[] = [];
  for (const entry of records(root.entry)) {
    for (const change of records(entry.changes)) {
      const value = record(change.value);
      const externalAccountId = text(record(value?.metadata)?.phone_number_id);
      if (!value || !externalAccountId) continue;

      const contactNames = new Map(
        records(value.contacts).flatMap((contact) => {
          const id = text(contact.wa_id);
          const name = text(record(contact.profile)?.name);
          return id && name ? [[id, name] as const] : [];
        }),
      );
      for (const message of records(value.messages)) {
        const providerMessageId = text(message.id);
        const from = text(message.from);
        const input = normalizedInput(message);
        if (!providerMessageId || !from || !input) continue;
        const externalThreadId = normalizeWhatsAppPhone(from);
        const customerDisplayName = contactNames.get(from);
        const timestamp = occurredAt(message.timestamp);
        events.push({
          providerEventId: providerMessageId,
          providerMessageId,
          externalAccountId,
          externalThreadId,
          ...(customerDisplayName ? { customerDisplayName } : {}),
          ...(timestamp ? { occurredAt: timestamp } : {}),
          input,
        });
      }
    }
  }
  return events;
}
