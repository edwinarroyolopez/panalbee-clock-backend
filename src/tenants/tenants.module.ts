import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import {
  LocationsController,
  PublicTenantContextController,
  TenantsController,
} from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AccountsModule],
  controllers: [
    TenantsController,
    LocationsController,
    PublicTenantContextController,
  ],
  providers: [TenantsService],
})
export class TenantsModule {}
