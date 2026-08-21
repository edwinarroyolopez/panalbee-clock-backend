import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { CurrentAuth, InternalRoles } from '../auth/auth.decorators';
import type {
  AuthenticatedRequest,
  InternalAuthContext,
} from '../auth/auth.types';
import { BackofficeService } from './backoffice.service';
import type { BackofficeTenantView } from './backoffice.service';
import { UpdateTenantStatusDto } from './backoffice.dto';

@Controller('backoffice/tenants')
export class BackofficeController {
  constructor(private readonly backoffice: BackofficeService) {}

  @InternalRoles('PLATFORM_ADMIN', 'PLATFORM_SUPPORT')
  @Get()
  tenants(): Promise<{ items: BackofficeTenantView[] }> {
    return this.backoffice.tenants();
  }

  @InternalRoles('PLATFORM_ADMIN')
  @Patch(':tenantId/status')
  updateTenantStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentAuth() auth: InternalAuthContext,
    @Req() request: AuthenticatedRequest,
  ): Promise<BackofficeTenantView> {
    return this.backoffice.updateTenantStatus(
      tenantId,
      dto.status,
      dto.reason,
      auth,
      request.requestId,
    );
  }
}
