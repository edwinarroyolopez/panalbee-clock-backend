import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  ConversationMessageView,
  ConversationQueryService,
} from './conversation-query.service';

@Controller('conversations')
export class ConversationQueryController {
  constructor(private readonly query: ConversationQueryService) {}

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Get(':conversationId/messages')
  messages(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ items: ConversationMessageView[] }> {
    return this.query.messages(auth.tenant.id, conversationId);
  }
}
