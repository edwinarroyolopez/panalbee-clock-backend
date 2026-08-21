import { ClientSession } from 'mongoose';
import { DatabaseService } from '../database/database.service';

export interface ConversationAuditInput {
  tenantId: string;
  actorUserId: string;
  action: string;
  conversationId: string;
  requestId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export async function recordConversationAudit(
  database: DatabaseService,
  session: ClientSession,
  input: ConversationAuditInput,
): Promise<void> {
  const audit = new database.models.auditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    actorType: 'TENANT_USER',
    action: input.action,
    entityType: 'conversation',
    entityId: input.conversationId,
    reason: input.reason,
    requestId: input.requestId,
    metadata: input.metadata ?? {},
  });
  await audit.save({ session });
}
