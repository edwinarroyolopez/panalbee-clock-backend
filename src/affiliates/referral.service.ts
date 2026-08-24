import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import type { AffiliateCodeEntity, ServiceEntity } from '../database/models';
import type { ReferralQuoteDto } from './affiliate.dto';
import {
  AffiliateEconomics,
  assertAffiliateCodeUsable,
  calculateAffiliateEconomics,
  normalizeAffiliateCode,
  referralError,
} from './affiliate-economics';

export interface ResolvedReferral {
  code: AffiliateCodeEntity;
  economics: AffiliateEconomics;
}

export interface ReferralQuoteView {
  code: string;
  grossAmountMinor: number;
  discountAmountMinor: number;
  finalAmountMinor: number;
  currency: string;
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly database: DatabaseService,
    private readonly publicAccess: AccountPublicAccessService,
  ) {}

  async quote(
    accountSlug: string,
    dto: ReferralQuoteDto,
  ): Promise<ReferralQuoteView> {
    const { tenant } = await this.publicAccess.resolve(accountSlug);
    const service = await this.database.models.service
      .findOne({ _id: dto.serviceId, tenantId: tenant._id, active: true })
      .lean()
      .exec();
    if (!service) {
      throw new AppException(404, 'SERVICE_NOT_FOUND', 'Service not found');
    }
    const resolved = await this.resolveForBooking(
      tenant._id,
      dto.code,
      service,
    );
    return {
      code: resolved.code.normalizedCode,
      grossAmountMinor: resolved.economics.grossAmountMinor,
      discountAmountMinor: resolved.economics.discountValueMinor,
      finalAmountMinor: resolved.economics.finalAmountMinor,
      currency: resolved.economics.currency,
    };
  }

  async resolveForBooking(
    tenantId: string,
    rawCode: string,
    service: Pick<ServiceEntity, 'priceMinor' | 'currency'>,
    session?: ClientSession,
  ): Promise<ResolvedReferral> {
    const normalizedCode = normalizeAffiliateCode(rawCode);
    const code = await this.database.models.affiliateCode
      .findOne({ tenantId, normalizedCode })
      .session(session ?? null)
      .lean()
      .exec();
    if (!code) throw referralError('REFERRAL_CODE_INVALID');
    assertAffiliateCodeUsable(code);
    return { code, economics: calculateAffiliateEconomics(code, service) };
  }
}
