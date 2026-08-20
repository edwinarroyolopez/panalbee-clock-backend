import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import type {
  AuthenticatedRequest,
  TenantAuthContext,
} from '../auth/auth.types';
import {
  DeliveredMessage,
  MessageDeliveryService,
} from './message-delivery.service';
import { SendConversationMessageDto } from './messaging.dto';

@Controller('conversations')
export class ConversationMessagesController {
  constructor(private readonly delivery: MessageDeliveryService) {}

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':conversationId/messages')
  send(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendConversationMessageDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DeliveredMessage> {
    return this.delivery.sendHumanMessage(
      auth.tenant.id,
      auth.userId,
      conversationId,
      dto.text,
      request.requestId,
    );
  }
}
