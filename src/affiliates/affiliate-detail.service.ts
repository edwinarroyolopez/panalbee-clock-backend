import { Injectable } from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { DatabaseService } from '../database/database.service';
import type {
  AffiliateLedgerEntryEntity,
  AppointmentEntity,
  CustomerEntity,
  ReferralConversionEntity,
  ServiceEntity,
} from '../database/models';
import { AffiliateCodeService } from './affiliate-code.service';
import type {
  AffiliateActivityView,
  AffiliateDetailView,
} from './affiliate-detail.view';
import { affiliatePayoutView } from './affiliate-detail.view';
import { MAX_PROCESSING_AFFILIATE_PAYOUTS } from './affiliate-payout.policy';
import {
  affiliateBalanceViews,
  type ExpectedBalanceRow,
  type LedgerBalanceRow,
  type ReservedBalanceRow,
} from './affiliate-balance.view';

const HISTORY_LIMIT = 100;
const OPEN_APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'];

@Injectable()
export class AffiliateDetailService {
  constructor(
    private readonly database: DatabaseService,
    private readonly customers: CustomersService,
    private readonly codes: AffiliateCodeService,
  ) {}

  async get(
    tenantId: string,
    customerId: string,
  ): Promise<AffiliateDetailView> {
    return this.database.withTransaction(async (session) => {
      const customer = await this.customers.get(tenantId, customerId, session);
      const codeHistory = await this.codes.list(tenantId, customerId, {
        session,
        limit: HISTORY_LIMIT + 1,
      });
      const conversionHistory = await this.database.models.referralConversion
        .find({ tenantId, affiliateCustomerId: customerId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(HISTORY_LIMIT + 1)
        .session(session)
        .lean()
        .exec();
      const processingPayouts = await this.database.models.affiliatePayout
        .find({
          tenantId,
          affiliateCustomerId: customerId,
          status: 'PROCESSING',
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_PROCESSING_AFFILIATE_PAYOUTS + 1)
        .session(session)
        .lean()
        .exec();
      const terminalLimit = Math.max(
        HISTORY_LIMIT - processingPayouts.length,
        0,
      );
      const terminalPayouts = await this.database.models.affiliatePayout
        .find({
          tenantId,
          affiliateCustomerId: customerId,
          status: { $ne: 'PROCESSING' },
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(terminalLimit + 1)
        .session(session)
        .lean()
        .exec();
      const expectedBalances = await this.database.models.referralConversion
        .aggregate<ExpectedBalanceRow>([
          { $match: { tenantId, affiliateCustomerId: customerId } },
          {
            $lookup: {
              from: this.database.models.appointment.collection.name,
              localField: 'appointmentId',
              foreignField: '_id',
              as: 'appointment',
            },
          },
          { $unwind: '$appointment' },
          {
            $match: {
              'appointment.tenantId': tenantId,
              'appointment.status': { $in: OPEN_APPOINTMENT_STATUSES },
            },
          },
          {
            $group: {
              _id: '$currency',
              expectedMinor: { $sum: '$commissionValueMinor' },
            },
          },
        ])
        .session(session)
        .exec();
      const ledgerBalances = await this.database.models.affiliateLedgerEntry
        .aggregate<LedgerBalanceRow>([
          { $match: { tenantId, affiliateCustomerId: customerId } },
          {
            $group: {
              _id: '$currency',
              creditsMinor: {
                $sum: {
                  $cond: [
                    { $eq: ['$type', 'COMMISSION_EARNED'] },
                    '$amountMinor',
                    0,
                  ],
                },
              },
              reversalsMinor: {
                $sum: {
                  $cond: [
                    { $eq: ['$type', 'COMMISSION_REVERSAL'] },
                    '$amountMinor',
                    0,
                  ],
                },
              },
              paidMinor: {
                $sum: {
                  $cond: [{ $eq: ['$type', 'PAYOUT_PAID'] }, '$amountMinor', 0],
                },
              },
            },
          },
        ])
        .session(session)
        .exec();
      const reservedBalances = await this.database.models.affiliatePayout
        .aggregate<ReservedBalanceRow>([
          {
            $match: {
              tenantId,
              affiliateCustomerId: customerId,
              status: 'PROCESSING',
            },
          },
          {
            $group: {
              _id: '$currency',
              reservedMinor: { $sum: '$amountMinor' },
            },
          },
        ])
        .session(session)
        .exec();
      const conversions = conversionHistory.slice(0, HISTORY_LIMIT);
      const payouts = [
        ...processingPayouts.slice(0, HISTORY_LIMIT),
        ...terminalPayouts.slice(0, terminalLimit),
      ].sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right._id.localeCompare(left._id),
      );
      const appointmentIds = conversions.map(
        ({ appointmentId }) => appointmentId,
      );
      const serviceIds = conversions.map(({ serviceId }) => serviceId);
      const referredIds = conversions.map(
        ({ referredCustomerId }) => referredCustomerId,
      );
      const conversionIds = conversions.map(({ _id }) => _id);
      const appointments = await this.database.models.appointment
        .find({ tenantId, _id: { $in: appointmentIds } })
        .session(session)
        .lean()
        .exec();
      const services = await this.database.models.service
        .find({ tenantId, _id: { $in: serviceIds } })
        .session(session)
        .lean()
        .exec();
      const referredCustomers = await this.database.models.customer
        .find({ tenantId, _id: { $in: referredIds } })
        .session(session)
        .lean()
        .exec();
      const activityLedger = await this.database.models.affiliateLedgerEntry
        .find({
          tenantId,
          affiliateCustomerId: customerId,
          conversionId: { $in: conversionIds },
          type: { $in: ['COMMISSION_EARNED', 'COMMISSION_REVERSAL'] },
        })
        .sort({ createdAt: -1, _id: -1 })
        .session(session)
        .lean()
        .exec();

      return {
        customer,
        codes: codeHistory.slice(0, HISTORY_LIMIT),
        balances: affiliateBalanceViews(
          expectedBalances,
          ledgerBalances,
          reservedBalances,
        ),
        activity: activityViews(
          conversions,
          appointments,
          services,
          referredCustomers,
          activityLedger,
        ),
        payouts: payouts.map(affiliatePayoutView),
        history: {
          limit: HISTORY_LIMIT,
          codesTruncated: codeHistory.length > HISTORY_LIMIT,
          activityTruncated: conversionHistory.length > HISTORY_LIMIT,
          payoutsTruncated:
            processingPayouts.length > HISTORY_LIMIT ||
            terminalPayouts.length > terminalLimit,
        },
      };
    });
  }
}

function activityViews(
  conversions: ReferralConversionEntity[],
  appointments: AppointmentEntity[],
  services: ServiceEntity[],
  customers: CustomerEntity[],
  ledger: AffiliateLedgerEntryEntity[],
): AffiliateActivityView[] {
  const appointmentById = new Map(appointments.map((item) => [item._id, item]));
  const serviceById = new Map(services.map((item) => [item._id, item]));
  const customerById = new Map(customers.map((item) => [item._id, item]));
  const ledgerByConversion = new Map<string, AffiliateLedgerEntryEntity[]>();
  for (const entry of ledger) {
    if (!entry.conversionId) continue;
    const entries = ledgerByConversion.get(entry.conversionId) ?? [];
    entries.push(entry);
    ledgerByConversion.set(entry.conversionId, entries);
  }
  return conversions.flatMap((conversion) => {
    const appointment = appointmentById.get(conversion.appointmentId);
    const service = serviceById.get(conversion.serviceId);
    const customer = customerById.get(conversion.referredCustomerId);
    if (!appointment || !service || !customer) return [];
    const entries = ledgerByConversion.get(conversion._id) ?? [];
    return [
      {
        id: conversion._id,
        createdAt: conversion.createdAt.toISOString(),
        code: conversion.codeSnapshot,
        state: activityState(appointment, entries),
        appointment: {
          id: appointment._id,
          status: appointment.status,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
        },
        service: { id: service._id, name: service.name },
        referredCustomer: { id: customer._id, fullName: customer.fullName },
        economics: {
          grossAmountMinor: conversion.grossAmountMinor,
          discountAmountMinor: conversion.discountValueMinor,
          finalAmountMinor: conversion.finalAmountMinor,
          commissionAmountMinor: conversion.commissionValueMinor,
          currency: conversion.currency,
        },
        ledger: entries.map((entry) => ({
          id: entry._id,
          type: entry.type as 'COMMISSION_EARNED' | 'COMMISSION_REVERSAL',
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          createdAt: entry.createdAt.toISOString(),
        })),
      },
    ];
  });
}

function activityState(
  appointment: AppointmentEntity,
  entries: AffiliateLedgerEntryEntity[],
): AffiliateActivityView['state'] {
  if (entries.some(({ type }) => type === 'COMMISSION_REVERSAL')) {
    return 'REVERSED';
  }
  if (entries.some(({ type }) => type === 'COMMISSION_EARNED')) return 'EARNED';
  if (['CANCELLED', 'NO_SHOW'].includes(appointment.status)) {
    return 'NOT_EARNED';
  }
  return 'EXPECTED';
}
