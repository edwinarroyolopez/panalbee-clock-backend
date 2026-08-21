import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import {
  ChannelType,
  NormalizedInboundEvent,
} from '../channels/channel-adapter';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { INDEX_NAMES, isNamedDuplicateKey } from '../database/models';
import { CONVERSATION_COMMAND_HANDLER } from './conversation-command.port';
import type { ConversationCommandHandler } from './conversation-command.port';
import { ConversationEngineStore } from './conversation-engine.store';
import { recordConversationHistory } from './conversation-persistence';
import { transitionConversation } from './conversation-state-machine';
import { QueuedConversationMessage } from './conversation.types';

export interface InboundProcessingResult {
  duplicate: boolean;
  conversationId?: string;
  queuedMessages: QueuedConversationMessage[];
}

@Injectable()
export class ConversationEngineService {
  private readonly store: ConversationEngineStore;

  constructor(
    private readonly database: DatabaseService,
    @Optional()
    @Inject(CONVERSATION_COMMAND_HANDLER)
    private readonly commandHandler?: ConversationCommandHandler,
  ) {
    this.store = new ConversationEngineStore(database);
  }

  async processInbound(
    channelType: ChannelType,
    event: NormalizedInboundEvent,
    payloadHash: string,
  ): Promise<InboundProcessingResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.withTransaction((session) =>
          this.processTransaction(session, channelType, event, payloadHash),
        );
      } catch (error) {
        if (isNamedDuplicateKey(error, INDEX_NAMES.providerEventIdempotency)) {
          return { duplicate: true, queuedMessages: [] };
        }
        if (attempt < 2 && this.isIdentityRace(error)) continue;
        throw error;
      }
    }
    throw new Error('Conversation transaction retry limit exceeded');
  }

  private async processTransaction(
    session: ClientSession,
    channelType: ChannelType,
    event: NormalizedInboundEvent,
    payloadHash: string,
  ): Promise<InboundProcessingResult> {
    const channel = await this.store.resolveChannel(
      session,
      channelType,
      event.externalAccountId,
    );
    const providerEvent = new this.database.models.providerEvent({
      tenantId: channel.tenantId,
      channelId: channel.id,
      providerEventId: event.providerEventId,
      payloadHash,
      normalizedEvent: { ...event },
    });
    await providerEvent.save({ session });
    const customerId = await this.store.upsertCustomer(
      session,
      channel.tenantId,
      event.externalThreadId,
      event.customerDisplayName,
    );
    const conversation = await this.store.loadConversation(
      session,
      channel,
      customerId,
      event.externalThreadId,
    );
    await this.database.models.message.create(
      [
        {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          channelId: channel.id,
          direction: 'INBOUND',
          kind: event.input.kind,
          content: { input: event.input, occurredAt: event.occurredAt },
          providerMessageId: event.providerMessageId,
          deliveryStatus: 'RECEIVED',
        },
      ],
      { session },
    );

    if (
      conversation.controlStatus === 'HUMAN' ||
      conversation.state === 'HUMAN_HANDOFF'
    ) {
      await this.store.markProcessed(session, providerEvent._id);
      return {
        duplicate: false,
        conversationId: conversation.id,
        queuedMessages: [],
      };
    }

    const transition = transitionConversation(
      conversation.state,
      conversation.context,
      event.input,
    );
    if (transition.command) {
      if (!this.commandHandler) {
        throw new AppException(
          503,
          'CONVERSATION_COMMAND_UNAVAILABLE',
          'Booking commands are temporarily unavailable',
        );
      }
      await this.commandHandler.handle(
        {
          tenantId: channel.tenantId,
          conversationId: conversation.id,
          customerId,
          command: transition.command,
        },
        session,
      );
    }

    await this.database.models.conversation.updateOne(
      { _id: conversation.id, tenantId: channel.tenantId },
      { $set: { state: transition.state, context: transition.context } },
      { session, runValidators: true },
    );
    if (transition.state !== conversation.state) {
      await recordConversationHistory(
        this.database,
        session,
        channel.tenantId,
        conversation.id,
        conversation.state,
        transition.state,
        transition.context,
      );
    }
    const queuedMessages = await this.store.queueReplies(
      session,
      channel,
      conversation.id,
      transition.replies,
    );
    await this.store.markProcessed(session, providerEvent._id);
    return {
      duplicate: false,
      conversationId: conversation.id,
      queuedMessages,
    };
  }

  private isIdentityRace(error: unknown): boolean {
    return (
      isNamedDuplicateKey(error, INDEX_NAMES.customerPhone) ||
      isNamedDuplicateKey(error, INDEX_NAMES.conversationExternalIdentity)
    );
  }
}
