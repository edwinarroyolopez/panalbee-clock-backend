import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { ConversationEntity } from '../database/models';
import { recordConversationAudit } from './conversation-audit';
import {
  recordConversationHistory,
  requireActiveTenantMember,
} from './conversation-persistence';
import {
  ConversationContext,
  ConversationControl,
  ConversationState,
  ConversationView,
} from './conversation.types';

@Injectable()
export class HandoffService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<{ items: ConversationView[] }> {
    const conversations = await this.database.models.conversation
      .find({ tenantId })
      .sort({ updatedAt: -1, _id: 1 })
      .lean()
      .exec();
    return {
      items: conversations.map((conversation) => this.view(conversation)),
    };
  }

  request(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationView> {
    return this.database.withTransaction(async (session) => {
      await this.requireMember(session, tenantId, actorUserId);
      const conversation = await this.load(session, tenantId, conversationId);
      if (conversation.controlStatus === 'HUMAN') {
        throw new AppException(
          409,
          'CONVERSATION_ALREADY_HUMAN',
          'Conversation is already controlled by a human',
        );
      }
      if (conversation.state === 'HUMAN_HANDOFF') {
        return this.view(conversation);
      }

      const updated = await this.updateControl(
        session,
        tenantId,
        conversationId,
        'HUMAN_HANDOFF',
        'BOT',
        null,
        conversation.context as ConversationContext,
      );
      await recordConversationHistory(
        this.database,
        session,
        tenantId,
        conversationId,
        conversation.state,
        'HUMAN_HANDOFF',
        conversation.context as ConversationContext,
      );
      await this.audit(session, {
        tenantId,
        actorUserId,
        action: 'CONVERSATION_HANDOFF_REQUESTED',
        conversationId,
        requestId,
      });
      return this.view(updated);
    });
  }

  claim(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ConversationView> {
    return this.database.withTransaction(async (session) => {
      await this.requireMember(session, tenantId, actorUserId);
      const conversation = await this.load(session, tenantId, conversationId);
      if (
        conversation.controlStatus === 'HUMAN' &&
        conversation.assignedTo === actorUserId
      ) {
        return this.view(conversation);
      }
      if (
        conversation.controlStatus !== 'BOT' ||
        conversation.state !== 'HUMAN_HANDOFF'
      ) {
        throw new AppException(
          409,
          'HANDOFF_NOT_CLAIMABLE',
          'Conversation handoff cannot be claimed',
        );
      }

      const updated = await this.updateControl(
        session,
        tenantId,
        conversationId,
        'HUMAN_HANDOFF',
        'HUMAN',
        actorUserId,
        conversation.context as ConversationContext,
      );
      await this.audit(session, {
        tenantId,
        actorUserId,
        action: 'CONVERSATION_HANDOFF_CLAIMED',
        conversationId,
        requestId,
      });
      return this.view(updated);
    });
  }

  reassign(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    assignedTo: string,
    reason: string,
    requestId: string,
  ): Promise<ConversationView> {
    return this.database.withTransaction(async (session) => {
      await this.requireMember(session, tenantId, actorUserId);
      const conversation = await this.load(session, tenantId, conversationId);
      if (conversation.controlStatus !== 'HUMAN') {
        throw new AppException(
          409,
          'CONVERSATION_NOT_HUMAN',
          'Conversation is not controlled by a human',
        );
      }
      await this.requireMember(session, tenantId, assignedTo);
      const updated = await this.updateControl(
        session,
        tenantId,
        conversationId,
        conversation.state,
        'HUMAN',
        assignedTo,
        conversation.context as ConversationContext,
      );
      await this.audit(session, {
        tenantId,
        actorUserId,
        action: 'CONVERSATION_HANDOFF_REASSIGNED',
        conversationId,
        requestId,
        reason,
        metadata: {
          previousAssignee: conversation.assignedTo,
          assignedTo,
        },
      });
      return this.view(updated);
    });
  }

  release(
    tenantId: string,
    actorUserId: string,
    conversationId: string,
    reason: string,
    requestId: string,
  ): Promise<ConversationView> {
    return this.database.withTransaction(async (session) => {
      await this.requireMember(session, tenantId, actorUserId);
      const conversation = await this.load(session, tenantId, conversationId);
      if (conversation.controlStatus !== 'HUMAN') {
        throw new AppException(
          409,
          'CONVERSATION_NOT_HUMAN',
          'Conversation is not controlled by a human',
        );
      }
      const updated = await this.updateControl(
        session,
        tenantId,
        conversationId,
        'MAIN_MENU',
        'BOT',
        null,
        {},
      );
      await recordConversationHistory(
        this.database,
        session,
        tenantId,
        conversationId,
        conversation.state,
        'MAIN_MENU',
        {},
      );
      await this.audit(session, {
        tenantId,
        actorUserId,
        action: 'CONVERSATION_HANDOFF_RELEASED',
        conversationId,
        requestId,
        reason,
        metadata: { previousAssignee: conversation.assignedTo },
      });
      return this.view(updated);
    });
  }

  private requireMember(
    session: ClientSession,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    return requireActiveTenantMember(this.database, session, tenantId, userId);
  }

  private async load(
    session: ClientSession,
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationEntity> {
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
    return conversation;
  }

  private async updateControl(
    session: ClientSession,
    tenantId: string,
    conversationId: string,
    state: ConversationState,
    controlStatus: ConversationControl,
    assignedTo: string | null,
    context: ConversationContext,
  ): Promise<ConversationEntity> {
    const conversation = await this.database.models.conversation
      .findOneAndUpdate(
        { _id: conversationId, tenantId },
        { $set: { state, controlStatus, assignedTo, context } },
        { returnDocument: 'after', runValidators: true, session },
      )
      .lean()
      .exec();
    if (!conversation) {
      throw new AppException(
        404,
        'CONVERSATION_NOT_FOUND',
        'Conversation not found',
      );
    }
    return conversation;
  }

  private audit(
    session: ClientSession,
    input: Parameters<typeof recordConversationAudit>[2],
  ): Promise<void> {
    return recordConversationAudit(this.database, session, input);
  }

  private view(conversation: ConversationEntity): ConversationView {
    return {
      id: conversation._id,
      tenantId: conversation.tenantId,
      customerId: conversation.customerId,
      channelId: conversation.channelId,
      externalThreadId: conversation.externalThreadId,
      state: conversation.state,
      context: conversation.context as ConversationContext,
      controlStatus: conversation.controlStatus,
      assignedTo: conversation.assignedTo ?? null,
      status: conversation.status,
      updatedAt: conversation.updatedAt,
    };
  }
}
