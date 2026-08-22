import {
  AppointmentEntity,
  AppointmentSource,
  AppointmentStatus,
  AppointmentTimelineEventEntity,
  AppointmentTimelineEventType,
  NotificationStatus,
} from '../database/models';
import type { AppointmentSurveyView } from './appointment-feedback.view';

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
  startedAt: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  requiresOutcome: boolean;
  outcomeState:
    | 'SCHEDULED'
    | 'IN_PROGRESS'
    | 'OUTCOME_REQUIRED'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'NO_SHOW';
  createdAt: string;
  locationName?: string;
  timezone?: string;
  serviceName?: string;
  staffName?: string;
  localStartsAt?: string;
  localEndsAt?: string;
}

export interface AppointmentTimelineEventView {
  id: string;
  type: AppointmentTimelineEventType;
  occurredAt: string;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus | null;
  startsAt: string | null;
  endsAt: string | null;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  reasonCode?: string | null;
  note?: string | null;
  actorType?: AppointmentTimelineEventEntity['actorType'];
  actorUserId?: string | null;
  evidenceId?: string | null;
  surveyRating?: number | null;
  synthetic?: boolean;
}

export interface AppointmentTimelineView {
  appointment: AppointmentView;
  items: AppointmentTimelineEventView[];
  survey: AppointmentSurveyView | null;
}

export interface PublicAppointmentResult extends AppointmentView {
  managementToken?: string;
}

export interface TenantAppointmentLifecycleView extends AppointmentView {
  notificationStatus: NotificationStatus;
  notificationErrorCode: string | null;
}

export function appointmentView(
  appointment: AppointmentRecord,
  now = new Date(),
): AppointmentView {
  const requiresOutcome =
    ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status) &&
    appointment.endsAt.getTime() <= now.getTime();
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
    startedAt: appointment.startedAt?.toISOString() ?? null,
    completedAt: appointment.completedAt?.toISOString() ?? null,
    noShowAt: appointment.noShowAt?.toISOString() ?? null,
    requiresOutcome,
    outcomeState: appointmentOutcomeState(appointment.status, requiresOutcome),
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

export function appointmentTimelineEventView(
  event: AppointmentTimelineEventEntity,
  internal: boolean,
): AppointmentTimelineEventView {
  return {
    id: event._id,
    type: event.eventType,
    occurredAt: event.createdAt.toISOString(),
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    startsAt: event.startsAt?.toISOString() ?? null,
    endsAt: event.endsAt?.toISOString() ?? null,
    previousStartsAt: event.previousStartsAt?.toISOString() ?? null,
    previousEndsAt: event.previousEndsAt?.toISOString() ?? null,
    ...(event.evidenceId ? { evidenceId: event.evidenceId } : {}),
    ...(event.surveyRating ? { surveyRating: event.surveyRating } : {}),
    ...(internal
      ? {
          reasonCode: event.reasonCode ?? null,
          note: event.note ?? null,
          actorType: event.actorType,
          actorUserId: event.actorUserId ?? null,
        }
      : {}),
  };
}

function appointmentOutcomeState(
  status: AppointmentStatus,
  requiresOutcome: boolean,
): AppointmentView['outcomeState'] {
  if (requiresOutcome) return 'OUTCOME_REQUIRED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'NO_SHOW') return 'NO_SHOW';
  return 'SCHEDULED';
}
