import type { AffiliateCodeEntity } from '../database/models';

export interface AffiliateCodeView {
  id: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED';
  discount: {
    type: 'NONE' | 'PERCENT' | 'FIXED';
    basisPoints: number | null;
    amountMinor: number | null;
    currency: string | null;
  };
  commission: {
    type: 'PERCENT' | 'FIXED';
    basisPoints: number | null;
    amountMinor: number | null;
    currency: string | null;
    base: 'NET_AFTER_DISCOUNT';
  };
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ReferralReceiptView {
  code: string;
  grossAmountMinor: number;
  discountAmountMinor: number;
  finalAmountMinor: number;
  currency: string;
}

export function affiliateCodeView(
  code: AffiliateCodeEntity,
): AffiliateCodeView {
  return {
    id: code._id,
    code: code.code,
    status: code.status,
    discount: {
      type: code.discountType,
      basisPoints: code.discountBasisPoints ?? null,
      amountMinor: code.discountAmountMinor ?? null,
      currency: code.discountCurrency ?? null,
    },
    commission: {
      type: code.commissionType,
      basisPoints: code.commissionBasisPoints ?? null,
      amountMinor: code.commissionAmountMinor ?? null,
      currency: code.commissionCurrency ?? null,
      base: code.commissionBase,
    },
    startsAt: code.startsAt?.toISOString() ?? null,
    expiresAt: code.expiresAt?.toISOString() ?? null,
    createdAt: code.createdAt.toISOString(),
  };
}
