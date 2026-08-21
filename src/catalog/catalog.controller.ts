import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import { CatalogService } from './catalog.service';
import type { ServiceView } from './catalog.service';
import { CreateServiceDto } from './service.dto';

@Controller('services')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
  ): Promise<{ items: ServiceView[] }> {
    return this.catalog.list(auth.tenant.id);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateServiceDto,
  ): Promise<ServiceView> {
    return this.catalog.create(auth.tenant.id, dto);
  }
}

@Public()
@Controller('public/:tenantSlug/services')
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(
    @Param('tenantSlug') tenantSlug: string,
  ): Promise<{ items: ServiceView[] }> {
    return this.catalog.listPublic(tenantSlug);
  }
}
