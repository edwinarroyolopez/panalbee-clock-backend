import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  CurrentAuth,
  InternalRoles,
  Public,
  TenantRoles,
} from '../auth/auth.decorators';
import type {
  AuthenticatedRequest,
  InternalAuthContext,
  TenantOperationAuthContext,
} from '../auth/auth.types';
import { TENANT_ROLES } from '../auth/auth.types';
import {
  CreateAccountDto,
  StartDelegatedSessionDto,
  UpdateAccountStatusDto,
  UpdatePublicProfileDto,
} from './accounts.dto';
import { AccountProfileService } from './account-profile.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { AccountsService } from './accounts.service';
import { DelegatedSessionService } from './delegated-session.service';
import type {
  DelegatedSessionStartResult,
  DelegatedSessionStatusResult,
} from './delegated-session.service';
import type {
  AccountAuditView,
  AccountDetailView,
  AccountListItemView,
  TenantAccountView,
} from './account.views';
import {
  PublicAccountStaffService,
  PublicAccountStaffView,
} from './public-account-staff.service';

@Controller('backoffice/accounts')
export class BackofficeAccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly provisioning: AccountProvisioningService,
    private readonly delegatedSessions: DelegatedSessionService,
  ) {}

  @InternalRoles('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')
  @Get()
  list(): Promise<{ items: AccountListItemView[] }> {
    return this.accounts.list();
  }

  @InternalRoles('PLATFORM_ADMIN')
  @Post()
  async create(
    @Body() dto: CreateAccountDto,
    @CurrentAuth() auth: InternalAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccountDetailView> {
    const accountId = await this.provisioning.provision(
      dto,
      auth,
      request.requestId,
    );
    return this.accounts.detail(accountId);
  }

  @InternalRoles('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')
  @Get(':accountId')
  detail(
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<AccountDetailView> {
    return this.accounts.detail(accountId);
  }

  @InternalRoles('PLATFORM_ADMIN')
  @Patch(':accountId/status')
  updateStatus(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateAccountStatusDto,
    @CurrentAuth() auth: InternalAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccountDetailView> {
    return this.accounts.updateStatus(accountId, dto, auth, request.requestId);
  }

  @InternalRoles('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')
  @Get(':accountId/audit')
  audit(
    @Param('accountId', ParseUUIDPipe) accountId: string,
  ): Promise<{ items: AccountAuditView[] }> {
    return this.accounts.auditTrail(accountId);
  }

  @InternalRoles('PLATFORM_ADMIN')
  @Post(':accountId/delegated-sessions')
  startDelegatedSession(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: StartDelegatedSessionDto,
    @CurrentAuth() auth: InternalAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<DelegatedSessionStartResult> {
    return this.delegatedSessions.start(
      accountId,
      dto.reason,
      auth,
      request.requestId,
    );
  }
}

@Controller('backoffice/delegated-sessions')
export class BackofficeDelegatedSessionsController {
  constructor(private readonly delegatedSessions: DelegatedSessionService) {}

  @InternalRoles('PLATFORM_ADMIN')
  @Post(':sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentAuth() auth: InternalAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<DelegatedSessionStatusResult> {
    return this.delegatedSessions.revoke(
      sessionId,
      auth.userId,
      request.requestId,
    );
  }
}

@Controller('accounts')
export class TenantAccountsController {
  constructor(private readonly profiles: AccountProfileService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get(':slug')
  account(
    @Param('slug') slug: string,
    @CurrentAuth() auth: TenantOperationAuthContext,
  ): Promise<TenantAccountView> {
    return this.profiles.get(slug, auth);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch(':slug/public-profile')
  updateProfile(
    @Param('slug') slug: string,
    @Body() dto: UpdatePublicProfileDto,
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantAccountView> {
    return this.profiles.update(slug, dto, auth, request.requestId);
  }
}

@Public()
@Controller('public/:accountSlug/staff')
export class PublicAccountStaffController {
  constructor(private readonly staff: PublicAccountStaffService) {}

  @Get()
  list(
    @Param('accountSlug') accountSlug: string,
  ): Promise<{ items: PublicAccountStaffView[] }> {
    return this.staff.list(accountSlug);
  }
}
