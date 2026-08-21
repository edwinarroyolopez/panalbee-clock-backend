import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  documentOptions,
  optionalUuidField,
  requiredUuidField,
  TimestampedEntity,
  UuidEntity,
  uuidField,
} from './schema-helpers';

export type ConversationState =
  | 'MAIN_MENU'
  | 'BOOKING_SERVICE'
  | 'BOOKING_PROFESSIONAL'
  | 'BOOKING_DATE'
  | 'BOOKING_TIME'
  | 'BOOKING_CUSTOMER_DATA'
  | 'BOOKING_CONFIRMATION'
  | 'RESCHEDULE_SELECT_APPOINTMENT'
  | 'RESCHEDULE_DATE'
  | 'RESCHEDULE_TIME'
  | 'CANCEL_SELECT_APPOINTMENT'
  | 'CANCEL_CONFIRMATION'
  | 'HUMAN_HANDOFF';

const CONVERSATION_STATES: ConversationState[] = [
  'MAIN_MENU',
  'BOOKING_SERVICE',
  'BOOKING_PROFESSIONAL',
  'BOOKING_DATE',
  'BOOKING_TIME',
  'BOOKING_CUSTOMER_DATA',
  'BOOKING_CONFIRMATION',
  'RESCHEDULE_SELECT_APPOINTMENT',
  'RESCHEDULE_DATE',
  'RESCHEDULE_TIME',
  'CANCEL_SELECT_APPOINTMENT',
  'CANCEL_CONFIRMATION',
  'HUMAN_HANDOFF',
];

export interface ChannelEntity extends TimestampedEntity {
  tenantId: string;
  type: 'WHATSAPP' | 'WEB' | 'INSTAGRAM' | 'MESSENGER' | 'OTHER';
  externalAccountId: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface ConversationEntity extends TimestampedEntity {
  tenantId: string;
  customerId: string;
  channelId: string;
  externalThreadId: string;
  state: ConversationState;
  context: Record<string, unknown>;
  controlStatus: 'BOT' | 'HUMAN';
  assignedTo?: string | null;
  status: 'OPEN' | 'CLOSED';
}

export interface ConversationStateHistoryEntity extends UuidEntity {
  tenantId: string;
  conversationId: string;
  fromState?: ConversationState | null;
  toState: ConversationState;
  context: Record<string, unknown>;
  createdAt: Date;
}

export interface MessageEntity extends UuidEntity {
  tenantId: string;
  conversationId: string;
  channelId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  kind: 'TEXT' | 'INTERACTIVE' | 'TEMPLATE' | 'SYSTEM';
  content: Record<string, unknown>;
  providerMessageId?: string | null;
  deliveryStatus:
    'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';
  sentBy?: string | null;
  createdAt: Date;
}

export interface ProviderEventEntity extends UuidEntity {
  tenantId: string;
  channelId: string;
  providerEventId: string;
  payloadHash: string;
  normalizedEvent: Record<string, unknown>;
  processedAt?: Date | null;
  createdAt: Date;
}

export interface AuditEventEntity extends UuidEntity {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorType:
    'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER' | 'SYSTEM' | 'CHANNEL';
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  requestId?: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export const ChannelSchema: Schema<ChannelEntity> = new Schema<ChannelEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    type: {
      type: String,
      enum: ['WHATSAPP', 'WEB', 'INSTAGRAM', 'MESSENGER', 'OTHER'],
      required: true,
    },
    externalAccountId: { type: String, required: true },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
  },
  documentOptions<ChannelEntity>('channels'),
);
ChannelSchema.index(
  { type: 1, externalAccountId: 1 },
  { unique: true, name: INDEX_NAMES.channelExternalIdentity },
);

export const ConversationSchema: Schema<ConversationEntity> =
  new Schema<ConversationEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      customerId: requiredUuidField(),
      channelId: requiredUuidField(),
      externalThreadId: { type: String, required: true },
      state: { type: String, enum: CONVERSATION_STATES, default: 'MAIN_MENU' },
      context: { type: Schema.Types.Mixed, default: {} },
      controlStatus: { type: String, enum: ['BOT', 'HUMAN'], default: 'BOT' },
      assignedTo: optionalUuidField(),
      status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    },
    documentOptions<ConversationEntity>('conversations'),
  );
ConversationSchema.index(
  { tenantId: 1, channelId: 1, externalThreadId: 1 },
  { unique: true, name: INDEX_NAMES.conversationExternalIdentity },
);
ConversationSchema.index(
  { tenantId: 1, customerId: 1, updatedAt: -1 },
  { name: INDEX_NAMES.conversationCustomer },
);

export const ConversationStateHistorySchema: Schema<ConversationStateHistoryEntity> =
  new Schema<ConversationStateHistoryEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      conversationId: requiredUuidField(),
      fromState: { type: String, enum: CONVERSATION_STATES },
      toState: { type: String, enum: CONVERSATION_STATES, required: true },
      context: { type: Schema.Types.Mixed, default: {} },
    },
    createdAtOptions<ConversationStateHistoryEntity>(
      'conversation_state_history',
    ),
  );
ConversationStateHistorySchema.index(
  { tenantId: 1, conversationId: 1, createdAt: 1, _id: 1 },
  { name: INDEX_NAMES.conversationHistory },
);

export const MessageSchema: Schema<MessageEntity> = new Schema<MessageEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    conversationId: requiredUuidField(),
    channelId: requiredUuidField(),
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true },
    kind: {
      type: String,
      enum: ['TEXT', 'INTERACTIVE', 'TEMPLATE', 'SYSTEM'],
      default: 'TEXT',
    },
    content: { type: Schema.Types.Mixed, required: true },
    providerMessageId: { type: String },
    deliveryStatus: {
      type: String,
      enum: ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'],
      default: 'PENDING',
    },
    sentBy: optionalUuidField(),
  },
  createdAtOptions<MessageEntity>('messages'),
);
MessageSchema.index(
  { tenantId: 1, conversationId: 1, createdAt: 1, _id: 1 },
  { name: INDEX_NAMES.messageConversation },
);
MessageSchema.index(
  { tenantId: 1, channelId: 1, providerMessageId: 1 },
  {
    unique: true,
    name: INDEX_NAMES.messageProviderId,
    partialFilterExpression: { providerMessageId: { $type: 'string' } },
  },
);

export const ProviderEventSchema: Schema<ProviderEventEntity> =
  new Schema<ProviderEventEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      channelId: requiredUuidField(),
      providerEventId: { type: String, required: true },
      payloadHash: { type: String, required: true },
      normalizedEvent: { type: Schema.Types.Mixed, required: true },
      processedAt: { type: Date },
    },
    createdAtOptions<ProviderEventEntity>('provider_events'),
  );
ProviderEventSchema.index(
  { tenantId: 1, channelId: 1, providerEventId: 1 },
  { unique: true, name: INDEX_NAMES.providerEventIdempotency },
);

export const AUDIT_APPEND_ONLY_ERROR = 'audit events are append-only';
export const AuditEventSchema: Schema<AuditEventEntity> =
  new Schema<AuditEventEntity>(
    {
      _id: uuidField(),
      tenantId: optionalUuidField(),
      actorUserId: optionalUuidField(),
      actorType: {
        type: String,
        enum: ['TENANT_USER', 'INTERNAL_USER', 'CUSTOMER', 'SYSTEM', 'CHANNEL'],
        required: true,
      },
      action: { type: String, required: true },
      entityType: { type: String, required: true },
      entityId: { type: String, required: true },
      reason: { type: String },
      requestId: { type: String },
      metadata: { type: Schema.Types.Mixed, default: {} },
    },
    createdAtOptions<AuditEventEntity>('audit_events'),
  );
AuditEventSchema.index(
  { tenantId: 1, createdAt: -1, _id: -1 },
  { name: INDEX_NAMES.auditOrdering },
);
AuditEventSchema.pre('save', function () {
  if (!this.isNew) throw new Error(AUDIT_APPEND_ONLY_ERROR);
});
AuditEventSchema.pre(/^(?:update|replace|delete|findOneAnd)/, function () {
  throw new Error(AUDIT_APPEND_ONLY_ERROR);
});
AuditEventSchema.pre('bulkWrite', function () {
  throw new Error(AUDIT_APPEND_ONLY_ERROR);
});
AuditEventSchema.pre(
  'deleteOne',
  { document: true, query: false },
  function () {
    throw new Error(AUDIT_APPEND_ONLY_ERROR);
  },
);
AuditEventSchema.pre(
  'updateOne',
  { document: true, query: false },
  function () {
    throw new Error(AUDIT_APPEND_ONLY_ERROR);
  },
);
