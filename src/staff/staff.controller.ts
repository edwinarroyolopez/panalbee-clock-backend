import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import {
  AddStaffServiceDto,
  CreateStaffDto,
  StaffListQueryDto,
} from './staff.dto';
import { StaffService } from './staff.service';
import type { StaffServiceView, StaffView } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query() query: StaffListQueryDto,
  ): Promise<{ items: StaffView[] }> {
    return this.staff.list(auth.tenant.id, query);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffView> {
    return this.staff.create(auth.tenant.id, dto);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post(':staffId/services')
  addService(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('staffId', ParseUUIDPipe) staffId: string,
    @Body() dto: AddStaffServiceDto,
  ): Promise<StaffServiceView> {
    return this.staff.addService(auth.tenant.id, staffId, dto);
  }
}
