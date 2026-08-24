import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import type {
  AuthenticatedRequest,
  TenantOperationAuthContext,
} from '../auth/auth.types';
import { AffiliateCodeService } from './affiliate-code.service';
import {
  AffiliateTermsDto,
  CompleteAffiliatePayoutDto,
  CreateAffiliateCodeDto,
  CreateAffiliatePayoutDto,
  FailAffiliatePayoutDto,
  ReferralQuoteDto,
} from './affiliate.dto';
import { ReferralQuoteView, ReferralService } from './referral.service';
import type { AffiliateCodeView } from './affiliate.view';
import { AffiliateDetailService } from './affiliate-detail.service';
import type { AffiliateDetailView } from './affiliate-detail.view';
import type { AffiliatePayoutView } from './affiliate-detail.view';
import { AffiliatePayoutService } from './affiliate-payout.service';

@Controller('customers/:customerId')
export class CustomerAffiliateController {
  constructor(
    private readonly codes: AffiliateCodeService,
    private readonly details: AffiliateDetailService,
    private readonly payouts: AffiliatePayoutService,
  ) {}

  @TenantRoles('OWNER', 'MANAGER')
  @Get('affiliate')
  async detail(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<AffiliateDetailView> {
    return this.details.get(auth.tenant.id, customerId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-codes')
  create(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateAffiliateCodeDto,
  ): Promise<AffiliateCodeView> {
    return this.codes.create(auth, customerId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch('affiliate-codes/:codeId/terms')
  updateTerms(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
    @Body() dto: AffiliateTermsDto,
  ): Promise<AffiliateCodeView> {
    return this.codes.updateTerms(auth, customerId, codeId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-codes/:codeId/activate')
  activate(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.codes.activate(auth, customerId, codeId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-codes/:codeId/deactivate')
  deactivate(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.codes.deactivate(auth, customerId, codeId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-codes/:codeId/retire')
  retire(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('codeId', ParseUUIDPipe) codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.codes.retire(auth, customerId, codeId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-payouts')
  createPayout(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreateAffiliatePayoutDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AffiliatePayoutView> {
    return this.payouts.create(auth, customerId, dto, request.requestId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-payouts/:payoutId/paid')
  @HttpCode(200)
  markPayoutPaid(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: CompleteAffiliatePayoutDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AffiliatePayoutView> {
    return this.payouts.markPaid(
      auth,
      customerId,
      payoutId,
      dto,
      request.requestId,
    );
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-payouts/:payoutId/failed')
  @HttpCode(200)
  markPayoutFailed(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: FailAffiliatePayoutDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AffiliatePayoutView> {
    return this.payouts.markUnpaid(
      auth,
      customerId,
      payoutId,
      dto,
      request.requestId,
      'FAILED',
    );
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post('affiliate-payouts/:payoutId/cancelled')
  @HttpCode(200)
  cancelPayout(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: FailAffiliatePayoutDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<AffiliatePayoutView> {
    return this.payouts.markUnpaid(
      auth,
      customerId,
      payoutId,
      dto,
      request.requestId,
      'CANCELLED',
    );
  }
}

@Public()
@Controller('public/:accountSlug/referrals')
export class PublicReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Post('quote')
  @Header('Cache-Control', 'private, no-store')
  quote(
    @Param('accountSlug') accountSlug: string,
    @Body() dto: ReferralQuoteDto,
  ): Promise<ReferralQuoteView> {
    return this.referrals.quote(accountSlug, dto);
  }
}
