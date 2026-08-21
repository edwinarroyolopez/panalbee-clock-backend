import { ClientSession } from 'mongoose';
import { ChannelType, ReplyIntent } from '../channels/channel-adapter';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { recordConversationHistory } from './conversation-persistence';
import {
  ConversationContext,
  ConversationControl,
  ConversationState,
  QueuedConversationMessage,
} from './conversation.types';

export interface ChannelRecord {
  id: string;
  tenantId: string;
}

export interface ConversationRecord {
  id: string;
  customerId: string;
  state: ConversationState;
  context: ConversationContext;
  controlStatus: ConversationControl;
}

export class ConversationEngineStore {
  constructor(private readonly database: DatabaseService) {}

  async resolveChannel(
    session: ClientSession,
    channelType: ChannelType,
    externalAccountId: string,
  ): Promise<ChannelRecord> {
    const channel = await this.database.models.channel
      .findOne({ type: channelType, externalAccountId, status: 'ACTIVE' })
      .session(session)
      .lean()
      .exec();
    const tenant = channel
      ? await this.database.models.tenant
          .exists({ _id: channel.tenantId, status: 'ACTIVE' })
          .session(session)
          .exec()
      : null;
    if (!channel || !tenant) {
      throw new AppException(404, 'CHANNEL_NOT_FOUND', 'Channel not found');
    }
    return { id: channel._id, tenantId: channel.tenantId };
  }

  async upsertCustomer(
    session: ClientSession,
    tenantId: string,
    phone: string,
    suppliedName?: string,
  ): Promise<string> {
    const candidate = suppliedName?.trim().slice(0, 160);
    const fullName = candidate && candidate.length >= 2 ? candidate : phone;
    const customer = await this.database.models.customer
      .findOneAndUpdate(
        { tenantId, phone },
        { $setOnInsert: { tenantId, phone, fullName } },
        {
          upsert: true,
          returnDocument: 'after',
          runValidators: true,
          session,
        },
      )
      .lean()
      .exec();
    if (!customer) throw new Error('Customer upsert did not return a document');
    return customer._id;
  }

  async loadConversation(
    session: ClientSession,
    channel: ChannelRecord,
    customerId: string,
    externalThreadId: string,
  ): Promise<ConversationRecord> {
    const existing = await this.database.models.conversation
      .findOne({
        tenantId: channel.tenantId,
        channelId: channel.id,
        externalThreadId,
      })
      .session(session)
      .lean()
      .exec();
    if (existing) return this.record(existing);

    const [created] = await this.database.models.conversation.create(
      [
        {
          tenantId: channel.tenantId,
          customerId,
          channelId: channel.id,
          externalThreadId,
        },
      ],
      { session },
    );
    await recordConversationHistory(
      this.database,
      session,
      channel.tenantId,
      created._id,
      null,
      'MAIN_MENU',
      {},
    );
    return this.record(created);
  }

  async queueReplies(
    session: ClientSession,
    channel: ChannelRecord,
    conversationId: string,
    replies: ReplyIntent[],
  ): Promise<QueuedConversationMessage[]> {
    if (replies.length === 0) return [];
    const messages = await this.database.models.message.create(
      replies.map((reply) => ({
        tenantId: channel.tenantId,
        conversationId,
        channelId: channel.id,
        direction: 'OUTBOUND' as const,
        kind: reply.kind,
        content: { intent: reply },
      })),
      { session },
    );
    return messages.map((message) => ({
      id: message._id,
      tenantId: channel.tenantId,
    }));
  }

  async markProcessed(session: ClientSession, eventId: string): Promise<void> {
    await this.database.models.providerEvent.updateOne(
      { _id: eventId },
      { $set: { processedAt: new Date() } },
      { session },
    );
  }

  private record(value: {
    _id: string;
    customerId: string;
    state: ConversationState;
    context: Record<string, unknown>;
    controlStatus: ConversationControl;
  }): ConversationRecord {
    return {
      id: value._id,
      customerId: value.customerId,
      state: value.state,
      context: value.context as ConversationContext,
      controlStatus: value.controlStatus,
    };
  }
}
