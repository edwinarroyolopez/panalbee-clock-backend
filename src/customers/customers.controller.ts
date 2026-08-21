import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentAuth, TenantRoles } from '../auth/auth.decorators';
import { TENANT_ROLES } from '../auth/auth.types';
import type { TenantAuthContext } from '../auth/auth.types';
import { CreateCustomerDto } from './customer.dto';
import { CustomersService } from './customers.service';
import type { CustomerView } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @TenantRoles(...TENANT_ROLES)
  @Get()
  list(
    @CurrentAuth() auth: TenantAuthContext,
  ): Promise<{ items: CustomerView[] }> {
    return this.customers.list(auth.tenant.id);
  }

  @TenantRoles(...TENANT_ROLES)
  @Get(':customerId')
  get(
    @CurrentAuth() auth: TenantAuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
  ): Promise<CustomerView> {
    return this.customers.get(auth.tenant.id, customerId);
  }

  @TenantRoles('OWNER', 'MANAGER', 'AGENT')
  @Post()
  create(
    @CurrentAuth() auth: TenantAuthContext,
    @Body() dto: CreateCustomerDto,
  ): Promise<CustomerView> {
    return this.customers.create(auth.tenant.id, dto);
  }
}
