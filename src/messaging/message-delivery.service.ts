import { Injectable } from '@nestjs/common';
import { ChannelType, ReplyIntent } from '../channels/channel-adapter';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { AppException } from '../common/app-exception';
import { recordConversationAudit } from '../conversations/conversation-audit';
import { requireActiveTenantMember } from '../conversations/conversation-persistence';
import { DatabaseService } from '../database/database.service';
import { MessageEntity } from '../database/models';

interface DeliveryContext {
  message: MessageEntity;
  channelType: ChannelType;
  externalAccountId: string;
  externalThreadId: string;
}

export interface DeliveredMessage {
  id: string;
  deliveryStatus: string;
  providerMessageId: string | null;
}

@Injectable()
export class MessageDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adapters: ChannelAdapterRegistry,
  ) {}

  async sendHumanMessage(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    text: string,
    requestId: string,
  ): Promise<DeliveredMessage> {
    const messageId = await this.database.withTransaction(async (session) => {
      await requireActiveTenantMember(
        this.database,
        session,
        tenantId,
        actorUserId,
      );
      const conversation = await this.database.models.conversation
        .findOne({ _id: conversationId, tenantId })
        .session(session)
        .lean()
        .exec();
      if (!conversation) {
        throw new AppException(
          404,
          'CONVERSATION_NOT_FOUND',
          'Conversation not found',
        );
      }
      if (conversation.controlStatus !== 'HUMAN') {
        throw new AppException(
          409,
          'CONVERSATION_NOT_HUMAN',
          'Conversation is not controlled by a human',
        );
      }
      if (conversation.assignedTo !== actorUserId) {
        throw new AppException(
          403,
          'CONVERSATION_NOT_ASSIGNED',
          'Conversation is assigned to another team member',
        );
      }

      const [message] = await this.database.models.message.create(
        [
          {
            tenantId,
            conversationId,
            channelId: conversation.channelId,
            direction: 'OUTBOUND',
            kind: 'TEXT',
            content: { intent: { kind: 'TEXT', text } },
            sentBy: actorUserId,
          },
        ],
        { session },
      );
      await recordConversationAudit(this.database, session, {
        tenantId,
        actorUserId,
        action: 'CONVERSATION_MESSAGE_QUEUED',
        conversationId,
        requestId,
        metadata: { messageId: message._id },
      });
      return message._id;
    });
    return this.dispatch(messageId, tenantId);
  }

  async dispatch(
    messageId: string,
    tenantId: string,
  ): Promise<DeliveredMessage> {
    const context = await this.deliveryContext(messageId, tenantId);
    if (this.wasSent(context.message)) return this.view(context.message);
    if (
      context.message.direction !== 'OUTBOUND' ||
      !this.intent(context.message)
    ) {
      throw new AppException(
        409,
        'MESSAGE_NOT_DELIVERABLE',
        'Message cannot be delivered',
      );
    }

    let providerMessageId: string;
    try {
      const delivery = await this.adapters.get(context.channelType).send({
        externalAccountId: context.externalAccountId,
        recipientId: context.externalThreadId,
        intent: this.intent(context.message) as ReplyIntent,
        idempotencyKey: context.message._id,
      });
      providerMessageId = delivery.providerMessageId;
    } catch (error) {
      const current = await this.markFailed(context.message);
      if (current && this.wasSent(current)) return this.view(current);
      throw this.safeDeliveryError(error);
    }

    const updated = await this.database.models.message
      .findOneAndUpdate(
        {
          _id: messageId,
          tenantId,
          direction: 'OUTBOUND',
          deliveryStatus: context.message.deliveryStatus,
        },
        { $set: { deliveryStatus: 'SENT', providerMessageId } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (updated) return this.view(updated);
    const current = await this.database.models.message
      .findOne({ _id: messageId, tenantId })
      .lean()
      .exec();
    if (current && this.wasSent(current)) return this.view(current);
    throw new AppException(
      409,
      'MESSAGE_DELIVERY_STATE_CHANGED',
      'Message delivery state changed',
    );
  }

  async processPending(
    limit = 25,
  ): Promise<{ processed: number; failed: number }> {
    const messages = await this.database.models.message
      .find({
        direction: 'OUTBOUND',
        deliveryStatus: { $in: ['PENDING', 'FAILED'] },
      })
      .select({ tenantId: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .lean()
      .exec();
    let processed = 0;
    let failed = 0;
    for (const message of messages) {
      try {
        await this.dispatch(message._id, message.tenantId);
        processed += 1;
      } catch {
        failed += 1;
      }
    }
    return { processed, failed };
  }

  private async deliveryContext(
    messageId: string,
    tenantId: string,
  ): Promise<DeliveryContext> {
    const message = await this.database.models.message
      .findOne({ _id: messageId, tenantId })
      .lean()
      .exec();
    if (!message) {
      throw new AppException(404, 'MESSAGE_NOT_FOUND', 'Message not found');
    }
    const [channel, conversation] = await Promise.all([
      this.database.models.channel
        .findOne({
          _id: message.channelId,
          tenantId,
          status: 'ACTIVE',
        })
        .lean()
        .exec(),
      this.database.models.conversation
        .findOne({ _id: message.conversationId, tenantId })
        .lean()
        .exec(),
    ]);
    if (!channel || !conversation) {
      throw new AppException(
        409,
        'MESSAGE_NOT_DELIVERABLE',
        'Message cannot be delivered',
      );
    }
    return {
      message,
      channelType: channel.type,
      externalAccountId: channel.externalAccountId,
      externalThreadId: conversation.externalThreadId,
    };
  }

  private intent(message: MessageEntity): ReplyIntent | undefined {
    const intent = message.content.intent;
    return intent && typeof intent === 'object'
      ? (intent as ReplyIntent)
      : undefined;
  }

  private async markFailed(
    message: MessageEntity,
  ): Promise<MessageEntity | null> {
    await this.database.models.message.updateOne(
      {
        _id: message._id,
        tenantId: message.tenantId,
        deliveryStatus: message.deliveryStatus,
      },
      { $set: { deliveryStatus: 'FAILED' } },
      { runValidators: true },
    );
    return this.database.models.message
      .findOne({ _id: message._id, tenantId: message.tenantId })
      .lean()
      .exec();
  }

  private safeDeliveryError(error: unknown): AppException {
    const reasonCode =
      error instanceof AppException &&
      /^CHANNEL_[A-Z0-9_]+$/.test(error.reasonCode)
        ? error.reasonCode
        : 'CHANNEL_DELIVERY_UNAVAILABLE';
    const status =
      error instanceof AppException && error.statusCode >= 400
        ? error.statusCode
        : 503;
    return new AppException(
      status,
      reasonCode,
      'Channel delivery is temporarily unavailable',
    );
  }

  private wasSent(message: MessageEntity): boolean {
    return ['SENT', 'DELIVERED', 'READ'].includes(message.deliveryStatus);
  }

  private view(message: MessageEntity): DeliveredMessage {
    return {
      id: message._id,
      deliveryStatus: message.deliveryStatus,
      providerMessageId: message.providerMessageId ?? null,
    };
  }
}
