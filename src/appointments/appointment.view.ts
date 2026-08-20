import {
  AppointmentEntity,
  AppointmentSource,
  AppointmentStatus,
} from '../database/models';

export interface AppointmentRecord extends AppointmentEntity {
  locationName?: string;
  timezone?: string;
  serviceName?: string;
  staffName?: string;
  localStartsAt?: string;
  localEndsAt?: string;
}

export interface AppointmentView {
  id: string;
  locationId: string;
  serviceId: string;
  staffId: string;
  customerId: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  sourceChannel: AppointmentSource;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  locationName?: string;
  timezone?: string;
  serviceName?: string;
  staffName?: string;
  localStartsAt?: string;
  localEndsAt?: string;
}

export interface PublicAppointmentResult extends AppointmentView {
  managementToken?: string;
}

export function appointmentView(
  appointment: AppointmentRecord,
): AppointmentView {
  return {
    id: appointment._id,
    locationId: appointment.locationId,
    serviceId: appointment.serviceId,
    staffId: appointment.staffId,
    customerId: appointment.customerId,
    status: appointment.status,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    sourceChannel: appointment.sourceChannel,
    notes: appointment.notes ?? null,
    cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
    cancellationReason: appointment.cancellationReason ?? null,
    createdAt: appointment.createdAt.toISOString(),
    ...(appointment.locationName
      ? { locationName: appointment.locationName }
      : {}),
    ...(appointment.timezone ? { timezone: appointment.timezone } : {}),
    ...(appointment.serviceName
      ? { serviceName: appointment.serviceName }
      : {}),
    ...(appointment.staffName ? { staffName: appointment.staffName } : {}),
    ...(appointment.localStartsAt
      ? { localStartsAt: appointment.localStartsAt }
      : {}),
    ...(appointment.localEndsAt
      ? { localEndsAt: appointment.localEndsAt }
      : {}),
  };
}
