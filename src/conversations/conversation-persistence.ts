import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { ConversationContext, ConversationState } from './conversation.types';

export async function recordConversationHistory(
  database: DatabaseService,
  session: ClientSession,
  tenantId: string,
  conversationId: string,
  fromState: ConversationState | null,
  toState: ConversationState,
  context: ConversationContext,
): Promise<void> {
  await database.models.conversationStateHistory.create(
    [
      {
        tenantId,
        conversationId,
        fromState,
        toState,
        context,
      },
    ],
    { session },
  );
}

export async function requireActiveTenantMember(
  database: DatabaseService,
  session: ClientSession,
  tenantId: string,
  userId: string,
): Promise<void> {
  const membership = await database.models.tenantMembership
    .exists({ tenantId, userId })
    .session(session)
    .exec();
  const user = membership
    ? await database.models.user
        .exists({ _id: userId, status: 'ACTIVE', actorType: 'TENANT' })
        .session(session)
        .exec()
    : null;
  if (!membership || !user) {
    throw new AppException(
      400,
      'HANDOFF_ASSIGNEE_INVALID',
      'Assignee must be an active tenant member',
    );
  }
}
