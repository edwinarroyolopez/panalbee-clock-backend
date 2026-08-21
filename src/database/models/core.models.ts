import { Schema } from 'mongoose';
import { INDEX_NAMES } from './model-names';
import {
  clockTimeField,
  createdAtOptions,
  documentOptions,
  requiredUuidField,
  TimestampedEntity,
  UuidEntity,
  uuidField,
  validateOrderedInterval,
} from './schema-helpers';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED';
export type TenantRole = 'OWNER' | 'MANAGER' | 'AGENT' | 'STAFF';

export interface TenantEntity extends TimestampedEntity {
  name: string;
  slug: string;
  status: TenantStatus;
}
export interface LocationEntity extends TimestampedEntity {
  tenantId: string;
  name: string;
  timezone: string;
  publicBookingEnabled: boolean;
}
export interface TenantMembershipEntity extends UuidEntity {
  tenantId: string;
  userId: string;
  role: TenantRole;
  createdAt: Date;
}

export interface CustomerEntity extends TimestampedEntity {
  tenantId: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface ServiceEntity extends TimestampedEntity {
  tenantId: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
}

export interface StaffEntity extends TimestampedEntity {
  tenantId: string;
  locationId: string;
  displayName: string;
  active: boolean;
}

export interface StaffServiceEntity extends UuidEntity {
  tenantId: string;
  staffId: string;
  serviceId: string;
  durationOverrideMinutes?: number | null;
  createdAt: Date;
}

export interface ScheduleEntity extends UuidEntity {
  tenantId: string;
  locationId: string;
  staffId: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  createdAt: Date;
}

export interface AvailabilityExceptionEntity extends UuidEntity {
  tenantId: string;
  locationId: string;
  staffId: string;
  kind: 'AVAILABLE' | 'UNAVAILABLE';
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
  createdAt: Date;
}

export const TenantSchema: Schema<TenantEntity> = new Schema<TenantEntity>(
  {
    _id: uuidField(),
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
  },
  documentOptions<TenantEntity>('tenants'),
);
TenantSchema.index({ slug: 1 }, { unique: true, name: INDEX_NAMES.tenantSlug });

export const LocationSchema: Schema<LocationEntity> =
  new Schema<LocationEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      name: { type: String, required: true, trim: true },
      timezone: { type: String, required: true },
      publicBookingEnabled: { type: Boolean, default: true },
    },
    documentOptions<LocationEntity>('locations'),
  );
LocationSchema.index(
  { tenantId: 1, name: 1, _id: 1 },
  { name: INDEX_NAMES.locationOrdering },
);

export const TenantMembershipSchema: Schema<TenantMembershipEntity> =
  new Schema<TenantMembershipEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      userId: requiredUuidField(),
      role: {
        type: String,
        enum: ['OWNER', 'MANAGER', 'AGENT', 'STAFF'],
        required: true,
      },
    },
    createdAtOptions<TenantMembershipEntity>('tenant_memberships'),
  );
TenantMembershipSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true, name: INDEX_NAMES.tenantMembership },
);
TenantMembershipSchema.index(
  { userId: 1, tenantId: 1 },
  { name: INDEX_NAMES.tenantMembershipUser },
);

export const CustomerSchema: Schema<CustomerEntity> =
  new Schema<CustomerEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      fullName: { type: String, required: true, trim: true },
      phone: { type: String },
      email: { type: String, lowercase: true },
      notes: { type: String },
    },
    documentOptions<CustomerEntity>('customers'),
  );
CustomerSchema.index(
  { tenantId: 1, phone: 1 },
  {
    unique: true,
    name: INDEX_NAMES.customerPhone,
    partialFilterExpression: { phone: { $type: 'string' } },
  },
);
CustomerSchema.index(
  { tenantId: 1, fullName: 1, _id: 1 },
  { name: INDEX_NAMES.customerOrdering },
);

export const ServiceSchema: Schema<ServiceEntity> = new Schema<ServiceEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    name: { type: String, required: true, trim: true },
    description: { type: String },
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },
    priceMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'COP', minlength: 3, maxlength: 3 },
    active: { type: Boolean, default: true },
  },
  documentOptions<ServiceEntity>('services'),
);
ServiceSchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, name: INDEX_NAMES.serviceName },
);
ServiceSchema.index(
  { tenantId: 1, active: 1, name: 1, _id: 1 },
  { name: INDEX_NAMES.servicePublic },
);

export const StaffSchema: Schema<StaffEntity> = new Schema<StaffEntity>(
  {
    _id: uuidField(),
    tenantId: requiredUuidField(),
    locationId: requiredUuidField(),
    displayName: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  documentOptions<StaffEntity>('staff'),
);
StaffSchema.index(
  { tenantId: 1, locationId: 1, displayName: 1, _id: 1 },
  { name: INDEX_NAMES.staffLocation },
);

export const StaffServiceSchema: Schema<StaffServiceEntity> =
  new Schema<StaffServiceEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      staffId: requiredUuidField(),
      serviceId: requiredUuidField(),
      durationOverrideMinutes: { type: Number, min: 5, max: 480 },
    },
    createdAtOptions<StaffServiceEntity>('staff_services'),
  );
StaffServiceSchema.index(
  { tenantId: 1, staffId: 1, serviceId: 1 },
  { unique: true, name: INDEX_NAMES.staffService },
);
StaffServiceSchema.index(
  { tenantId: 1, serviceId: 1, staffId: 1 },
  { name: INDEX_NAMES.staffServiceEligibility },
);

export const ScheduleSchema: Schema<ScheduleEntity> =
  new Schema<ScheduleEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      locationId: requiredUuidField(),
      staffId: requiredUuidField(),
      dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
      startsAt: clockTimeField(),
      endsAt: clockTimeField(),
    },
    createdAtOptions<ScheduleEntity>('schedules'),
  );
ScheduleSchema.pre('validate', validateOrderedInterval);
ScheduleSchema.index(
  { tenantId: 1, staffId: 1, dayOfWeek: 1, startsAt: 1, endsAt: 1 },
  { unique: true, name: INDEX_NAMES.schedule },
);
ScheduleSchema.index(
  { tenantId: 1, locationId: 1, staffId: 1, dayOfWeek: 1, startsAt: 1 },
  { name: INDEX_NAMES.scheduleLookup },
);

export const AvailabilityExceptionSchema: Schema<AvailabilityExceptionEntity> =
  new Schema<AvailabilityExceptionEntity>(
    {
      _id: uuidField(),
      tenantId: requiredUuidField(),
      locationId: requiredUuidField(),
      staffId: requiredUuidField(),
      kind: {
        type: String,
        enum: ['AVAILABLE', 'UNAVAILABLE'],
        required: true,
      },
      startsAt: { type: Date, required: true },
      endsAt: { type: Date, required: true },
      reason: { type: String },
    },
    createdAtOptions<AvailabilityExceptionEntity>('availability_exceptions'),
  );
AvailabilityExceptionSchema.pre('validate', validateOrderedInterval);
AvailabilityExceptionSchema.index(
  { tenantId: 1, staffId: 1, startsAt: 1, endsAt: 1 },
  { name: INDEX_NAMES.availabilityException },
);
