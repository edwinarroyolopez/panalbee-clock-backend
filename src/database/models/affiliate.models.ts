import { Schema } from 'mongoose';
import {
  createdAtOptions,
  documentOptions,
  optionalUuidField,
  requiredUuidField,
  TimestampedEntity,
  uuidField,
} from './schema-helpers';
import { INDEX_NAMES } from './model-names';

export type AffiliateCodeStatus = 'ACTIVE' | 'INACTIVE' | 'RETIRED';
export type DiscountType = 'NONE' | 'PERCENT' | 'FIXED';
export type CommissionType = 'PERCENT' | 'FIXED';

export interface AffiliateCodeEntity extends TimestampedEntity {
  tenantId: string;
  customerId: string;
  code: string;
  normalizedCode: string;
  status: AffiliateCodeStatus;
  currentSlot?: 'CURRENT';
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
  deactivatedAt?: Date;
  reactivatedAt?: Date;
  retiredAt?: Date;
}

export interface ReferralConversionEntity {
  _id: string;
  tenantId: string;
  affiliateCodeId: string;
  affiliateCustomerId: string;
  referredCustomerId: string;
  appointmentId: string;
  serviceId: string;
  codeSnapshot: string;
  grossAmountMinor: number;
  discountType: DiscountType;
  discountBasisPoints?: number;
  discountAmountMinor?: number;
  discountCurrency?: string;
  discountValueMinor: number;
  finalAmountMinor: number;
  currency: string;
  commissionType: CommissionType;
  commissionBasisPoints?: number;
  commissionAmountMinor?: number;
  commissionCurrency?: string;
  commissionValueMinor: number;
  commissionBase: 'NET_AFTER_DISCOUNT';
  source: 'PUBLIC_BOOKING';
  createdAt: Date;
}

export interface AffiliateLedgerEntryEntity {
  _id: string;
  tenantId: string;
  affiliateCustomerId: string;
  conversionId?: string;
  appointmentId?: string;
  payoutId?: string;
  currency: string;
  direction: 'CREDIT' | 'DEBIT';
  type: 'COMMISSION_EARNED' | 'COMMISSION_REVERSAL' | 'PAYOUT_PAID';
  amountMinor: number;
  idempotencyKey: string;
  reversalOfEntryId?: string;
  reason?: string;
  createdAt: Date;
}

export const AffiliateCodeSchema = new Schema<AffiliateCodeEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    customerId: requiredUuidField(),
    code: { type: String, required: true },
    normalizedCode: { type: String, required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'RETIRED'],
      required: true,
    },
    currentSlot: { type: String, enum: ['CURRENT'] },
    discountType: {
      type: String,
      enum: ['NONE', 'PERCENT', 'FIXED'],
      required: true,
    },
    discountBasisPoints: { type: Number, min: 1, max: 10_000 },
    discountAmountMinor: { type: Number, min: 1, max: Number.MAX_SAFE_INTEGER },
    discountCurrency: { type: String, match: /^[A-Z]{3}$/ },
    commissionType: {
      type: String,
      enum: ['PERCENT', 'FIXED'],
      required: true,
    },
    commissionBasisPoints: { type: Number, min: 1, max: 10_000 },
    commissionAmountMinor: {
      type: Number,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    },
    commissionCurrency: { type: String, match: /^[A-Z]{3}$/ },
    commissionBase: {
      type: String,
      enum: ['NET_AFTER_DISCOUNT'],
      required: true,
    },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    deactivatedAt: { type: Date },
    reactivatedAt: { type: Date },
    retiredAt: { type: Date },
  },
  documentOptions<AffiliateCodeEntity>('affiliate_codes'),
);
AffiliateCodeSchema.index(
  { tenantId: 1, normalizedCode: 1 },
  { unique: true, name: INDEX_NAMES.affiliateCodeText },
);
AffiliateCodeSchema.index(
  { tenantId: 1, customerId: 1, currentSlot: 1 },
  {
    unique: true,
    partialFilterExpression: { currentSlot: 'CURRENT' },
    name: INDEX_NAMES.affiliateCodeCurrentCustomer,
  },
);
AffiliateCodeSchema.index(
  { tenantId: 1, customerId: 1, createdAt: -1, _id: -1 },
  { name: INDEX_NAMES.affiliateCodeHistory },
);

export const ReferralConversionSchema = new Schema<ReferralConversionEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    affiliateCodeId: requiredUuidField(),
    affiliateCustomerId: requiredUuidField(),
    referredCustomerId: requiredUuidField(),
    appointmentId: requiredUuidField(),
    serviceId: requiredUuidField(),
    codeSnapshot: { type: String, required: true },
    grossAmountMinor: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    },
    discountType: {
      type: String,
      enum: ['NONE', 'PERCENT', 'FIXED'],
      required: true,
    },
    discountBasisPoints: { type: Number, min: 1, max: 10_000 },
    discountAmountMinor: { type: Number, min: 1, max: Number.MAX_SAFE_INTEGER },
    discountCurrency: { type: String, match: /^[A-Z]{3}$/ },
    discountValueMinor: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    },
    finalAmountMinor: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    },
    currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
    commissionType: {
      type: String,
      enum: ['PERCENT', 'FIXED'],
      required: true,
    },
    commissionBasisPoints: { type: Number, min: 1, max: 10_000 },
    commissionAmountMinor: {
      type: Number,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    },
    commissionCurrency: { type: String, match: /^[A-Z]{3}$/ },
    commissionValueMinor: {
      type: Number,
      required: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    },
    commissionBase: {
      type: String,
      enum: ['NET_AFTER_DISCOUNT'],
      required: true,
    },
    source: { type: String, enum: ['PUBLIC_BOOKING'], required: true },
  },
  createdAtOptions<ReferralConversionEntity>('referral_conversions'),
);
ReferralConversionSchema.index(
  { tenantId: 1, appointmentId: 1 },
  { unique: true, name: INDEX_NAMES.referralConversionAppointment },
);
ReferralConversionSchema.index(
  { tenantId: 1, affiliateCustomerId: 1, createdAt: -1, _id: -1 },
  { name: INDEX_NAMES.referralConversionAffiliateActivity },
);

export const AffiliateLedgerEntrySchema =
  new Schema<AffiliateLedgerEntryEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      affiliateCustomerId: requiredUuidField(),
      conversionId: optionalUuidField(),
      appointmentId: optionalUuidField(),
      payoutId: optionalUuidField(),
      currency: { type: String, required: true, match: /^[A-Z]{3}$/ },
      direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
      type: {
        type: String,
        enum: ['COMMISSION_EARNED', 'COMMISSION_REVERSAL', 'PAYOUT_PAID'],
        required: true,
      },
      amountMinor: {
        type: Number,
        required: true,
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      },
      idempotencyKey: { type: String, required: true },
      reversalOfEntryId: optionalUuidField(),
      reason: { type: String },
    },
    createdAtOptions<AffiliateLedgerEntryEntity>('affiliate_ledger_entries'),
  );
AffiliateLedgerEntrySchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, name: INDEX_NAMES.affiliateLedgerIdempotency },
);
AffiliateLedgerEntrySchema.index(
  { tenantId: 1, affiliateCustomerId: 1, currency: 1, createdAt: -1 },
  { name: INDEX_NAMES.affiliateLedgerBalance },
);
AffiliateLedgerEntrySchema.index(
  { tenantId: 1, affiliateCustomerId: 1, conversionId: 1, createdAt: -1 },
  { name: INDEX_NAMES.affiliateLedgerConversionActivity },
);
AffiliateLedgerEntrySchema.index(
  { tenantId: 1, reversalOfEntryId: 1 },
  {
    unique: true,
    partialFilterExpression: { reversalOfEntryId: { $exists: true } },
    name: INDEX_NAMES.affiliateLedgerReversal,
  },
);

export const AFFILIATE_APPEND_ONLY_ERROR =
  'affiliate financial history is append-only';
function protectAppendOnlySchema<T>(schema: Schema<T>): void {
  schema.pre('save', function () {
    if (!this.isNew) throw new Error(AFFILIATE_APPEND_ONLY_ERROR);
  });
  schema.pre(/^(?:update|replace|delete|findOneAnd)/, function () {
    throw new Error(AFFILIATE_APPEND_ONLY_ERROR);
  });
  schema.pre('bulkWrite', function () {
    throw new Error(AFFILIATE_APPEND_ONLY_ERROR);
  });
  schema.pre('deleteOne', { document: true, query: false }, function () {
    throw new Error(AFFILIATE_APPEND_ONLY_ERROR);
  });
  schema.pre('updateOne', { document: true, query: false }, function () {
    throw new Error(AFFILIATE_APPEND_ONLY_ERROR);
  });
}
protectAppendOnlySchema(ReferralConversionSchema);
protectAppendOnlySchema(AffiliateLedgerEntrySchema);
