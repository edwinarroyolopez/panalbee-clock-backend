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
  Query,
} from '@nestjs/common';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { APPOINTMENT_MANAGEMENT_TOKEN_HEADER } from '../common/http-headers';
import { AppointmentManagementService } from './appointment-management.service';
import {
  AppointmentListQueryDto,
  CancelAppointmentDto,
  CreatePublicAppointmentDto,
  CreateTenantAppointmentDto,
  PublicAppointmentListQueryDto,
  PublicCancelAppointmentDto,
  PublicRescheduleAppointmentDto,
  TenantRescheduleAppointmentDto,
} from './appointment.dto';
import type {
  AppointmentView,
  PublicAppointmentResult,
  TenantAppointmentLifecycleView,
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
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Query() query: AppointmentListQueryDto,
  ): Promise<{ items: AppointmentView[] }> {
    return this.appointments.list(auth.tenant.id, query);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post()
  create(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Body() dto: CreateTenantAppointmentDto,
  ): Promise<AppointmentView> {
    return this.appointments.createTenant(auth, dto);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: CancelAppointmentDto,
  ): Promise<TenantAppointmentLifecycleView> {
    return this.management.cancelTenant(
      auth.tenant.id,
      appointmentId,
      auth.userId,
      auth.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
      dto.reason,
    );
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post(':appointmentId/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(
    @CurrentAuth() auth: TenantOperationAuthContext,
    @Param('appointmentId', ParseUUIDPipe) appointmentId: string,
    @Body() dto: TenantRescheduleAppointmentDto,
  ): Promise<TenantAppointmentLifecycleView> {
    return this.management.rescheduleTenant(
      auth.tenant.id,
      appointmentId,
      auth.userId,
      auth.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
      dto.startsAt,
      dto.reason,
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
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('tenantSlug') tenantSlug: string,
    @Query() query: PublicAppointmentListQueryDto,
    @Headers(APPOINTMENT_MANAGEMENT_TOKEN_HEADER)
    managementTokenHeader: string | undefined,
  ): Promise<{ items: AppointmentView[] }> {
    return this.management.listPublic(
      tenantSlug,
      resolveManagementToken(managementTokenHeader, query.managementToken),
    );
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

const MANAGEMENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

function resolveManagementToken(
  headerToken: string | undefined,
  queryToken: string | undefined,
): string {
  if (
    headerToken !== undefined &&
    !MANAGEMENT_TOKEN_PATTERN.test(headerToken)
  ) {
    throw managementTokenError('APPOINTMENT_MANAGEMENT_TOKEN_INVALID');
  }
  if (headerToken !== undefined && queryToken && headerToken !== queryToken) {
    throw managementTokenError('APPOINTMENT_MANAGEMENT_TOKEN_CONFLICT');
  }
  const token = headerToken ?? queryToken;
  if (!token) {
    throw managementTokenError('APPOINTMENT_MANAGEMENT_TOKEN_INVALID');
  }
  return token;
}

function managementTokenError(reasonCode: string): AppException {
  return new AppException(
    400,
    reasonCode,
    'Appointment management token is invalid',
  );
}
