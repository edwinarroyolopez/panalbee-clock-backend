import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  CustomerEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import { CreateCustomerDto } from './customer.dto';
import { SearchCustomersDto, CustomerSearchPage } from './customer-search.dto';

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

  async get(
    tenantId: string,
    customerId: string,
    session?: ClientSession,
  ): Promise<CustomerView> {
    const customer = await this.database.models.customer
      .findOne({ _id: customerId, tenantId })
      .session(session ?? null)
      .lean()
      .exec();
    if (!customer) {
      throw new AppException(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    return customerView(customer);
  }

  async search(
    tenantId: string,
    dto: SearchCustomersDto,
  ): Promise<CustomerSearchPage> {
    const limit = dto.limit ?? 50;
    const term = dto.query?.trim();
    const literal = term?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const customers = await this.database.models.customer
      .find({
        tenantId,
        ...(dto.cursor ? { _id: { $gt: dto.cursor } } : {}),
        ...(literal
          ? {
              $or: [
                { fullName: { $regex: literal, $options: 'i' } },
                { phone: { $regex: literal } },
              ],
            }
          : {}),
      })
      .select({ _id: 1, fullName: 1, phone: 1, email: 1 })
      .sort({ _id: 1 })
      .limit(limit + 1)
      .maxTimeMS(1500)
      .lean()
      .exec();
    const page = customers.slice(0, limit);
    const hasMore = customers.length > limit;
    return {
      items: page.map((customer) => ({
        id: customer._id,
        fullName: customer.fullName,
        phone: customer.phone ?? null,
        email: customer.email ?? null,
      })),
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]._id : null,
      },
    };
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
