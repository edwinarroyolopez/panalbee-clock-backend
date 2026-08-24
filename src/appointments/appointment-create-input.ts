import { createHash, createHmac } from 'node:crypto';
import type {
  CreatePublicAppointmentDto,
  CreateTenantAppointmentDto,
} from './appointment.dto';

export function normalizeCreateInput(
  dto: CreateTenantAppointmentDto | CreatePublicAppointmentDto,
) {
  return {
    locationId: dto.locationId,
    serviceId: dto.serviceId,
    staffId: dto.staffId,
    startsAt: new Date(dto.startsAt).toISOString(),
    idempotencyKey: dto.idempotencyKey,
    notes: dto.notes?.trim() || null,
  };
}

export function appointmentFingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function appointmentManagementToken(
  secret: string,
  appointmentId: string,
): string {
  return createHmac('sha256', secret)
    .update(`appointment:${appointmentId}`)
    .digest('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
