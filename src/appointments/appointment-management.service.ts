import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AccountPublicAccessService } from '../accounts/account-public-access.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AppointmentEntity } from '../database/models';
import { AppointmentEffectsService } from './appointment-effects.service';
import { AppointmentIntervalLockService } from './appointment-interval-lock.service';
import { AppointmentPublicQueryService } from './appointment-public-query.service';
import { AppointmentRescheduleRelationService } from './appointment-reschedule-relation.service';
import { AppointmentView, appointmentView } from './appointment.view';
import { tokenHash } from './appointments.service';

interface ManagementAccess {
  tenantId: string;
  appointmentId: string;
  actorUserId: string | null;
  actorType: 'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER';
  publicOnly: boolean;
  token?: string;
}

@Injectable()
export class AppointmentManagementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly effects: AppointmentEffectsService,
    private readonly intervalLocks: AppointmentIntervalLockService,
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

  cancelTenant(
    tenantId: string,
    appointmentId: string,
    actorUserId: string,
    actorType: 'TENANT_USER' | 'INTERNAL_USER',
    reason: string,
  ): Promise<AppointmentView> {
    return this.cancel(
      {
        tenantId,
        appointmentId,
        actorUserId,
        actorType,
        publicOnly: false,
      },
      reason,
    );
  }

  async cancelPublic(
    tenantSlug: string,
    appointmentId: string,
    token: string,
    reason: string,
  ): Promise<AppointmentView> {
    return this.cancel(
      await this.publicAccess(tenantSlug, appointmentId, token),
      reason,
    );
  }

  rescheduleTenant(
    tenantId: string,
    appointmentId: string,
    actorUserId: string,
    actorType: 'TENANT_USER' | 'INTERNAL_USER',
    startsAt: string,
  ): Promise<AppointmentView> {
    return this.reschedule(
      {
        tenantId,
        appointmentId,
        actorUserId,
        actorType,
        publicOnly: false,
      },
      startsAt,
    );
  }

  async reschedulePublic(
    tenantSlug: string,
    appointmentId: string,
    token: string,
    startsAt: string,
  ): Promise<AppointmentView> {
    return this.reschedule(
      await this.publicAccess(tenantSlug, appointmentId, token),
      startsAt,
    );
  }

  private async cancel(
    access: ManagementAccess,
    reason: string,
  ): Promise<AppointmentView> {
    return this.database.withTransaction(async (session) => {
      const appointment = await this.load(access, session);
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
      );
      return appointmentView(updated.toObject());
    });
  }

  private async reschedule(
    access: ManagementAccess,
    startsAtInput: string,
  ): Promise<AppointmentView> {
    const startsAt = new Date(startsAtInput);
    return this.database.withTransaction(async (session) => {
      if (access.publicOnly) {
        await this.publicAccessService.assertTenantBookingEnabled(
          access.tenantId,
          session,
        );
      }
      const appointment = await this.load(access, session);
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
      );
      return appointmentView(updated.toObject());
    });
  }

  private async load(
    access: ManagementAccess,
    session: ClientSession,
  ): Promise<AppointmentEntity> {
    if (access.publicOnly) {
      const activeTenant = await this.database.models.tenant
        .exists({ _id: access.tenantId, status: 'ACTIVE' })
        .session(session)
        .exec();
      if (!activeTenant) throw appointmentNotFound();
    }
    const appointment = await this.database.models.appointment
      .findOne({
        _id: access.appointmentId,
        tenantId: access.tenantId,
        ...(access.token
          ? { managementTokenHash: tokenHash(access.token) }
          : {}),
      })
      .session(session)
      .lean()
      .exec();
    if (!appointment) throw appointmentNotFound();
    return appointment;
  }

  private assertActive(appointment: AppointmentEntity): void {
    if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) {
      throw appointmentNotActive();
    }
  }

  private async publicAccess(
    tenantSlug: string,
    appointmentId: string,
    token: string,
  ): Promise<ManagementAccess> {
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .lean()
      .exec();
    if (!tenant) throw appointmentNotFound();
    return {
      tenantId: tenant._id,
      appointmentId,
      actorUserId: null,
      actorType: 'CUSTOMER',
      publicOnly: true,
      token,
    };
  }
}

function actorFor(access: ManagementAccess) {
  return {
    tenantId: access.tenantId,
    actorUserId: access.actorUserId,
    actorType: access.actorType,
  };
}

const appointmentNotFound = (): AppException =>
  new AppException(404, 'APPOINTMENT_NOT_FOUND', 'Appointment not found');

const appointmentNotActive = (): AppException =>
  new AppException(409, 'APPOINTMENT_NOT_ACTIVE', 'Appointment is not active');
