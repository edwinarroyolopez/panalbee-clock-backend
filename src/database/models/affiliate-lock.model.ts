import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  documentOptions,
  requiredUuidField,
  TimestampedEntity,
  uuidField,
} from './schema-helpers';

export interface AffiliateBalanceLockEntity extends TimestampedEntity {
  tenantId: string;
  affiliateCustomerId: string;
  currency: string;
  version: number;
}

export interface AffiliatePayoutCapacityLockEntity extends TimestampedEntity {
  tenantId: string;
  affiliateCustomerId: string;
  version: number;
}

export const AffiliateBalanceLockSchema =
  new Schema<AffiliateBalanceLockEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      affiliateCustomerId: requiredUuidField(),
      currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
      version: { type: Number, required: true, min: 0, default: 0 },
    },
    documentOptions<AffiliateBalanceLockEntity>('affiliate_balance_locks'),
  );
AffiliateBalanceLockSchema.index(
  { tenantId: 1, affiliateCustomerId: 1, currency: 1 },
  { unique: true, name: INDEX_NAMES.affiliateBalanceLock },
);

export const AffiliatePayoutCapacityLockSchema =
  new Schema<AffiliatePayoutCapacityLockEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      affiliateCustomerId: requiredUuidField(),
      version: { type: Number, required: true, min: 0, default: 0 },
    },
    documentOptions<AffiliatePayoutCapacityLockEntity>(
      'affiliate_payout_capacity_locks',
    ),
  );
AffiliatePayoutCapacityLockSchema.index(
  { tenantId: 1, affiliateCustomerId: 1 },
  { unique: true, name: INDEX_NAMES.affiliatePayoutCapacityLock },
);
