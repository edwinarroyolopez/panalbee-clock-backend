import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { TenantAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import type { AffiliatePayoutEntity } from '../database/models';
import { AffiliateLedgerService } from './affiliate-ledger.service';
import {
  insufficientBalance,
  MAX_PROCESSING_AFFILIATE_PAYOUTS,
  payoutProcessingLimit,
} from './affiliate-payout.policy';

@Injectable()
export class AffiliatePayoutStore {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledger: AffiliateLedgerService,
    private readonly audit: AuditService,
  ) {}

  async assertCustomer(
    tenantId: string,
    customerId: string,
    session: ClientSession,
  ): Promise<void> {
    const customer = await this.database.models.customer
      .exists({ _id: customerId, tenantId })
      .session(session);
    if (!customer) {
      throw new AppException(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
  }

  async availableBalance(
    tenantId: string,
    customerId: string,
    currency: string,
    session: ClientSession,
  ): Promise<number> {
    await this.acquireBalanceLock(tenantId, customerId, currency, session);
    const balances = await this.ledger.balances(tenantId, customerId, session);
    const reservation = await this.reserved(
      tenantId,
      customerId,
      currency,
      session,
    );
    const balance =
      balances.find((item) => item.currency === currency)?.balanceMinor ?? 0;
    return balance - reservation;
  }

  async acquireBalanceLock(
    tenantId: string,
    customerId: string,
    currency: string,
    session: ClientSession,
  ): Promise<void> {
    const lock = await this.database.models.affiliateBalanceLock
      .findOneAndUpdate(
        { tenantId, affiliateCustomerId: customerId, currency },
        { $inc: { version: 1 } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (!lock) throw insufficientBalance();
  }

  async assertProcessingCapacity(
    tenantId: string,
    customerId: string,
    session: ClientSession,
  ): Promise<void> {
    const lock = await this.database.models.affiliatePayoutCapacityLock
      .findOneAndUpdate(
        { tenantId, affiliateCustomerId: customerId },
        { $inc: { version: 1 } },
        { returnDocument: 'after', session },
      )
      .lean()
      .exec();
    if (!lock) throw insufficientBalance();
    const count = await this.database.models.affiliatePayout
      .countDocuments({
        tenantId,
        affiliateCustomerId: customerId,
        status: 'PROCESSING',
      })
      .session(session)
      .exec();
    if (count >= MAX_PROCESSING_AFFILIATE_PAYOUTS) {
      throw payoutProcessingLimit();
    }
  }

  recordAudit(
    action: string,
    auth: TenantAuthContext,
    payout: AffiliatePayoutEntity,
    requestId: string,
    session: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        tenantId: auth.tenant.id,
        actorUserId: auth.userId,
        actorType: 'TENANT_USER',
        action,
        entityType: 'AffiliatePayout',
        entityId: payout._id,
        requestId,
        metadata: {
          customerId: payout.affiliateCustomerId,
          currency: payout.currency,
          amountMinor: payout.amountMinor,
          method: payout.method,
        },
      },
      session,
    );
  }

  private async reserved(
    tenantId: string,
    customerId: string,
    currency: string,
    session: ClientSession,
  ): Promise<number> {
    const rows = await this.database.models.affiliatePayout
      .aggregate<{ _id: null; total: number }>([
        {
          $match: {
            tenantId,
            affiliateCustomerId: customerId,
            currency,
            status: 'PROCESSING',
          },
        },
        { $group: { _id: null, total: { $sum: '$amountMinor' } } },
      ])
      .session(session)
      .exec();
    return rows[0]?.total ?? 0;
  }
}
