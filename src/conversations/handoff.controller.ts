import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import type {
  AuthenticatedRequest,
  TenantAuthContext,
} from '../auth/auth.types';
import { ConversationView } from './conversation.types';
import { ReassignConversationDto, ReleaseConversationDto } from './handoff.dto';
import { HandoffService } from './handoff.service';

const HANDOFF_ROLES = ['OWNER', 'MANAGER', 'AGENT'] as const;

@Controller('conversations')
export class HandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @TenantRoles(...HANDOFF_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
  ): Promise<{ items: ConversationView[] }> {
    return this.handoff.list(auth.tenant.id);
  }

  @TenantRoles(...HANDOFF_ROLES)
  @Post(':conversationId/handoff')
  request(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConversationView> {
    return this.handoff.request(
      auth.tenant.id,
      auth.userId,
      conversationId,
      request.requestId,
    );
  }

  @TenantRoles(...HANDOFF_ROLES)
  @Post(':conversationId/handoff/claim')
  claim(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConversationView> {
    return this.handoff.claim(
      auth.tenant.id,
      auth.userId,
      conversationId,
      request.requestId,
    );
  }

  @TenantRoles(...HANDOFF_ROLES)
  @Patch(':conversationId/handoff/assignment')
  reassign(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: ReassignConversationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConversationView> {
    return this.handoff.reassign(
      auth.tenant.id,
      auth.userId,
      conversationId,
      dto.assignedTo,
      dto.reason,
      request.requestId,
    );
  }

  @TenantRoles(...HANDOFF_ROLES)
  @Post(':conversationId/handoff/release')
  release(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: ReleaseConversationDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConversationView> {
    return this.handoff.release(
      auth.tenant.id,
      auth.userId,
      conversationId,
      dto.reason,
      request.requestId,
    );
  }
}
