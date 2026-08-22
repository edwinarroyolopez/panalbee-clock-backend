import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentTimelineView,
  appointmentTimelineEventView,
  appointmentView,
} from './appointment.view';
import { appointmentSurveyView } from './appointment-feedback.view';

@Injectable()
export class AppointmentTimelineService {
  constructor(private readonly database: DatabaseService) {}

  async get(
    tenantId: string,
    appointmentId: string,
    internal = true,
  ): Promise<AppointmentTimelineView> {
    const appointment = await this.database.models.appointment
      .findOne({ _id: appointmentId, tenantId })
      .lean()
      .exec();
    if (!appointment) {
      throw new AppException(
        404,
        'APPOINTMENT_NOT_FOUND',
        'Appointment was not found',
      );
    }
    const [events, survey] = await Promise.all([
      this.database.models.appointmentTimelineEvent
        .find({ tenantId, appointmentId })
        .sort({ createdAt: 1, _id: 1 })
        .lean()
        .exec(),
      this.database.models.appointmentSurveyResponse
        .findOne({ tenantId, appointmentId })
        .lean()
        .exec(),
    ]);
    const visibleEvents = internal
      ? events
      : events.filter((event) => event.eventType !== 'EVIDENCE_ADDED');
    const items = visibleEvents.map((event) =>
      appointmentTimelineEventView(event, internal),
    );
    if (!events.some((event) => event.eventType === 'CREATED')) {
      items.unshift({
        id: `legacy-created:${appointment._id}`,
        type: 'CREATED',
        occurredAt: appointment.createdAt.toISOString(),
        fromStatus: null,
        toStatus: 'CONFIRMED',
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        previousStartsAt: null,
        previousEndsAt: null,
        ...(internal
          ? { actorType: 'SYSTEM' as const, actorUserId: null }
          : {}),
        synthetic: true,
      });
    }
    return {
      appointment: appointmentView(appointment),
      items,
      survey: survey ? appointmentSurveyView(survey) : null,
    };
  }
}
