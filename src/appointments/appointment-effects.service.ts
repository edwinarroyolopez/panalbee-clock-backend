import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { AppointmentEntity, AppointmentStatus } from '../database/models';

export interface LifecycleActor {
  tenantId: string;
  actorUserId: string | null;
  actorType: 'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER';
}

type StatusEventType = 'STARTED' | 'COMPLETED' | 'NO_SHOW';

@Injectable()
export class AppointmentEffectsService {
  constructor(private readonly database: DatabaseService) {}

  async recordCreated(
    session: ClientSession,
    tenantId: string,
    actorUserId: string | null,
    actorType: LifecycleActor['actorType'],
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
          actorType,
          action: 'APPOINTMENT_CREATED',
          entityType: 'appointment',
          entityId: appointment._id,
          metadata: {},
        },
      ],
      { session },
    );
    await this.database.models.appointmentTimelineEvent.create(
      [
        {
          tenantId,
          appointmentId: appointment._id,
          actorType,
          ...(actorUserId ? { actorUserId } : {}),
          eventType: 'CREATED',
          toStatus: appointment.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          idempotencyKey: `appointment:${appointment._id}:created`,
          requestFingerprint: timelineFingerprint({
            type: 'CREATED',
            startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(),
          }),
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
    previous?: {
      status: AppointmentStatus;
      startsAt: Date;
      endsAt: Date;
    },
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
            ...(reason ? { changeReason: reason } : {}),
            appointmentStartsAt: appointment.startsAt,
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
    const eventType =
      notificationType === 'BOOKING_CANCELLED' ? 'CANCELLED' : 'RESCHEDULED';
    const idempotencyKey = `appointment:${appointment._id}:${eventType.toLowerCase()}:${effectTime}`;
    const timelinePayload = {
      type: eventType,
      reason: reason ?? null,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      previousStartsAt: previous?.startsAt.toISOString() ?? null,
      previousEndsAt: previous?.endsAt.toISOString() ?? null,
    };
    await this.database.models.appointmentTimelineEvent.create(
      [
        {
          tenantId: actor.tenantId,
          appointmentId: appointment._id,
          actorType: actor.actorType,
          ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
          eventType,
          fromStatus: previous?.status ?? appointment.status,
          toStatus: appointment.status,
          ...(reason ? { note: reason } : {}),
          ...(previous
            ? {
                previousStartsAt: previous.startsAt,
                previousEndsAt: previous.endsAt,
              }
            : {}),
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          idempotencyKey,
          requestFingerprint: timelineFingerprint(timelinePayload),
        },
      ],
      { session },
    );
  }

  async recordStatusTransition(
    session: ClientSession,
    actor: LifecycleActor,
    previous: AppointmentEntity,
    appointment: AppointmentEntity,
    eventType: StatusEventType,
    idempotencyKey: string,
    requestFingerprint: string,
    reasonCode?: string,
    note?: string,
  ): Promise<void> {
    await this.database.models.appointmentTimelineEvent.create(
      [
        {
          tenantId: actor.tenantId,
          appointmentId: appointment._id,
          actorType: actor.actorType,
          ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
          eventType,
          fromStatus: previous.status,
          toStatus: appointment.status,
          ...(reasonCode ? { reasonCode } : {}),
          ...(note ? { note } : {}),
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          idempotencyKey,
          requestFingerprint,
        },
      ],
      { session },
    );
    await this.database.models.auditEvent.create(
      [
        {
          tenantId: actor.tenantId,
          ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
          actorType: actor.actorType,
          action: `APPOINTMENT_${eventType}`,
          entityType: 'appointment',
          entityId: appointment._id,
          ...(reasonCode || note
            ? { reason: [reasonCode, note].filter(Boolean).join(': ') }
            : {}),
          metadata: {},
        },
      ],
      { session },
    );
  }
}

function timelineFingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
