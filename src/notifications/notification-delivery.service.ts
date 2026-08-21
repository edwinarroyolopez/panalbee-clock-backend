import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { ChannelType, ReplyIntent } from '../channels/channel-adapter';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { NotificationEntity, NotificationType } from '../database/models';

interface NotificationDestination {
  channelType: ChannelType;
  externalAccountId: string;
  recipientId: string;
  customerName: string;
  tenantName: string;
  startsAt: Date;
  timezone: string;
  reason: string;
}

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async send(notification: NotificationEntity): Promise<string> {
    const destination = await this.destination(notification);
    const delivery = await this.adapters.get(destination.channelType).send({
      externalAccountId: destination.externalAccountId,
      recipientId: destination.recipientId,
      intent: this.intent(notification.type, destination),
      idempotencyKey: notification.idempotencyKey,
    });
    return delivery.providerMessageId;
  }

  private async destination(
    notification: NotificationEntity,
  ): Promise<NotificationDestination> {
    const [tenant, customer, appointment] = await Promise.all([
      this.database.models.tenant
        .findOne({ _id: notification.tenantId, status: 'ACTIVE' })
        .select({ name: 1 })
        .lean()
        .exec(),
      this.database.models.customer
        .findOne({
          _id: notification.customerId,
          tenantId: notification.tenantId,
          phone: { $type: 'string' },
        })
        .select({ fullName: 1, phone: 1 })
        .lean()
        .exec(),
      this.database.models.appointment
        .findOne({
          _id: notification.appointmentId,
          tenantId: notification.tenantId,
        })
        .select({ locationId: 1, startsAt: 1, cancellationReason: 1 })
        .lean()
        .exec(),
    ]);
    if (!tenant || !customer?.phone || !appointment) {
      throw destinationUnavailable();
    }
    const [channel, location] = await Promise.all([
      this.database.models.channel
        .findOne({
          tenantId: notification.tenantId,
          status: 'ACTIVE',
          ...(notification.channelId
            ? { _id: notification.channelId }
            : { type: 'WHATSAPP' }),
        })
        .lean()
        .exec(),
      this.database.models.location
        .findOne({
          _id: appointment.locationId,
          tenantId: notification.tenantId,
        })
        .select({ timezone: 1 })
        .lean()
        .exec(),
    ]);
    if (notification.channelId && !channel) throw destinationUnavailable();
    const externalAccountId =
      channel?.externalAccountId ??
      this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    if (!externalAccountId || !location) throw destinationUnavailable();
    return {
      channelType: channel?.type ?? 'WHATSAPP',
      externalAccountId,
      recipientId: customer.phone,
      customerName: customer.fullName,
      tenantName: tenant.name,
      startsAt: notification.appointmentStartsAt ?? appointment.startsAt,
      timezone: location.timezone,
      reason:
        notification.changeReason ??
        appointment.cancellationReason ??
        'Ajuste operativo',
    };
  }

  private intent(
    type: NotificationType,
    destination: NotificationDestination,
  ): ReplyIntent {
    if (type === 'BOOKING_RESCHEDULED' || type === 'BOOKING_CANCELLED') {
      const name = this.config.get(
        type === 'BOOKING_RESCHEDULED'
          ? 'WHATSAPP_APPOINTMENT_RESCHEDULED_TEMPLATE_NAME'
          : 'WHATSAPP_APPOINTMENT_CANCELLED_TEMPLATE_NAME',
        { infer: true },
      );
      return {
        kind: 'TEMPLATE',
        name,
        language: this.config.get(
          'WHATSAPP_APPOINTMENT_NOTIFICATION_LANGUAGE',
          { infer: true },
        ),
        variables: [
          destination.customerName,
          destination.tenantName,
          DateTime.fromJSDate(destination.startsAt)
            .setZone(destination.timezone)
            .setLocale('es')
            .toFormat("cccc, d 'de' LLLL 'a las' h:mm a"),
          destination.reason,
        ],
      };
    }
    return {
      kind: 'TEMPLATE',
      name:
        type === 'BOOKING_CONFIRMATION'
          ? 'booking_confirmation'
          : 'booking_reminder',
      language: 'en',
      variables: [destination.customerName],
    };
  }
}

function destinationUnavailable(): AppException {
  return new AppException(
    409,
    'NOTIFICATION_DESTINATION_UNAVAILABLE',
    'Notification destination is unavailable',
  );
}
