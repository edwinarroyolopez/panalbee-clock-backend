import { Module } from '@nestjs/common';
import {
  LocationsController,
  PublicTenantContextController,
  TenantsController,
} from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [
    TenantsController,
    LocationsController,
    PublicTenantContextController,
  ],
  providers: [TenantsService],
})
export class TenantsModule {}
