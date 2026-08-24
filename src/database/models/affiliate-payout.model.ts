import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  documentOptions,
  requiredUuidField,
  TimestampedEntity,
  uuidField,
} from './schema-helpers';

export type AffiliatePayoutStatus =
  'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface AffiliatePayoutEntity extends TimestampedEntity {
  tenantId: string;
  affiliateCustomerId: string;
  currency: string;
  amountMinor: number;
  method: 'MANUAL';
  status: AffiliatePayoutStatus;
  createdByUserId: string;
  createIdempotencyKey: string;
  createExternalReference?: string;
  terminalIdempotencyKey?: string;
  externalReference?: string;
  reason?: string;
  paidAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
}

export const AffiliatePayoutSchema = new Schema<AffiliatePayoutEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    affiliateCustomerId: requiredUuidField(),
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    },
    method: { type: String, enum: ['MANUAL'], required: true },
    status: {
      type: String,
      enum: ['PROCESSING', 'PAID', 'FAILED', 'CANCELLED'],
      required: true,
    },
    createdByUserId: requiredUuidField(),
    createIdempotencyKey: { type: String, required: true },
    createExternalReference: { type: String },
    terminalIdempotencyKey: { type: String },
    externalReference: { type: String },
    reason: { type: String },
    paidAt: { type: Date },
    failedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  documentOptions<AffiliatePayoutEntity>('affiliate_payouts'),
);
AffiliatePayoutSchema.index(
  { tenantId: 1, affiliateCustomerId: 1, currency: 1, createdAt: -1 },
  { name: INDEX_NAMES.affiliatePayoutActivity },
);
AffiliatePayoutSchema.index(
  { tenantId: 1, affiliateCustomerId: 1, status: 1, createdAt: -1, _id: -1 },
  { name: INDEX_NAMES.affiliatePayoutStatusHistory },
);
AffiliatePayoutSchema.index(
  { tenantId: 1, createIdempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.affiliatePayoutCreateIdempotency },
);
AffiliatePayoutSchema.index(
  { tenantId: 1, terminalIdempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { terminalIdempotencyKey: { $exists: true } },
    name: INDEX_NAMES.affiliatePayoutTerminalIdempotency,
  },
);
