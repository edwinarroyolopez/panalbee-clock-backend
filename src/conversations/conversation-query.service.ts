import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';

export interface ConversationMessageView {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  kind: string;
  content: Record<string, unknown>;
  providerMessageId: string | null;
  deliveryStatus: string;
  sentBy: string | null;
  createdAt: Date;
}

@Injectable()
export class ConversationQueryService {
  constructor(private readonly database: DatabaseService) {}

  async messages(
    tenantId: string,
    conversationId: string,
  ): Promise<{ items: ConversationMessageView[] }> {
    const conversation = await this.database.models.conversation
      .exists({ _id: conversationId, tenantId })
      .exec();
    if (!conversation) {
      throw new AppException(
        404,
        'CONVERSATION_NOT_FOUND',
        'Conversation not found',
      );
    }
    const messages = await this.database.models.message
      .find({ tenantId, conversationId })
      .sort({ createdAt: 1, _id: 1 })
      .limit(200)
      .lean()
      .exec();
    return {
      items: messages.map((message) => ({
        id: message._id,
        direction: message.direction,
        kind: message.kind,
        content: message.content,
        providerMessageId: message.providerMessageId ?? null,
        deliveryStatus: message.deliveryStatus,
        sentBy: message.sentBy ?? null,
        createdAt: message.createdAt,
      })),
    };
  }
}
