import { ClientSession } from 'mongoose';
import { ConversationCommand } from './conversation.types';

export const CONVERSATION_COMMAND_HANDLER = Symbol(
  'CONVERSATION_COMMAND_HANDLER',
);

export interface ConversationCommandEnvelope {
  tenantId: string;
  conversationId: string;
  customerId: string;
  command: ConversationCommand;
}

export interface ConversationCommandHandler {
  handle(
    envelope: ConversationCommandEnvelope,
    session: ClientSession,
  ): Promise<void>;
}
