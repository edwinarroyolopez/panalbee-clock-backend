import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientSession } from 'mongoose';
import { ReferralAttributionService } from '../affiliates/referral-attribution.service';
import { Environment } from '../config/environment';
import type { CreateIntent } from './appointment-creation.store';
import { appointmentManagementToken } from './appointment-create-input';
import type {
  AppointmentView,
  PublicAppointmentResult,
} from './appointment.view';

@Injectable()
export class AppointmentResultService {
  constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly attributions: ReferralAttributionService,
  ) {}

  managementToken(appointmentId: string): string {
    return appointmentManagementToken(
      this.config.get('MANAGEMENT_TOKEN_SECRET', { infer: true }),
      appointmentId,
    );
  }

  async replay(
    appointment: AppointmentView,
    intent: CreateIntent,
    session?: ClientSession,
  ): Promise<PublicAppointmentResult> {
    const referral = await this.attributions.findReceipt(
      intent.tenantId,
      appointment.id,
      session,
    );
    return {
      ...appointment,
      ...(intent.publicCustomer
        ? { managementToken: this.managementToken(appointment.id) }
        : {}),
      ...(referral ? { referral } : {}),
    };
  }
}
