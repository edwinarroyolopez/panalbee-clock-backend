import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { AvailabilityService } from '../availability/availability.service';
import { AppException } from '../common/app-exception';
import type {
  ConversationCommandEnvelope,
  ConversationCommandHandler,
} from '../conversations/conversation-command.port';
import { DatabaseService } from '../database/database.service';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { ConversationBookingRelationService } from './conversation-booking-relation.service';

@Injectable()
export class ConversationBookingHandler implements ConversationCommandHandler {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly effects: AppointmentEffectsService,
    private readonly intervalLocks: AppointmentIntervalLockService,
    private readonly relations: ConversationBookingRelationService,
  ) {}

  async handle(
    envelope: ConversationCommandEnvelope,
    session: ClientSession,
  ): Promise<void> {
    switch (envelope.command.type) {
      case 'CREATE_BOOKING':
        await this.create(envelope, session);
        return;
      case 'RESCHEDULE_BOOKING':
        await this.reschedule(envelope, session);
        return;
      case 'CANCEL_BOOKING':
        await this.cancel(envelope, session);
    }
  }

  private async create(
    envelope: ConversationCommandEnvelope,
    session: ClientSession,
  ): Promise<void> {
    const command = envelope.command;
    if (command.type !== 'CREATE_BOOKING') return;
    const idempotencyKey = `conversation:${envelope.conversationId}:booking`;
    const requestFingerprint = fingerprint({
      customerId: envelope.customerId,
      serviceId: command.serviceId,
      staffId: command.professionalId,
      date: command.date,
      time: command.time,
      customerData: command.customerData,
    });
    const replay = await this.database.models.appointment
      .findOne({ tenantId: envelope.tenantId, idempotencyKey })
      .session(session)
      .lean()
      .exec();
    if (replay) {
      if (replay.requestFingerprint !== requestFingerprint) {
        throw new AppException(
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key was already used with a different request',
        );
      }
      return;
    }

    const relation = await this.relations.resolve(
      envelope.tenantId,
      envelope.customerId,
      command.serviceId,
      command.professionalId,
      command.date,
      command.time,
      session,
    );
    await this.availability.assertSlotAvailable(
      envelope.tenantId,
      {
        locationId: relation.locationId,
        serviceId: command.serviceId,
        staffId: command.professionalId,
        date: command.date,
      },
      relation.startsAt.toISOString(),
      { session, appointmentConflict: true },
    );
    const appointmentId = randomUUID();
    const endsAt = new Date(
      relation.startsAt.getTime() + relation.durationMinutes * 60_000,
    );
    const [appointment] = await this.database.models.appointment.create(
      [
        {
          _id: appointmentId,
          tenantId: envelope.tenantId,
          locationId: relation.locationId,
          serviceId: command.serviceId,
          staffId: command.professionalId,
          customerId: envelope.customerId,
          startsAt: relation.startsAt,
          endsAt,
          sourceChannel: 'WHATSAPP',
          idempotencyKey,
          requestFingerprint,
          notes: command.customerData.slice(0, 2_000),
        },
      ],
      { session },
    );
    await this.intervalLocks.acquire(
      envelope.tenantId,
      command.professionalId,
      appointment._id,
      relation.startsAt,
      endsAt,
      session,
    );
    await this.effects.recordCreated(
      session,
      envelope.tenantId,
      null,
      true,
      appointment,
    );
  }

  private async reschedule(
    envelope: ConversationCommandEnvelope,
    session: ClientSession,
  ): Promise<void> {
    const command = envelope.command;
    if (command.type !== 'RESCHEDULE_BOOKING') return;
    const appointment = await this.ownedAppointment(
      envelope,
      command.appointmentId,
      session,
    );
    const relation = await this.relations.resolve(
      envelope.tenantId,
      envelope.customerId,
      appointment.serviceId,
      appointment.staffId,
      command.date,
      command.time,
      session,
    );
    if (relation.locationId !== appointment.locationId) {
      throw appointmentNotFound();
    }
    await this.availability.assertSlotAvailable(
      envelope.tenantId,
      {
        locationId: appointment.locationId,
        serviceId: appointment.serviceId,
        staffId: appointment.staffId,
        date: command.date,
      },
      relation.startsAt.toISOString(),
      {
        session,
        appointmentConflict: true,
        excludeAppointmentId: appointment._id,
      },
    );
    const endsAt = new Date(
      relation.startsAt.getTime() + relation.durationMinutes * 60_000,
    );
    await this.intervalLocks.replace(
      envelope.tenantId,
      appointment.staffId,
      appointment._id,
      relation.startsAt,
      endsAt,
      session,
    );
    const updated = await this.database.models.appointment
      .findOneAndUpdate(
        {
          _id: appointment._id,
          tenantId: envelope.tenantId,
          customerId: envelope.customerId,
          status: { $in: ['PENDING', 'CONFIRMED'] },
        },
        { $set: { startsAt: relation.startsAt, endsAt } },
        { returnDocument: 'after', session },
      )
      .exec();
    if (!updated) throw appointmentNotFound();
    await this.effects.recordLifecycle(
      session,
      customerActor(envelope.tenantId),
      updated,
      'BOOKING_RESCHEDULED',
      'APPOINTMENT_RESCHEDULED',
    );
  }

  private async cancel(
    envelope: ConversationCommandEnvelope,
    session: ClientSession,
  ): Promise<void> {
    const command = envelope.command;
    if (command.type !== 'CANCEL_BOOKING') return;
    const appointment = await this.ownedAppointment(
      envelope,
      command.appointmentId,
      session,
    );
    const cancelledAt = new Date();
    const updated = await this.database.models.appointment
      .findOneAndUpdate(
        {
          _id: appointment._id,
          tenantId: envelope.tenantId,
          customerId: envelope.customerId,
          status: { $in: ['PENDING', 'CONFIRMED'] },
        },
        {
          $set: {
            status: 'CANCELLED',
            cancelledAt,
            cancellationReason: 'Customer channel request',
          },
        },
        { returnDocument: 'after', session },
      )
      .exec();
    if (!updated) throw appointmentNotFound();
    await this.intervalLocks.release(
      envelope.tenantId,
      appointment._id,
      session,
    );
    await this.effects.recordLifecycle(
      session,
      customerActor(envelope.tenantId),
      updated,
      'BOOKING_CANCELLED',
      'APPOINTMENT_CANCELLED',
      'Customer channel request',
    );
  }

  private async ownedAppointment(
    envelope: ConversationCommandEnvelope,
    appointmentId: string,
    session: ClientSession,
  ) {
    const appointment = await this.database.models.appointment
      .findOne({
        _id: appointmentId,
        tenantId: envelope.tenantId,
        customerId: envelope.customerId,
        status: { $in: ['PENDING', 'CONFIRMED'] },
      })
      .session(session)
      .lean()
      .exec();
    if (!appointment) throw appointmentNotFound();
    return appointment;
  }
}

function fingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function customerActor(tenantId: string) {
  return {
    tenantId,
    actorUserId: null,
    actorType: 'CUSTOMER' as const,
  };
}

function appointmentNotFound(): AppException {
  return new AppException(
    404,
    'APPOINTMENT_NOT_FOUND',
    'Appointment not found',
  );
}
