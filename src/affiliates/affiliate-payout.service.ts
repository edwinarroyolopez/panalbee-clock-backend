import { Injectable } from '@nestjs/common';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { DatabaseService } from '../database/database.service';
import {
  AffiliatePayoutEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';
import type {
  CompleteAffiliatePayoutDto,
  CreateAffiliatePayoutDto,
  FailAffiliatePayoutDto,
} from './affiliate.dto';
import {
  affiliatePayoutView,
  AffiliatePayoutView,
} from './affiliate-detail.view';
import {
  assertDirectTenant,
  insufficientBalance,
  optionalPayoutText,
  payoutConflict,
  payoutNotFound,
  requiredPayoutText,
} from './affiliate-payout.policy';
import { AffiliatePayoutStore } from './affiliate-payout.store';

type TerminalInput =
  | { status: 'PAID'; idempotencyKey: string; externalReference: string }
  | {
      status: 'FAILED' | 'CANCELLED';
      idempotencyKey: string;
      reason: string;
    };

@Injectable()
export class AffiliatePayoutService {
  constructor(
    private readonly database: DatabaseService,
    private readonly store: AffiliatePayoutStore,
  ) {}

  async create(
    auth: TenantOperationAuthContext,
    customerId: string,
    dto: CreateAffiliatePayoutDto,
    requestId: string,
  ): Promise<AffiliatePayoutView> {
    assertDirectTenant(auth);
    const externalReference = optionalPayoutText(dto.externalReference);
    try {
      return await this.database.withTransaction(async (session) => {
        await this.store.assertCustomer(auth.tenant.id, customerId, session);
        const replay = await this.database.models.affiliatePayout
          .findOne({
            tenantId: auth.tenant.id,
            createIdempotencyKey: dto.idempotencyKey,
          })
          .session(session)
          .lean()
          .exec();
        if (replay) {
          return this.createReplay(replay, customerId, dto, externalReference);
        }
        await this.store.assertProcessingCapacity(
          auth.tenant.id,
          customerId,
          session,
        );
        const available = await this.store.availableBalance(
          auth.tenant.id,
          customerId,
          dto.currency,
          session,
        );
        if (available < dto.amountMinor) throw insufficientBalance();
        const payout = new this.database.models.affiliatePayout({
          tenantId: auth.tenant.id,
          affiliateCustomerId: customerId,
          currency: dto.currency,
          amountMinor: dto.amountMinor,
          method: 'MANUAL',
          status: 'PROCESSING',
          createdByUserId: auth.userId,
          createIdempotencyKey: dto.idempotencyKey,
          ...(externalReference
            ? { createExternalReference: externalReference, externalReference }
            : {}),
        });
        await payout.save({ session });
        await this.store.recordAudit(
          'AFFILIATE_PAYOUT_CREATED',
          auth,
          payout.toObject(),
          requestId,
          session,
        );
        return affiliatePayoutView(payout.toObject());
      });
    } catch (error) {
      if (
        !isNamedDuplicateKey(
          error,
          INDEX_NAMES.affiliatePayoutCreateIdempotency,
        )
      ) {
        throw error;
      }
      const replay = await this.database.models.affiliatePayout
        .findOne({
          tenantId: auth.tenant.id,
          createIdempotencyKey: dto.idempotencyKey,
        })
        .lean()
        .exec();
      if (replay) {
        return this.createReplay(replay, customerId, dto, externalReference);
      }
      throw payoutConflict();
    }
  }

  markPaid(
    auth: TenantOperationAuthContext,
    customerId: string,
    payoutId: string,
    dto: CompleteAffiliatePayoutDto,
    requestId: string,
  ): Promise<AffiliatePayoutView> {
    assertDirectTenant(auth);
    return this.transition(
      auth,
      customerId,
      payoutId,
      {
        status: 'PAID',
        idempotencyKey: dto.idempotencyKey,
        externalReference: requiredPayoutText(
          dto.externalReference,
          'reference',
        ),
      },
      requestId,
    );
  }

  markUnpaid(
    auth: TenantOperationAuthContext,
    customerId: string,
    payoutId: string,
    dto: FailAffiliatePayoutDto,
    requestId: string,
    status: 'FAILED' | 'CANCELLED',
  ): Promise<AffiliatePayoutView> {
    assertDirectTenant(auth);
    return this.transition(
      auth,
      customerId,
      payoutId,
      {
        status,
        idempotencyKey: dto.idempotencyKey,
        reason: requiredPayoutText(dto.reason, 'reason'),
      },
      requestId,
    );
  }

  private async transition(
    auth: TenantOperationAuthContext,
    customerId: string,
    payoutId: string,
    input: TerminalInput,
    requestId: string,
  ): Promise<AffiliatePayoutView> {
    assertDirectTenant(auth);
    try {
      return await this.database.withTransaction(async (session) => {
        const payout = await this.database.models.affiliatePayout
          .findOne({
            _id: payoutId,
            tenantId: auth.tenant.id,
            affiliateCustomerId: customerId,
          })
          .session(session)
          .exec();
        if (!payout) throw payoutNotFound();
        if (payout.status !== 'PROCESSING') {
          return this.terminalReplay(payout.toObject(), input);
        }
        await this.store.acquireBalanceLock(
          auth.tenant.id,
          customerId,
          payout.currency,
          session,
        );
        if (input.status === 'PAID') {
          const entry = new this.database.models.affiliateLedgerEntry({
            tenantId: auth.tenant.id,
            affiliateCustomerId: customerId,
            payoutId: payout._id,
            currency: payout.currency,
            direction: 'DEBIT',
            type: 'PAYOUT_PAID',
            amountMinor: payout.amountMinor,
            idempotencyKey: `payout:${payout._id}`,
          });
          await entry.save({ session });
          payout.status = 'PAID';
          payout.externalReference = input.externalReference;
          payout.paidAt = new Date();
        } else {
          payout.status = input.status;
          payout.reason = input.reason;
          if (input.status === 'FAILED') payout.failedAt = new Date();
          else payout.cancelledAt = new Date();
        }
        payout.terminalIdempotencyKey = input.idempotencyKey;
        await payout.save({ session });
        await this.store.recordAudit(
          `AFFILIATE_PAYOUT_${input.status}`,
          auth,
          payout.toObject(),
          requestId,
          session,
        );
        return affiliatePayoutView(payout.toObject());
      });
    } catch (error) {
      if (
        !isNamedDuplicateKey(
          error,
          INDEX_NAMES.affiliatePayoutTerminalIdempotency,
        ) &&
        !isNamedDuplicateKey(error, INDEX_NAMES.affiliateLedgerIdempotency)
      ) {
        throw error;
      }
      const replay = await this.database.models.affiliatePayout
        .findOne({
          _id: payoutId,
          tenantId: auth.tenant.id,
          affiliateCustomerId: customerId,
        })
        .lean()
        .exec();
      if (replay) return this.terminalReplay(replay, input);
      throw payoutConflict();
    }
  }

  private createReplay(
    payout: AffiliatePayoutEntity,
    customerId: string,
    dto: CreateAffiliatePayoutDto,
    externalReference?: string,
  ): AffiliatePayoutView {
    if (
      payout.affiliateCustomerId !== customerId ||
      payout.currency !== dto.currency ||
      payout.amountMinor !== dto.amountMinor ||
      payout.createExternalReference !== externalReference
    ) {
      throw payoutConflict();
    }
    return affiliatePayoutView(payout);
  }

  private terminalReplay(
    payout: AffiliatePayoutEntity,
    input: TerminalInput,
  ): AffiliatePayoutView {
    const exact =
      payout.status === input.status &&
      payout.terminalIdempotencyKey === input.idempotencyKey &&
      (input.status === 'PAID'
        ? payout.externalReference === input.externalReference
        : payout.reason === input.reason);
    if (!exact) throw payoutConflict();
    return affiliatePayoutView(payout);
  }
}
