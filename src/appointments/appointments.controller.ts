import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import { AppointmentManagementService } from './appointment-management.service';
import {
  AppointmentListQueryDto,
  CancelAppointmentDto,
  CreatePublicAppointmentDto,
  CreateTenantAppointmentDto,
  PublicAppointmentListQueryDto,
  PublicCancelAppointmentDto,
  PublicRescheduleAppointmentDto,
  RescheduleAppointmentDto,
} from './appointment.dto';
import type {
  AppointmentView,
  PublicAppointmentResult,
} from './appointment.view';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly management: AppointmentManagementService,
  ) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query() query: AppointmentListQueryDto,
  ): Promise<{ items: AppointmentView[] }> {
    return this.appointments.list(auth.tenant.id, query);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateTenantAppointmentDto,
  ): Promise<AppointmentView> {
    return this.appointments.createTenant(auth.tenant.id, auth.userId, dto);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CancelAppointmentDto,
  ): Promise<AppointmentView> {
    return this.management.cancelTenant(
      auth.tenant.id,
      appointmentId,
      auth.userId,
      dto.reason,
    );
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: RescheduleAppointmentDto,
  ): Promise<AppointmentView> {
    return this.management.rescheduleTenant(
      auth.tenant.id,
      appointmentId,
      auth.userId,
      dto.startsAt,
    );
  }
}

@Public()
@Controller('public/:tenantSlug/appointments')
export class PublicAppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly management: AppointmentManagementService,
  ) {}

  @Get()
  list(
    @Param('tenantSlug') tenantSlug: string,
    @Query() query: PublicAppointmentListQueryDto,
  ): Promise<{ items: AppointmentView[] }> {
    return this.management.listPublic(tenantSlug, query.managementToken);
  }

  @Post()
  create(
    @Param('tenantSlug') tenantSlug: string,
    @Body() dto: CreatePublicAppointmentDto,
  ): Promise<PublicAppointmentResult> {
    return this.appointments.createPublic(tenantSlug, dto);
  }

  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: PublicCancelAppointmentDto,
  ): Promise<AppointmentView> {
    return this.management.cancelPublic(
      tenantSlug,
      appointmentId,
      dto.managementToken,
      dto.reason,
    );
  }

  @Post(':appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @Param('tenantSlug') tenantSlug: string,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: PublicRescheduleAppointmentDto,
  ): Promise<AppointmentView> {
    return this.management.reschedulePublic(
      tenantSlug,
      appointmentId,
      dto.managementToken,
      dto.startsAt,
    );
  }
}
