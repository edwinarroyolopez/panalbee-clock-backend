import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { AppointmentEntity } from '../database/models';
import { tokenHash } from './appointments.service';

export interface ManagementAccess {
  tenantId: string;
  appointmentId: string;
  actorUserId: string | null;
  actorType: 'TENANT_USER' | 'INTERNAL_USER' | 'CUSTOMER';
  publicOnly: boolean;
  token?: string;
  customerId?: string;
}

@Injectable()
export class AppointmentManagementAccessService {
  constructor(private readonly database: DatabaseService) {}

  customer(
    tenantId: string,
    customerId: string,
    appointmentId: string,
  ): ManagementAccess {
    return {
      tenantId,
      appointmentId,
      customerId,
      actorUserId: null,
      actorType: 'CUSTOMER',
      publicOnly: true,
    };
  }

  async public(
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

  async load(
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
        ...(access.customerId ? { customerId: access.customerId } : {}),
      })
      .session(session)
      .lean()
      .exec();
    if (!appointment) throw appointmentNotFound();
    return appointment;
  }
}

function appointmentNotFound(): AppException {
  return new AppException(
    404,
    'APPOINTMENT_NOT_FOUND',
    'Appointment not found',
  );
}
