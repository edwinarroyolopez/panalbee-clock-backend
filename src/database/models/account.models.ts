import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  createdAtOptions,
  documentOptions,
  optionalUuidField,
  requiredUuidField,
  TimestampedEntity,
  UuidEntity,
  uuidField,
} from './schema-helpers';

export const ACCOUNT_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface AccountEntity extends TimestampedEntity {
  businessName: string;
  slug: string;
  status: AccountStatus;
  ownerUserId: string;
  tenantId: string;
  phone: string;
  planCode?: string | null;
  publicBookingEnabled: boolean;
}

export interface AccountPublicContactInfo {
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

export interface AccountPublicProfileEntity extends TimestampedEntity {
  accountId: string;
  headline: string;
  description: string;
  logo?: string | null;
  coverImage?: string | null;
  theme: string;
  contactInfo: AccountPublicContactInfo;
  bookingEnabled: boolean;
}

export const DELEGATED_SESSION_STATUSES = [
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
] as const;
export type DelegatedSessionStatus =
  (typeof DELEGATED_SESSION_STATUSES)[number];

export interface DelegatedSessionEntity extends UuidEntity {
  platformAdminId: string;
  targetTenantId: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  status: DelegatedSessionStatus;
  exchangeCodeHash: string;
  exchangedAt?: Date | null;
  revokedAt?: Date | null;
  revokedBy?: string | null;
}

export const AccountSchema: Schema<AccountEntity> = new Schema<AccountEntity>(
  {
    _id: uuidField(),
    businessName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 160,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 2,
      maxlength: 120,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    status: { type: String, enum: ACCOUNT_STATUSES, required: true },
    ownerUserId: { ...requiredUuidField(), immutable: true },
    tenantId: { ...requiredUuidField(), immutable: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: /^\+[1-9]\d{7,14}$/,
    },
    planCode: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 64,
      match: /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    },
    publicBookingEnabled: { type: Boolean, required: true },
  },
  documentOptions<AccountEntity>('accounts'),
);
AccountSchema.index(
  { slug: 1 },
  { unique: true, name: INDEX_NAMES.accountSlug },
);
AccountSchema.index(
  { tenantId: 1 },
  { unique: true, name: INDEX_NAMES.accountTenant },
);

const ContactInfoSchema = new Schema<AccountPublicContactInfo>(
  {
    phone: { type: String, trim: true, match: /^\+[1-9]\d{7,14}$/ },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    website: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false, strict: 'throw' },
);

export const AccountPublicProfileSchema: Schema<AccountPublicProfileEntity> =
  new Schema<AccountPublicProfileEntity>(
    {
      _id: uuidField(),
      accountId: { ...requiredUuidField(), immutable: true },
      headline: {
        type: String,
        required: true,
        trim: true,
        maxlength: 160,
      },
      description: {
        type: String,
        trim: true,
        maxlength: 3000,
        default: '',
      },
      logo: { type: String, trim: true, maxlength: 500 },
      coverImage: { type: String, trim: true, maxlength: 500 },
      theme: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        minlength: 1,
        maxlength: 50,
        match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        default: 'default',
      },
      contactInfo: { type: ContactInfoSchema, required: true, default: {} },
      bookingEnabled: { type: Boolean, required: true },
    },
    documentOptions<AccountPublicProfileEntity>('account_public_profiles'),
  );
AccountPublicProfileSchema.index(
  { accountId: 1 },
  { unique: true, name: INDEX_NAMES.accountPublicProfile },
);

export const DelegatedSessionSchema: Schema<DelegatedSessionEntity> =
  new Schema<DelegatedSessionEntity>(
    {
      _id: uuidField(),
      platformAdminId: requiredUuidField(),
      targetTenantId: requiredUuidField(),
      reason: {
        type: String,
        required: true,
        trim: true,
        minlength: 6,
        maxlength: 500,
      },
      expiresAt: { type: Date, required: true },
      status: {
        type: String,
        enum: DELEGATED_SESSION_STATUSES,
        required: true,
      },
      exchangeCodeHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
      exchangedAt: { type: Date },
      revokedAt: { type: Date },
      revokedBy: optionalUuidField(),
    },
    createdAtOptions<DelegatedSessionEntity>('delegated_sessions'),
  );
DelegatedSessionSchema.index(
  { exchangeCodeHash: 1 },
  { unique: true, name: INDEX_NAMES.delegatedSessionExchangeCode },
);
DelegatedSessionSchema.index(
  { targetTenantId: 1, status: 1, expiresAt: 1 },
  { name: INDEX_NAMES.delegatedSessionTargetStatusExpiry },
);
