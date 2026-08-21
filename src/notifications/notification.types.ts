export const NOTIFICATION_TYPES = [
  'BOOKING_CONFIRMATION',
  'BOOKING_REMINDER',
  'BOOKING_RESCHEDULED',
  'BOOKING_CANCELLED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationStatus =
  'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface CreateNotificationIntent {
  tenantId: string;
  appointmentId: string;
  customerId: string;
  channelId?: string;
  type: NotificationType;
  scheduledFor: Date;
  idempotencyKey: string;
}

export interface NotificationView {
  id: string;
  tenantId: string;
  appointmentId: string;
  customerId: string;
  channelId: string | null;
  type: NotificationType;
  scheduledFor: Date;
  status: NotificationStatus;
  attempts: number;
  idempotencyKey: string;
  lastErrorCode: string | null;
}

export interface NotificationProcessingSummary {
  sent: number;
  failed: number;
}
