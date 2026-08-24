import type {
  AffiliatePayoutEntity,
  AppointmentStatus,
} from '../database/models';
import type { CustomerView } from '../customers/customers.service';
import type { AffiliateCodeView } from './affiliate.view';

export interface AffiliateFinanceBalanceView {
  currency: string;
  expectedMinor: number;
  earnedMinor: number;
  paidMinor: number;
  reservedMinor: number;
  balanceMinor: number;
  availableMinor: number;
}

export interface AffiliateActivityView {
  id: string;
  createdAt: string;
  code: string;
  state: 'EXPECTED' | 'EARNED' | 'REVERSED' | 'NOT_EARNED';
  appointment: {
    id: string;
    status: AppointmentStatus;
    startsAt: string;
    endsAt: string;
  };
  service: { id: string; name: string };
  referredCustomer: { id: string; fullName: string };
  economics: {
    grossAmountMinor: number;
    discountAmountMinor: number;
    finalAmountMinor: number;
    commissionAmountMinor: number;
    currency: string;
  };
  ledger: Array<{
    id: string;
    type: 'COMMISSION_EARNED' | 'COMMISSION_REVERSAL';
    direction: 'CREDIT' | 'DEBIT';
    amountMinor: number;
    createdAt: string;
  }>;
}

export interface AffiliatePayoutView {
  id: string;
  currency: string;
  amountMinor: number;
  method: 'MANUAL';
  status: 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
  externalReference: string | null;
  reason: string | null;
  paidAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface AffiliateDetailView {
  customer: CustomerView;
  codes: AffiliateCodeView[];
  balances: AffiliateFinanceBalanceView[];
  activity: AffiliateActivityView[];
  payouts: AffiliatePayoutView[];
  history: {
    limit: number;
    codesTruncated: boolean;
    activityTruncated: boolean;
    payoutsTruncated: boolean;
  };
}

export function affiliatePayoutView(
  payout: AffiliatePayoutEntity,
): AffiliatePayoutView {
  return {
    id: payout._id,
    currency: payout.currency,
    amountMinor: payout.amountMinor,
    method: payout.method,
    status: payout.status,
    externalReference: payout.externalReference ?? null,
    reason: payout.reason ?? null,
    paidAt: payout.paidAt?.toISOString() ?? null,
    failedAt: payout.failedAt?.toISOString() ?? null,
    cancelledAt: payout.cancelledAt?.toISOString() ?? null,
    createdAt: payout.createdAt.toISOString(),
  };
}
