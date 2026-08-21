import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  documentOptions,
  TimestampedEntity,
  uuidField,
} from './schema-helpers';

export type UserStatus = 'ACTIVE' | 'DISABLED';
export type ActorType = 'TENANT' | 'INTERNAL';
export type InternalRole = 'PLATFORM_ADMIN' | 'PLATFORM_SUPPORT';

export interface UserEntity extends TimestampedEntity {
  email?: string | null;
  phone?: string | null;
  displayName: string;
  passwordHash: string;
  actorType: ActorType;
  internalRole?: InternalRole | null;
  status: UserStatus;
}

export const UserSchema: Schema<UserEntity> = new Schema<UserEntity>(
  {
    _id: uuidField(),
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true, match: /^\+[1-9]\d{7,14}$/ },
    displayName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    actorType: { type: String, enum: ['TENANT', 'INTERNAL'], required: true },
    internalRole: {
      type: String,
      enum: ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'],
    },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },
  },
  documentOptions<UserEntity>('users'),
);
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    name: INDEX_NAMES.userEmail,
    partialFilterExpression: { email: { $type: 'string' } },
  },
);
UserSchema.index(
  { phone: 1 },
  {
    unique: true,
    name: INDEX_NAMES.userPhone,
    partialFilterExpression: { phone: { $type: 'string' } },
  },
);
UserSchema.pre('validate', function () {
  if (!this.email && !this.phone)
    this.invalidate('email', 'Email or phone is required');
  const isInternal = this.actorType === 'INTERNAL';
  if (isInternal !== Boolean(this.internalRole))
    this.invalidate('internalRole', 'Internal role is inconsistent');
});
