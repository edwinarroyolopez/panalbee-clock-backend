import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentEntity,
  AppointmentNoShowReason,
  AppointmentTimelineEventType,
} from '../database/models';
import {
  AppointmentEffectsService,
  LifecycleActor,
} from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentView, appointmentView } from './appointment.view';

interface AppointmentCommand {
  idempotencyKey: string;
  note?: string;
}

interface NoShowCommand extends AppointmentCommand {
  reason: AppointmentNoShowReason;
}

@Injectable()
export class AppointmentLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly effects: AppointmentEffectsService,
    private readonly intervalLocks: AppointmentIntervalLockService,
  ) {}

  start(
    actor: LifecycleActor,
    appointmentId: string,
    command: AppointmentCommand,
  ): Promise<AppointmentView> {
    const requestFingerprint = fingerprint({ type: 'STARTED' });
    return this.transition(
      actor,
      appointmentId,
      'STARTED',
      command.idempotencyKey,
      requestFingerprint,
      (appointment, now) => {
        if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
          throw transitionInvalid();
        }
        if (now.getTime() < appointment.startsAt.getTime() - 30 * 60_000) {
          throw new AppException(
            409,
            'APPOINTMENT_START_TOO_EARLY',
            'Appointment cannot be started more than 30 minutes early',
          );
        }
        return { status: 'IN_PROGRESS', startedAt: now };
      },
    );
  }

  complete(
    actor: LifecycleActor,
    appointmentId: string,
    command: AppointmentCommand,
  ): Promise<AppointmentView> {
    const note = normalizedNote(command.note);
    const requestFingerprint = fingerprint({ type: 'COMPLETED', note });
    return this.transition(
      actor,
      appointmentId,
      'COMPLETED',
      command.idempotencyKey,
      requestFingerprint,
      (appointment, now) => {
        if (appointment.status === 'IN_PROGRESS') {
          return { status: 'COMPLETED', completedAt: now, outcomeNote: note };
        }
        if (
          ['PENDING', 'CONFIRMED'].includes(appointment.status) &&
          appointment.endsAt.getTime() <= now.getTime()
        ) {
          return { status: 'COMPLETED', completedAt: now, outcomeNote: note };
        }
        if (['PENDING', 'CONFIRMED'].includes(appointment.status)) {
          throw new AppException(
            409,
            'APPOINTMENT_MUST_BE_STARTED',
            'Appointment must be started before it can be completed',
          );
        }
        throw transitionInvalid();
      },
      undefined,
      note ?? undefined,
    );
  }

  noShow(
    actor: LifecycleActor,
    appointmentId: string,
    command: NoShowCommand,
  ): Promise<AppointmentView> {
    const note = normalizedNote(command.note);
    if (command.reason === 'OTHER' && !note) {
      throw new AppException(
        400,
        'APPOINTMENT_NO_SHOW_NOTE_REQUIRED',
        'A note is required for the selected no-show reason',
      );
    }
    const requestFingerprint = fingerprint({
      type: 'NO_SHOW',
      reason: command.reason,
      note,
    });
    return this.transition(
      actor,
      appointmentId,
      'NO_SHOW',
      command.idempotencyKey,
      requestFingerprint,
      (appointment, now) => {
        if (
          !['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status)
        ) {
          throw transitionInvalid();
        }
        if (appointment.startsAt.getTime() > now.getTime()) {
          throw new AppException(
            409,
            'APPOINTMENT_NO_SHOW_TOO_EARLY',
            'Appointment cannot be marked no-show before its start time',
          );
        }
        return {
          status: 'NO_SHOW',
          noShowAt: now,
          noShowReason: command.reason,
          outcomeNote: note,
        };
      },
      command.reason,
      note ?? undefined,
    );
  }

  private transition(
    actor: LifecycleActor,
    appointmentId: string,
    eventType: Extract<
      AppointmentTimelineEventType,
      'STARTED' | 'COMPLETED' | 'NO_SHOW'
    >,
    idempotencyKey: string,
    requestFingerprint: string,
    update: (
      appointment: AppointmentEntity,
      now: Date,
    ) => Partial<AppointmentEntity>,
    reasonCode?: string,
    note?: string,
  ): Promise<AppointmentView> {
    return this.database.withTransaction(async (session) => {
      const replay = await this.replay(
        session,
        actor.tenantId,
        appointmentId,
        eventType,
        idempotencyKey,
        requestFingerprint,
      );
      if (replay) return replay;
      const appointment = await this.database.models.appointment
        .findOne({ _id: appointmentId, tenantId: actor.tenantId })
        .session(session)
        .lean()
        .exec();
      if (!appointment) throw appointmentNotFound();
      const now = new Date();
      const set = update(appointment, now);
      const updated = await this.database.models.appointment
        .findOneAndUpdate(
          {
            _id: appointmentId,
            tenantId: actor.tenantId,
            status: appointment.status,
          },
          { $set: set },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated) throw transitionInvalid();
      if (eventType !== 'STARTED') {
        await this.intervalLocks.release(
          actor.tenantId,
          appointmentId,
          session,
        );
      }
      await this.effects.recordStatusTransition(
        session,
        actor,
        appointment,
        updated.toObject(),
        eventType,
        idempotencyKey,
        requestFingerprint,
        reasonCode,
        note,
      );
      return appointmentView(updated.toObject(), now);
    });
  }

  private async replay(
    session: ClientSession,
    tenantId: string,
    appointmentId: string,
    eventType: AppointmentTimelineEventType,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<AppointmentView | null> {
    const event = await this.database.models.appointmentTimelineEvent
      .findOne({ tenantId, appointmentId, idempotencyKey })
      .session(session)
      .lean()
      .exec();
    if (!event) return null;
    if (
      event.eventType !== eventType ||
      event.requestFingerprint !== requestFingerprint
    ) {
      throw new AppException(
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'Idempotency key was already used with different input',
      );
    }
    const appointment = await this.database.models.appointment
      .findOne({ _id: appointmentId, tenantId })
      .session(session)
      .lean()
      .exec();
    if (!appointment) throw appointmentNotFound();
    return appointmentView(appointment);
  }
}

function fingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedNote(note: string | undefined): string | null {
  return note?.trim() || null;
}

const appointmentNotFound = (): AppException =>
  new AppException(404, 'APPOINTMENT_NOT_FOUND', 'Appointment was not found');

const transitionInvalid = (): AppException =>
  new AppException(
    409,
    'APPOINTMENT_TRANSITION_INVALID',
    'Appointment transition is not allowed from its current status',
  );
