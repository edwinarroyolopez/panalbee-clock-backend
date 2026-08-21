import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  CreateAvailabilityExceptionDto,
  CreateScheduleDto,
  ExceptionListQueryDto,
  ScheduleListQueryDto,
} from './schedule.dto';
import { SchedulesService } from './schedules.service';
import type {
  AvailabilityExceptionView,
  ScheduleView,
} from './schedules.service';

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query() query: ScheduleListQueryDto,
  ): Promise<{ items: ScheduleView[] }> {
    return this.schedules.list(auth.tenant.id, query);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleView> {
    return this.schedules.create(auth.tenant.id, dto);
  }
}

@Controller('schedules/exceptions')
export class AvailabilityExceptionsController {
  constructor(private readonly schedules: SchedulesService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query() query: ExceptionListQueryDto,
  ): Promise<{ items: AvailabilityExceptionView[] }> {
    return this.schedules.listExceptions(auth.tenant.id, query);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateAvailabilityExceptionDto,
  ): Promise<AvailabilityExceptionView> {
    return this.schedules.createException(auth.tenant.id, dto);
  }
}
