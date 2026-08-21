import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountProfileService } from './account-profile.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { AccountPublicAccessService } from './account-public-access.service';
import {
  BackofficeAccountsController,
  BackofficeDelegatedSessionsController,
  PublicAccountStaffController,
  TenantAccountsController,
} from './accounts.controller';
import { AccountsService } from './accounts.service';
import { DelegatedSessionLifecycleService } from './delegated-session-lifecycle.service';
import { DelegatedSessionService } from './delegated-session.service';
import { PublicAccountStaffService } from './public-account-staff.service';

@Module({
  imports: [AuditModule],
  controllers: [
    BackofficeAccountsController,
    BackofficeDelegatedSessionsController,
    TenantAccountsController,
    PublicAccountStaffController,
  ],
  providers: [
    AccountsService,
    DelegatedSessionService,
    DelegatedSessionLifecycleService,
    AccountProvisioningService,
    AccountProfileService,
    AccountPublicAccessService,
    PublicAccountStaffService,
  ],
  exports: [AccountPublicAccessService, DelegatedSessionService],
})
export class AccountsModule {}
