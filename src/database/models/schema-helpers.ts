import { randomUUID } from 'node:crypto';
import { SchemaOptions, SchemaTypeOptions } from 'mongoose';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OrderedInterval {
  startsAt?: Date | string;
  endsAt?: Date | string;
  invalidate(path: string, message: string): void;
}

export interface UuidEntity {
  _id: string;
}

export interface TimestampedEntity extends UuidEntity {
  createdAt: Date;
  updatedAt: Date;
}

export function uuidField(): SchemaTypeOptions<string> {
  return { ...requiredUuidField(), default: () => randomUUID() };
}

export function requiredUuidField(): SchemaTypeOptions<string> {
  return {
    type: String,
    required: true,
    validate: { validator: (value: string) => UUID.test(value) },
  };
}

export function optionalUuidField(): SchemaTypeOptions<string> {
  return {
    type: String,
    validate: {
      validator: (value?: string | null) => value == null || UUID.test(value),
    },
  };
}

export function clockTimeField(): SchemaTypeOptions<string> {
  return {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):[0-5]\d$/,
  };
}

export function validateOrderedInterval(this: OrderedInterval): void {
  if (this.startsAt === undefined || this.endsAt === undefined) return;
  const start =
    this.startsAt instanceof Date ? this.startsAt.getTime() : this.startsAt;
  const end = this.endsAt instanceof Date ? this.endsAt.getTime() : this.endsAt;
  if (start >= end) this.invalidate('endsAt', 'End must be after start');
}

export function documentOptions<T>(collection: string): SchemaOptions<T> {
  return {
    collection,
    strict: 'throw',
    versionKey: false,
    timestamps: true,
  };
}

export function createdAtOptions<T>(collection: string): SchemaOptions<T> {
  return {
    collection,
    strict: 'throw',
    versionKey: false,
    timestamps: { createdAt: true, updatedAt: false },
  };
}

export function isNamedDuplicateKey(
  error: unknown,
  indexName: string,
): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: unknown;
    index?: unknown;
    message?: unknown;
  };
  const message =
    typeof candidate.message === 'string' ? candidate.message : '';
  return (
    candidate.code === 11000 &&
    (candidate.index === indexName || message.includes(indexName))
  );
}
