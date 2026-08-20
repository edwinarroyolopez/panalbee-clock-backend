import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

const SENSITIVE_KEY =
  /password|secret|token|authorization|cookie|credential|api[-_]?key/i;

function sanitizeValue(value: unknown, depth: number): JsonValue {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, entry]) => [
          key.slice(0, 100),
          SENSITIVE_KEY.test(key)
            ? '[REDACTED]'
            : sanitizeValue(entry, depth + 1),
        ]),
    );
  }
  return '[UNSUPPORTED]';
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown>,
): JsonObject {
  return sanitizeValue(metadata, 0) as JsonObject;
}

export interface SensitiveAuditEvent {
  tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export function validateAuditReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 6 || reason.length > 500) {
    throw new AppException(
      400,
      'AUDIT_REASON_INVALID',
      'Reason must contain between 6 and 500 characters',
    );
  }
  return reason;
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async recordSensitive(
    event: SensitiveAuditEvent,
    session?: ClientSession,
  ): Promise<void> {
    const reason = validateAuditReason(event.reason);

    const auditEvent = new this.database.models.auditEvent({
      tenantId: event.tenantId,
      actorUserId: event.actorUserId,
      actorType: 'INTERNAL_USER',
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      reason,
      requestId: event.requestId,
      metadata: sanitizeAuditMetadata(event.metadata ?? {}),
    });
    await auditEvent.save({ session });
  }
}
