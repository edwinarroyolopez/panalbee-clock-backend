import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, Public, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import { AvailabilityQueryDto } from './availability.dto';
import { AvailabilityService } from './availability.service';
import type { AvailabilitySlot } from './availability.service';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
    @Query() query: AvailabilityQueryDto,
  ): Promise<{ items: AvailabilitySlot[] }> {
    return this.availability.listForTenant(auth.tenant.id, query);
  }
}

@Public()
@Controller('public/:tenantSlug/availability')
export class PublicAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  list(
    @Param('tenantSlug') tenantSlug: string,
    @Query() query: AvailabilityQueryDto,
  ): Promise<{ items: AvailabilitySlot[] }> {
    return this.availability.listPublic(tenantSlug, query);
  }
}
