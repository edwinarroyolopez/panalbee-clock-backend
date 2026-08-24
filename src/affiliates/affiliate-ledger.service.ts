import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  AffiliateLedgerEntryEntity,
  INDEX_NAMES,
  isNamedDuplicateKey,
} from '../database/models';

export interface AffiliateBalanceView {
  currency: string;
  balanceMinor: number;
}

@Injectable()
export class AffiliateLedgerService {
  constructor(private readonly database: DatabaseService) {}

  async earnCompletedCommission(
    tenantId: string,
    appointmentId: string,
    session: ClientSession,
  ): Promise<void> {
    const conversion = await this.database.models.referralConversion
      .findOne({ tenantId, appointmentId })
      .session(session)
      .lean()
      .exec();
    if (!conversion) return;
    await this.database.models.affiliatePayoutCapacityLock
      .findOneAndUpdate(
        {
          tenantId,
          affiliateCustomerId: conversion.affiliateCustomerId,
        },
        {
          $setOnInsert: {
            tenantId,
            affiliateCustomerId: conversion.affiliateCustomerId,
          },
        },
        { upsert: true, session },
      )
      .exec();
    await this.database.models.affiliateBalanceLock
      .findOneAndUpdate(
        {
          tenantId,
          affiliateCustomerId: conversion.affiliateCustomerId,
          currency: conversion.currency,
        },
        {
          $setOnInsert: {
            tenantId,
            affiliateCustomerId: conversion.affiliateCustomerId,
            currency: conversion.currency,
          },
        },
        { upsert: true, session },
      )
      .exec();
    const entry = new this.database.models.affiliateLedgerEntry({
      tenantId,
      affiliateCustomerId: conversion.affiliateCustomerId,
      conversionId: conversion._id,
      appointmentId,
      currency: conversion.currency,
      direction: 'CREDIT',
      type: 'COMMISSION_EARNED',
      amountMinor: conversion.commissionValueMinor,
      idempotencyKey: `commission:${conversion._id}`,
    });
    await entry.save({ session });
  }

  async reverseCommission(
    tenantId: string,
    entryId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<AffiliateLedgerEntryEntity> {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 6 || normalizedReason.length > 500) {
      throw new AppException(
        400,
        'AFFILIATE_REVERSAL_REASON_INVALID',
        'Reversal reason must contain between 6 and 500 characters',
      );
    }
    try {
      return await this.database.withTransaction(async (session) => {
        const original = await this.database.models.affiliateLedgerEntry
          .findOne({
            _id: entryId,
            tenantId,
            direction: 'CREDIT',
            type: 'COMMISSION_EARNED',
          })
          .session(session)
          .lean()
          .exec();
        if (!original) {
          throw new AppException(
            404,
            'AFFILIATE_COMMISSION_NOT_FOUND',
            'Commission entry was not found',
          );
        }
        const existing = await this.database.models.affiliateLedgerEntry
          .findOne({
            tenantId,
            $or: [{ reversalOfEntryId: entryId }, { idempotencyKey }],
          })
          .session(session)
          .lean()
          .exec();
        if (existing) {
          if (
            existing.reversalOfEntryId === entryId &&
            existing.idempotencyKey === idempotencyKey
          ) {
            return existing;
          }
          throw alreadyReversed();
        }
        const lock = await this.database.models.affiliateBalanceLock
          .findOneAndUpdate(
            {
              tenantId,
              affiliateCustomerId: original.affiliateCustomerId,
              currency: original.currency,
            },
            { $inc: { version: 1 } },
            { returnDocument: 'after', session },
          )
          .lean()
          .exec();
        if (!lock) throw insufficientAvailableBalance();
        const balances = await this.balances(
          tenantId,
          original.affiliateCustomerId,
          session,
        );
        const reservations = await this.database.models.affiliatePayout
          .aggregate<{ _id: null; total: number }>([
            {
              $match: {
                tenantId,
                affiliateCustomerId: original.affiliateCustomerId,
                currency: original.currency,
                status: 'PROCESSING',
              },
            },
            { $group: { _id: null, total: { $sum: '$amountMinor' } } },
          ])
          .session(session)
          .exec();
        const balance =
          balances.find(({ currency }) => currency === original.currency)
            ?.balanceMinor ?? 0;
        if (balance - (reservations[0]?.total ?? 0) < original.amountMinor) {
          throw insufficientAvailableBalance();
        }
        const reversal = new this.database.models.affiliateLedgerEntry({
          tenantId,
          affiliateCustomerId: original.affiliateCustomerId,
          ...(original.conversionId
            ? { conversionId: original.conversionId }
            : {}),
          ...(original.appointmentId
            ? { appointmentId: original.appointmentId }
            : {}),
          currency: original.currency,
          direction: 'DEBIT',
          type: 'COMMISSION_REVERSAL',
          amountMinor: original.amountMinor,
          idempotencyKey,
          reversalOfEntryId: original._id,
          reason: normalizedReason,
        });
        await reversal.save({ session });
        return reversal.toObject();
      });
    } catch (error) {
      if (
        !isNamedDuplicateKey(error, INDEX_NAMES.affiliateLedgerIdempotency) &&
        !isNamedDuplicateKey(error, INDEX_NAMES.affiliateLedgerReversal)
      ) {
        throw error;
      }
      const replay = await this.database.models.affiliateLedgerEntry
        .findOne({
          tenantId,
          $or: [{ reversalOfEntryId: entryId }, { idempotencyKey }],
        })
        .lean()
        .exec();
      if (
        replay?.reversalOfEntryId === entryId &&
        replay.idempotencyKey === idempotencyKey
      ) {
        return replay;
      }
      throw alreadyReversed();
    }
  }

  async balances(
    tenantId: string,
    affiliateCustomerId: string,
    session?: ClientSession,
  ): Promise<AffiliateBalanceView[]> {
    const aggregate = this.database.models.affiliateLedgerEntry.aggregate<{
      _id: string;
      balanceMinor: number;
    }>([
      { $match: { tenantId, affiliateCustomerId } },
      {
        $group: {
          _id: '$currency',
          balanceMinor: {
            $sum: {
              $cond: [
                { $eq: ['$direction', 'CREDIT'] },
                '$amountMinor',
                { $multiply: ['$amountMinor', -1] },
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    if (session) aggregate.session(session);
    const rows = await aggregate.exec();
    return rows.map(({ _id, balanceMinor }) => ({
      currency: _id,
      balanceMinor,
    }));
  }
}

function insufficientAvailableBalance(): AppException {
  return new AppException(
    409,
    'AFFILIATE_COMMISSION_INSUFFICIENT_AVAILABLE',
    'Commission cannot be reversed while its value is reserved or paid out',
  );
}

function alreadyReversed(): AppException {
  return new AppException(
    409,
    'AFFILIATE_COMMISSION_ALREADY_REVERSED',
    'Commission already has a reversal or idempotency key conflict',
  );
}
