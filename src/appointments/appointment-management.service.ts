import { Injectable } from '@nestjs/common';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AppointmentManagementAccessService,
  ManagementAccess,
} from './appointment-management-access.service';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentLifecycleNotificationService } from './appointment-lifecycle-notification.service';
import { AppointmentPublicQueryService } from './appointment-public-query.service';
import { AppointmentRescheduleRelationService } from './appointment-reschedule-relation.service';
import {
  AppointmentView,
  appointmentView,
  TenantAppointmentLifecycleView,
} from './appointment.view';

@Injectable()
export class AppointmentManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accesses: AppointmentManagementAccessService,
    private readonly availability: AvailabilityService,
    private readonly effects: AppointmentEffectsService,
    private readonly intervalLocks: AppointmentIntervalLockService,
    private readonly lifecycleNotifications: AppointmentLifecycleNotificationService,
    private readonly publicQuery: AppointmentPublicQueryService,
    private readonly rescheduleRelations: AppointmentRescheduleRelationService,
    private readonly publicAccessService: AccountPublicAccessService,
  ) {}

  async listPublic(
    tenantSlug: string,
    managementToken: string,
  ): Promise<{ items: AppointmentView[] }> {
    return this.publicQuery.list(tenantSlug, managementToken);
  }

  async listCustomer(
    tenantId: string,
    customerId: string,
  ): Promise<{ items: AppointmentView[] }> {
    return this.publicQuery.listCustomer(tenantId, customerId);
  }

  async cancelTenant(
    tenantId: string,
    appointmentId: string,
    actorUserId: string,
    actorType: 'TENANT_USER' | 'INTERNAL_USER',
    reason: string,
  ): Promise<TenantAppointmentLifecycleView> {
    const appointment = await this.cancel(
      {
        tenantId,
        appointmentId,
        actorUserId,
        actorType,
        publicOnly: false,
      },
      reason,
    );
    return this.lifecycleNotifications.deliver(
      tenantId,
      appointment,
      'BOOKING_CANCELLED',
    );
  }

  async cancelPublic(
    tenantSlug: string,
    appointmentId: string,
    token: string,
    reason: string,
  ): Promise<AppointmentView> {
    return this.cancel(
      await this.accesses.public(tenantSlug, appointmentId, token),
      reason,
    );
  }

  cancelCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
    reason: string,
  ): Promise<AppointmentView> {
    return this.cancel(
      this.accesses.customer(tenantId, customerId, appointmentId),
      reason,
    );
  }

  async rescheduleTenant(
    tenantId: string,
    appointmentId: string,
    actorUserId: string,
    actorType: 'TENANT_USER' | 'INTERNAL_USER',
    startsAt: string,
    reason: string,
  ): Promise<TenantAppointmentLifecycleView> {
    const appointment = await this.reschedule(
      {
        tenantId,
        appointmentId,
        actorUserId,
        actorType,
        publicOnly: false,
      },
      startsAt,
      reason,
    );
    return this.lifecycleNotifications.deliver(
      tenantId,
      appointment,
      'BOOKING_RESCHEDULED',
    );
  }

  async reschedulePublic(
    tenantSlug: string,
    appointmentId: string,
    token: string,
    startsAt: string,
  ): Promise<AppointmentView> {
    return this.reschedule(
      await this.accesses.public(tenantSlug, appointmentId, token),
      startsAt,
    );
  }

  rescheduleCustomer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
    startsAt: string,
  ): Promise<AppointmentView> {
    return this.reschedule(
      this.accesses.customer(tenantId, customerId, appointmentId),
      startsAt,
    );
  }

  private async cancel(
    access: ManagementAccess,
    reason: string,
  ): Promise<AppointmentView> {
    return this.database.withTransaction(async (session) => {
      const appointment = await this.accesses.load(access, session);
      const normalizedReason = reason.trim();
      if (
        appointment.status === 'CANCELLED' &&
        appointment.cancellationReason === normalizedReason
      ) {
        return appointmentView(appointment);
      }
      this.assertActive(appointment);
      const cancelledAt = new Date();
      const updated = await this.database.models.appointment
        .findOneAndUpdate(
          {
            _id: appointment._id,
            tenantId: access.tenantId,
            status: { $in: ['PENDING', 'CONFIRMED'] },
          },
          {
            $set: {
              status: 'CANCELLED',
              cancelledAt,
              cancellationReason: normalizedReason,
            },
          },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated) throw appointmentNotActive();
      await this.intervalLocks.release(
        access.tenantId,
        appointment._id,
        session,
      );
      await this.effects.recordLifecycle(
        session,
        actorFor(access),
        updated,
        'BOOKING_CANCELLED',
        'APPOINTMENT_CANCELLED',
        normalizedReason,
        {
          status: appointment.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
        },
      );
      return appointmentView(updated.toObject());
    });
  }

  private async reschedule(
    access: ManagementAccess,
    startsAtInput: string,
    reason?: string,
  ): Promise<AppointmentView> {
    const startsAt = new Date(startsAtInput);
    return this.database.withTransaction(async (session) => {
      if (access.publicOnly) {
        await this.publicAccessService.assertTenantBookingEnabled(
          access.tenantId,
          session,
        );
      }
      const appointment = await this.accesses.load(access, session);
      this.assertActive(appointment);
      if (appointment.startsAt.getTime() === startsAt.getTime()) {
        return appointmentView(appointment);
      }
      const relation = await this.rescheduleRelations.resolve(
        access.tenantId,
        access.publicOnly,
        appointment,
        startsAt,
        session,
      );
      await this.availability.assertSlotAvailable(
        access.tenantId,
        {
          locationId: appointment.locationId,
          serviceId: appointment.serviceId,
          staffId: appointment.staffId,
          date: relation.localDate,
        },
        startsAt.toISOString(),
        {
          session,
          publicOnly: access.publicOnly,
          excludeAppointmentId: appointment._id,
          appointmentConflict: true,
        },
      );
      const endsAt = new Date(
        startsAt.getTime() + relation.durationMinutes * 60_000,
      );
      await this.intervalLocks.replace(
        access.tenantId,
        appointment.staffId,
        appointment._id,
        startsAt,
        endsAt,
        session,
      );
      const updated = await this.database.models.appointment
        .findOneAndUpdate(
          {
            _id: appointment._id,
            tenantId: access.tenantId,
            status: { $in: ['PENDING', 'CONFIRMED'] },
          },
          { $set: { startsAt, endsAt } },
          { returnDocument: 'after', session },
        )
        .exec();
      if (!updated) throw appointmentNotActive();
      await this.effects.recordLifecycle(
        session,
        actorFor(access),
        updated,
        'BOOKING_RESCHEDULED',
        'APPOINTMENT_RESCHEDULED',
        reason?.trim(),
        {
          status: appointment.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
        },
      );
      return appointmentView(updated.toObject());
    });
  }

  private assertActive(appointment: { status: string }): void {
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
      throw appointmentNotActive();
    }
  }
}

function actorFor(access: ManagementAccess) {
  return {
    tenantId: access.tenantId,
    actorUserId: access.actorUserId,
    actorType: access.actorType,
  };
}

const appointmentNotActive = (): AppException =>
  new AppException(409, 'APPOINTMENT_NOT_ACTIVE', 'Appointment is not active');
