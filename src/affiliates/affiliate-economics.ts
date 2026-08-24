import { AppException } from '../common/app-exception';
import type {
  AffiliateCodeEntity,
  CommissionType,
  DiscountType,
  ServiceEntity,
} from '../database/models';
import type { AffiliateTermsDto } from './affiliate.dto';

export interface AffiliateEconomics {
  grossAmountMinor: number;
  discountValueMinor: number;
  finalAmountMinor: number;
  commissionValueMinor: number;
  currency: string;
}

export interface NormalizedAffiliateTerms {
  discountType: DiscountType;
  discountBasisPoints?: number;
  discountAmountMinor?: number;
  discountCurrency?: string;
  commissionType: CommissionType;
  commissionBasisPoints?: number;
  commissionAmountMinor?: number;
  commissionCurrency?: string;
  commissionBase: 'NET_AFTER_DISCOUNT';
  startsAt?: Date;
  expiresAt?: Date;
}

export function normalizeAffiliateCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeAffiliateTerms(
  dto: AffiliateTermsDto,
): NormalizedAffiliateTerms {
  const discountFieldsValid =
    (dto.discountType === 'NONE' &&
      dto.discountBasisPoints === undefined &&
      dto.discountAmountMinor === undefined &&
      dto.discountCurrency === undefined) ||
    (dto.discountType === 'PERCENT' &&
      dto.discountBasisPoints !== undefined &&
      dto.discountAmountMinor === undefined &&
      dto.discountCurrency === undefined) ||
    (dto.discountType === 'FIXED' &&
      dto.discountBasisPoints === undefined &&
      dto.discountAmountMinor !== undefined &&
      dto.discountCurrency !== undefined);
  const commissionFieldsValid =
    (dto.commissionType === 'PERCENT' &&
      dto.commissionBasisPoints !== undefined &&
      dto.commissionAmountMinor === undefined &&
      dto.commissionCurrency === undefined) ||
    (dto.commissionType === 'FIXED' &&
      dto.commissionBasisPoints === undefined &&
      dto.commissionAmountMinor !== undefined &&
      dto.commissionCurrency !== undefined);
  const startsAt = dto.startsAt ? new Date(dto.startsAt) : undefined;
  const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
  if (
    !discountFieldsValid ||
    !commissionFieldsValid ||
    (startsAt && expiresAt && startsAt >= expiresAt)
  ) {
    throw new AppException(
      400,
      'AFFILIATE_TERMS_INVALID',
      'Affiliate economic terms are invalid',
    );
  }
  return {
    discountType: dto.discountType,
    ...(dto.discountBasisPoints !== undefined
      ? { discountBasisPoints: dto.discountBasisPoints }
      : {}),
    ...(dto.discountAmountMinor !== undefined
      ? { discountAmountMinor: dto.discountAmountMinor }
      : {}),
    ...(dto.discountCurrency ? { discountCurrency: dto.discountCurrency } : {}),
    commissionType: dto.commissionType,
    ...(dto.commissionBasisPoints !== undefined
      ? { commissionBasisPoints: dto.commissionBasisPoints }
      : {}),
    ...(dto.commissionAmountMinor !== undefined
      ? { commissionAmountMinor: dto.commissionAmountMinor }
      : {}),
    ...(dto.commissionCurrency
      ? { commissionCurrency: dto.commissionCurrency }
      : {}),
    commissionBase: 'NET_AFTER_DISCOUNT',
    ...(startsAt ? { startsAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function calculateAffiliateEconomics(
  code: AffiliateCodeEntity,
  service: Pick<ServiceEntity, 'priceMinor' | 'currency'>,
): AffiliateEconomics {
  if (
    (code.discountType === 'FIXED' &&
      code.discountCurrency !== service.currency) ||
    (code.commissionType === 'FIXED' &&
      code.commissionCurrency !== service.currency)
  ) {
    throw referralError('REFERRAL_CODE_CURRENCY_MISMATCH');
  }
  const grossAmountMinor = service.priceMinor;
  const discountValueMinor =
    code.discountType === 'NONE'
      ? 0
      : code.discountType === 'PERCENT'
        ? percentageOf(grossAmountMinor, code.discountBasisPoints!)
        : code.discountAmountMinor!;
  const finalAmountMinor = grossAmountMinor - discountValueMinor;
  const commissionValueMinor =
    code.commissionType === 'PERCENT'
      ? percentageOf(finalAmountMinor, code.commissionBasisPoints!)
      : code.commissionAmountMinor!;
  if (
    discountValueMinor > grossAmountMinor ||
    commissionValueMinor <= 0 ||
    commissionValueMinor > finalAmountMinor
  ) {
    throw referralError('REFERRAL_CODE_ECONOMICS_INVALID');
  }
  return {
    grossAmountMinor,
    discountValueMinor,
    finalAmountMinor,
    commissionValueMinor,
    currency: service.currency,
  };
}

function percentageOf(amountMinor: number, basisPoints: number): number {
  return Number((BigInt(amountMinor) * BigInt(basisPoints)) / 10_000n);
}

export function assertAffiliateCodeUsable(
  code: AffiliateCodeEntity,
  now = new Date(),
): void {
  if (code.status === 'INACTIVE') throw referralError('REFERRAL_CODE_INACTIVE');
  if (code.status === 'RETIRED') throw referralError('REFERRAL_CODE_RETIRED');
  if (code.startsAt && code.startsAt > now) {
    throw referralError('REFERRAL_CODE_NOT_STARTED');
  }
  if (code.expiresAt && code.expiresAt <= now) {
    throw referralError('REFERRAL_CODE_EXPIRED');
  }
}

export function referralError(reasonCode: string): AppException {
  return new AppException(400, reasonCode, 'Referral code cannot be applied');
}
