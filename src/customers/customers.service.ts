import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  CustomerEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import { CreateCustomerDto } from './customer.dto';

export interface CustomerView {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string): Promise<{ items: CustomerView[] }> {
    const customers = await this.database.models.customer
      .find({ tenantId })
      .sort({ fullName: 1, _id: 1 })
      .lean()
      .exec();
    return { items: customers.map(customerView) };
  }

  async get(tenantId: string, customerId: string): Promise<CustomerView> {
    const customer = await this.database.models.customer
      .findOne({ _id: customerId, tenantId })
      .lean()
      .exec();
    if (!customer) {
      throw new AppException(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    return customerView(customer);
  }

  async create(
    tenantId: string,
    dto: CreateCustomerDto,
  ): Promise<CustomerView> {
    try {
      const customer = await this.database.models.customer.create({
        tenantId,
        fullName: dto.fullName.trim(),
        ...(dto.phone ? { phone: dto.phone } : {}),
        ...(dto.email ? { email: dto.email.toLowerCase() } : {}),
        ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
      });
      return customerView(customer.toObject());
    } catch (error) {
      if (isNamedDuplicateKey(error, INDEX_NAMES.customerPhone)) {
        throw new AppException(
          409,
          'CUSTOMER_PHONE_CONFLICT',
          'A customer already uses this phone number',
        );
      }
      throw error;
    }
  }
}

function customerView(customer: CustomerEntity): CustomerView {
  return {
    id: customer._id,
    fullName: customer.fullName,
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt.toISOString(),
  };
}
