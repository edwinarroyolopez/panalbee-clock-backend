import type {
  TenantAuthContext,
  TenantOperationAuthContext,
} from '../auth/auth.types';
import { AppException } from '../common/app-exception';

export const MAX_PROCESSING_AFFILIATE_PAYOUTS = 100;

export function assertDirectTenant(
  auth: TenantOperationAuthContext,
): asserts auth is TenantAuthContext {
  if (auth.actorType !== 'TENANT') {
    throw new AppException(
      403,
      'AFFILIATE_PAYOUT_DIRECT_SESSION_REQUIRED',
      'Payout changes require a direct tenant session',
    );
  }
}

export function optionalPayoutText(value?: string): string | undefined {
  return value?.trim() || undefined;
}

export function requiredPayoutText(
  value: string,
  field: 'reference' | 'reason',
): string {
  const normalized = value.trim();
  const minimum = field === 'reference' ? 2 : 6;
  if (normalized.length < minimum) {
    throw new AppException(
      400,
      field === 'reference'
        ? 'AFFILIATE_PAYOUT_REFERENCE_INVALID'
        : 'AFFILIATE_PAYOUT_REASON_INVALID',
      `Payout ${field} is invalid`,
    );
  }
  return normalized;
}

export function insufficientBalance(): AppException {
  return new AppException(
    409,
    'AFFILIATE_PAYOUT_INSUFFICIENT_AVAILABLE',
    'Available affiliate balance is insufficient',
  );
}

export function payoutProcessingLimit(): AppException {
  return new AppException(
    409,
    'AFFILIATE_PAYOUT_PROCESSING_LIMIT',
    'Resolve an existing processing payout before creating another',
  );
}

export function payoutNotFound(): AppException {
  return new AppException(
    404,
    'AFFILIATE_PAYOUT_NOT_FOUND',
    'Payout not found',
  );
}

export function payoutConflict(): AppException {
  return new AppException(
    409,
    'AFFILIATE_PAYOUT_IDEMPOTENCY_CONFLICT',
    'Payout command conflicts with existing history',
  );
}
