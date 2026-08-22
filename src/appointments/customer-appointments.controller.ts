import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { AppointmentManagementService } from './appointment-management.service';
import {
  CancelAppointmentDto,
  RequestCustomerAccessCodeDto,
  RescheduleAppointmentDto,
  VerifyCustomerAccessCodeDto,
} from './appointment.dto';
import type { AppointmentView } from './appointment.view';
import { CustomerAppointmentAccessService } from './customer-appointment-access.service';
import {
  CustomerAccessCodeResult,
  CustomerSessionResult,
} from './customer-appointment-access.types';

@Public()
@Controller('public/:tenantSlug/customer-access')
export class PublicCustomerAccessController {
  constructor(private readonly access: CustomerAppointmentAccessService) {}

  @Post('challenges')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'private, no-store')
  requestCode(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: RequestCustomerAccessCodeDto,
    @Req() request: Request,
  ): Promise<CustomerAccessCodeResult> {
    return this.access.requestCode(
      tenantSlug,
      dto.phone,
      request.ip || 'unknown',
    );
  }

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  verifyCode(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: VerifyCustomerAccessCodeDto,
  ): Promise<CustomerSessionResult> {
    return this.access.verifyCode(tenantSlug, dto.phone, dto.code);
  }
}

@Public()
@Controller('public/:tenantSlug/customer-appointments')
export class PublicCustomerAppointmentsController {
  constructor(
    private readonly access: CustomerAppointmentAccessService,
    private readonly management: AppointmentManagementService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async list(
    @Param('tenantSlug') tenantSlug: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ items: AppointmentView[] }> {
    const session = await this.access.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.management.listCustomer(session.tenantId, session.customerId);
  }

  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: CancelAppointmentDto,
  ): Promise<AppointmentView> {
    const session = await this.access.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.management.cancelCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
      dto.reason,
    );
  }

  @Post(':appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: RescheduleAppointmentDto,
  ): Promise<AppointmentView> {
    const session = await this.access.authenticate(
      tenantSlug,
      bearerToken(authorization),
    );
    return this.management.rescheduleCustomer(
      session.tenantId,
      session.customerId,
      appointmentId,
      dto.startsAt,
    );
  }
}

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  if (!match) {
    throw new AppException(
      401,
      'CUSTOMER_SESSION_INVALID',
      'Customer session is invalid or expired',
    );
  }
  return match[1];
}
