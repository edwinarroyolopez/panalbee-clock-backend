import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import { Public } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import { UpdateLocationDto } from './location.dto';
import { TenantsService } from './tenants.service';
import type {
  LocationView,
  PublicTenantContext,
  TenantView,
} from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get('me')
  current(@CurrentAuth() auth: TenantAuthContext): Promise<TenantView> {
    return this.tenants.current(auth.tenant.id);
  }
}

@Controller('locations')
export class LocationsController {
  constructor(private readonly tenants: TenantsService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  locations(
    @CurrentAuth() auth: TenantAuthContext,
  ): Promise<{ items: LocationView[] }> {
    return this.tenants.locations(auth.tenant.id);
  }

  @TenantRoles(...TENANT_ROLES)
  @Get(':locationId')
  location(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ): Promise<LocationView> {
    return this.tenants.location(auth.tenant.id, locationId);
  }

  @TenantRoles('OWNER', 'MANAGER')
  @Patch(':locationId')
  updateLocation(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<LocationView> {
    return this.tenants.updateLocation(auth.tenant.id, locationId, dto.name);
  }
}

@Controller('public/:tenantSlug/context')
export class PublicTenantContextController {
  constructor(private readonly tenants: TenantsService) {}

  @Public()
  @Get()
  context(
    @Param('tenantSlug') tenantSlug: string,
  ): Promise<PublicTenantContext> {
    return this.tenants.publicContext(tenantSlug);
  }
}
