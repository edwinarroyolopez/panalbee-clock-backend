import type { AffiliateCodeEntity, ServiceEntity } from '../database/models';
import {
  calculateAffiliateEconomics,
  normalizeAffiliateCode,
  normalizeAffiliateTerms,
} from './affiliate-economics';

function code(values: Partial<AffiliateCodeEntity> = {}): AffiliateCodeEntity {
  return {
    _id: '10000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000002',
    customerId: '10000000-0000-4000-8000-000000000003',
    code: 'SAVE10',
    normalizedCode: 'SAVE10',
    status: 'ACTIVE',
    discountType: 'PERCENT',
    discountBasisPoints: 1_000,
    commissionType: 'PERCENT',
    commissionBasisPoints: 2_000,
    commissionBase: 'NET_AFTER_DISCOUNT',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...values,
  };
}

const service = {
  priceMinor: 10_005,
  currency: 'COP',
} as ServiceEntity;

describe('affiliate economics', () => {
  it('normalizes code text and computes integer net-after-discount economics', () => {
    expect(normalizeAffiliateCode(' save10 ')).toBe('SAVE10');
    expect(calculateAffiliateEconomics(code(), service)).toEqual({
      grossAmountMinor: 10_005,
      discountValueMinor: 1_000,
      finalAmountMinor: 9_005,
      commissionValueMinor: 1_801,
      currency: 'COP',
    });
  });

  it('keeps percentage arithmetic exact at the safe integer boundary', () => {
    const grossAmountMinor = Number.MAX_SAFE_INTEGER;
    const result = calculateAffiliateEconomics(
      code({ discountBasisPoints: 3_333, commissionBasisPoints: 7_777 }),
      { priceMinor: grossAmountMinor, currency: 'COP' },
    );
    const discountAmountMinor = Number(
      (BigInt(grossAmountMinor) * 3_333n) / 10_000n,
    );
    const finalAmountMinor = grossAmountMinor - discountAmountMinor;
    expect(result).toEqual({
      grossAmountMinor,
      discountValueMinor: discountAmountMinor,
      finalAmountMinor,
      commissionValueMinor: Number(
        (BigInt(finalAmountMinor) * 7_777n) / 10_000n,
      ),
      currency: 'COP',
    });
  });

  it('rejects contradictory term shapes', () => {
    expect(() =>
      normalizeAffiliateTerms({
        discountType: 'PERCENT',
        discountBasisPoints: 1_000,
        discountAmountMinor: 50,
        commissionType: 'FIXED',
        commissionAmountMinor: 100,
        commissionCurrency: 'COP',
      }),
    ).toThrow('Affiliate economic terms are invalid');
  });

  it('rejects currency mismatches and economics exceeding final price', () => {
    expect(() =>
      calculateAffiliateEconomics(
        code({
          discountType: 'FIXED',
          discountBasisPoints: undefined,
          discountAmountMinor: 100,
          discountCurrency: 'USD',
        }),
        service,
      ),
    ).toThrow('Referral code cannot be applied');
    expect(() =>
      calculateAffiliateEconomics(
        code({
          commissionType: 'FIXED',
          commissionBasisPoints: undefined,
          commissionAmountMinor: 20_000,
          commissionCurrency: 'COP',
        }),
        service,
      ),
    ).toThrow('Referral code cannot be applied');
  });
});
