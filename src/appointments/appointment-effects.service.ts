import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { AppointmentEntity } from '../database/models';

interface LifecycleActor {
  tenantId: string;
  actorUserId: string | null;
  actorType: 'TENANT_USER' | 'CUSTOMER';
}

@Injectable()
export class AppointmentEffectsService {
  constructor(private readonly database: DatabaseService) {}

  async recordCreated(
    session: ClientSession,
    tenantId: string,
    actorUserId: string | null,
    publicCustomer: boolean,
    appointment: AppointmentEntity,
  ): Promise<void> {
    await this.database.models.notification.create(
      [
        {
          tenantId,
          appointmentId: appointment._id,
          customerId: appointment.customerId,
          type: 'BOOKING_CONFIRMATION',
          scheduledFor: new Date(),
          idempotencyKey: `appointment:${appointment._id}:confirmation`,
        },
      ],
      { session },
    );
    await this.database.models.auditEvent.create(
      [
        {
          tenantId,
          ...(actorUserId ? { actorUserId } : {}),
          actorType: publicCustomer ? 'CUSTOMER' : 'TENANT_USER',
          action: 'APPOINTMENT_CREATED',
          entityType: 'appointment',
          entityId: appointment._id,
          metadata: {},
        },
      ],
      { session },
    );
  }

  async recordLifecycle(
    session: ClientSession,
    actor: LifecycleActor,
    appointment: AppointmentEntity,
    notificationType: 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED',
    action: 'APPOINTMENT_RESCHEDULED' | 'APPOINTMENT_CANCELLED',
    reason?: string,
  ): Promise<void> {
    const effectTime =
      notificationType === 'BOOKING_CANCELLED'
        ? appointment.cancelledAt!.toISOString()
        : appointment.startsAt.toISOString();
    await this.database.models.notification
      .updateOne(
        {
          tenantId: actor.tenantId,
          idempotencyKey: `appointment:${appointment._id}:${notificationType}:${effectTime}`,
        },
        {
          $setOnInsert: {
            _id: randomUUID(),
            tenantId: actor.tenantId,
            appointmentId: appointment._id,
            customerId: appointment.customerId,
            type: notificationType,
            scheduledFor: new Date(),
            status: 'PENDING',
            attempts: 0,
            idempotencyKey: `appointment:${appointment._id}:${notificationType}:${effectTime}`,
          },
        },
        { upsert: true, session },
      )
      .exec();
    await this.database.models.auditEvent.create(
      [
        {
          tenantId: actor.tenantId,
          ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
          actorType: actor.actorType,
          action,
          entityType: 'appointment',
          entityId: appointment._id,
          ...(reason ? { reason } : {}),
          metadata: {},
        },
      ],
      { session },
    );
  }
}
