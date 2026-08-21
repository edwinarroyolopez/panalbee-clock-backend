import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { NotificationType } from '../database/models';
import { NotificationService } from '../notifications/notification.service';
import {
  AppointmentView,
  TenantAppointmentLifecycleView,
} from './appointment.view';

@Injectable()
export class AppointmentLifecycleNotificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationService,
  ) {}

  async deliver(
    tenantId: string,
    appointment: AppointmentView,
    type: Extract<
      NotificationType,
      'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED'
    >,
  ): Promise<TenantAppointmentLifecycleView> {
    const effectTime =
      type === 'BOOKING_CANCELLED'
        ? appointment.cancelledAt
        : appointment.startsAt;
    try {
      const notification = await this.database.models.notification
        .findOne({
          tenantId,
          idempotencyKey: `appointment:${appointment.id}:${type}:${effectTime}`,
        })
        .select({ _id: 1 })
        .lean()
        .exec();
      if (!notification)
        return failed(appointment, 'NOTIFICATION_INTENT_MISSING');
      const processed = await this.notifications.processOne(
        tenantId,
        notification._id,
      );
      return {
        ...appointment,
        notificationStatus: processed.status,
        notificationErrorCode: processed.lastErrorCode,
      };
    } catch {
      return failed(appointment, 'NOTIFICATION_PROCESSING_UNAVAILABLE');
    }
  }
}

function failed(
  appointment: AppointmentView,
  notificationErrorCode: string,
): TenantAppointmentLifecycleView {
  return {
    ...appointment,
    notificationStatus: 'FAILED',
    notificationErrorCode,
  };
}
