import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { AuditModule } from '../audit/audit.module';
import { CustomersModule } from '../customers/customers.module';
import { AffiliateCodeService } from './affiliate-code.service';
import {
  CustomerAffiliateController,
  PublicReferralController,
} from './affiliate.controller';
import { ReferralService } from './referral.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { AffiliateLedgerService } from './affiliate-ledger.service';
import { AffiliateDetailService } from './affiliate-detail.service';
import { AffiliatePayoutService } from './affiliate-payout.service';
import { AffiliatePayoutStore } from './affiliate-payout.store';

@Module({
  imports: [AccountsModule, AuditModule, CustomersModule],
  controllers: [CustomerAffiliateController, PublicReferralController],
  providers: [
    AffiliateCodeService,
    ReferralService,
    ReferralAttributionService,
    AffiliateLedgerService,
    AffiliateDetailService,
    AffiliatePayoutService,
    AffiliatePayoutStore,
  ],
  exports: [
    AffiliateCodeService,
    ReferralService,
    ReferralAttributionService,
    AffiliateLedgerService,
  ],
})
export class AffiliatesModule {}
