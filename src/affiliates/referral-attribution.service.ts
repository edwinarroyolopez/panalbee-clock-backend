import { Injectable } from '@nestjs/common';
import type { ClientSession } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import type { ServiceEntity } from '../database/models';
import { referralError } from './affiliate-economics';
import type { ReferralReceiptView } from './affiliate.view';
import { ReferralService, ResolvedReferral } from './referral.service';

@Injectable()
export class ReferralAttributionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly referrals: ReferralService,
  ) {}

  async prepare(
    tenantId: string,
    rawCode: string,
    referredCustomerId: string,
    service: ServiceEntity,
    session: ClientSession,
  ): Promise<ResolvedReferral> {
    const resolved = await this.referrals.resolveForBooking(
      tenantId,
      rawCode,
      service,
      session,
    );
    if (resolved.code.customerId === referredCustomerId) {
      throw referralError('REFERRAL_SELF_REFERRAL');
    }
    return resolved;
  }

  async record(
    tenantId: string,
    appointmentId: string,
    referredCustomerId: string,
    serviceId: string,
    resolved: ResolvedReferral,
    session: ClientSession,
  ): Promise<ReferralReceiptView> {
    const { code, economics } = resolved;
    const conversion = new this.database.models.referralConversion({
      tenantId,
      affiliateCodeId: code._id,
      affiliateCustomerId: code.customerId,
      referredCustomerId,
      appointmentId,
      serviceId,
      codeSnapshot: code.normalizedCode,
      grossAmountMinor: economics.grossAmountMinor,
      discountType: code.discountType,
      ...(code.discountBasisPoints
        ? { discountBasisPoints: code.discountBasisPoints }
        : {}),
      ...(code.discountAmountMinor
        ? { discountAmountMinor: code.discountAmountMinor }
        : {}),
      ...(code.discountCurrency
        ? { discountCurrency: code.discountCurrency }
        : {}),
      discountValueMinor: economics.discountValueMinor,
      finalAmountMinor: economics.finalAmountMinor,
      currency: economics.currency,
      commissionType: code.commissionType,
      ...(code.commissionBasisPoints
        ? { commissionBasisPoints: code.commissionBasisPoints }
        : {}),
      ...(code.commissionAmountMinor
        ? { commissionAmountMinor: code.commissionAmountMinor }
        : {}),
      ...(code.commissionCurrency
        ? { commissionCurrency: code.commissionCurrency }
        : {}),
      commissionValueMinor: economics.commissionValueMinor,
      commissionBase: code.commissionBase,
      source: 'PUBLIC_BOOKING',
    });
    await conversion.save({ session });
    return referralReceipt(conversion.toObject());
  }

  async findReceipt(
    tenantId: string,
    appointmentId: string,
    session?: ClientSession,
  ): Promise<ReferralReceiptView | undefined> {
    const conversion = await this.database.models.referralConversion
      .findOne({ tenantId, appointmentId })
      .session(session ?? null)
      .lean()
      .exec();
    return conversion ? referralReceipt(conversion) : undefined;
  }
}

function referralReceipt(conversion: {
  codeSnapshot: string;
  grossAmountMinor: number;
  discountValueMinor: number;
  finalAmountMinor: number;
  currency: string;
}): ReferralReceiptView {
  return {
    code: conversion.codeSnapshot,
    grossAmountMinor: conversion.grossAmountMinor,
    discountAmountMinor: conversion.discountValueMinor,
    finalAmountMinor: conversion.finalAmountMinor,
    currency: conversion.currency,
  };
}
