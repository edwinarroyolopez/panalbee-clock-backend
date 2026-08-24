import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import type { TenantOperationAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import { INDEX_NAMES, isNamedDuplicateKey } from '../database/models';
import { AffiliateTermsDto, CreateAffiliateCodeDto } from './affiliate.dto';
import {
  normalizeAffiliateCode,
  normalizeAffiliateTerms,
} from './affiliate-economics';
import { affiliateCodeView, AffiliateCodeView } from './affiliate.view';

const GENERATED_CODE_ATTEMPTS = 8;

@Injectable()
export class AffiliateCodeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: string,
    customerId: string,
    options: { session?: ClientSession; limit?: number } = {},
  ): Promise<AffiliateCodeView[]> {
    await this.assertCustomer(tenantId, customerId, options.session);
    const query = this.database.models.affiliateCode
      .find({ tenantId, customerId })
      .sort({ createdAt: -1, _id: -1 })
      .session(options.session ?? null)
      .lean();
    if (options.limit !== undefined) query.limit(options.limit);
    const codes = await query.exec();
    return codes.map(affiliateCodeView);
  }

  async create(
    auth: TenantOperationAuthContext,
    customerId: string,
    dto: CreateAffiliateCodeDto,
  ): Promise<AffiliateCodeView> {
    const terms = normalizeAffiliateTerms(dto);
    const customCode = dto.code ? normalizeAffiliateCode(dto.code) : undefined;
    const attempts = customCode ? 1 : GENERATED_CODE_ATTEMPTS;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const normalizedCode = customCode ?? generatedAffiliateCode();
      try {
        return await this.database.withTransaction(async (session) => {
          await this.assertCustomer(auth.tenant.id, customerId, session);
          const code = new this.database.models.affiliateCode({
            tenantId: auth.tenant.id,
            customerId,
            code: normalizedCode,
            normalizedCode,
            status: 'ACTIVE',
            currentSlot: 'CURRENT',
            ...terms,
          });
          await code.save({ session });
          await this.audit.record(
            {
              tenantId: auth.tenant.id,
              actorUserId: auth.userId,
              actorType:
                auth.actorType === 'DELEGATED'
                  ? 'INTERNAL_USER'
                  : 'TENANT_USER',
              action: 'AFFILIATE_CODE_CREATED',
              entityType: 'AffiliateCode',
              entityId: code._id,
              metadata: { customerId, generated: !customCode },
            },
            session,
          );
          return affiliateCodeView(code.toObject());
        });
      } catch (error) {
        if (isNamedDuplicateKey(error, INDEX_NAMES.affiliateCodeText)) {
          if (!customCode && attempt + 1 < attempts) continue;
          throw new AppException(
            409,
            'AFFILIATE_CODE_CONFLICT',
            'Affiliate code is already in use',
          );
        }
        if (
          isNamedDuplicateKey(error, INDEX_NAMES.affiliateCodeCurrentCustomer)
        ) {
          throw new AppException(
            409,
            'AFFILIATE_CODE_CURRENT_EXISTS',
            'Customer already has a current affiliate code',
          );
        }
        throw error;
      }
    }
    throw new AppException(
      503,
      'AFFILIATE_CODE_GENERATION_EXHAUSTED',
      'Affiliate code could not be generated',
    );
  }

  async updateTerms(
    auth: TenantOperationAuthContext,
    customerId: string,
    codeId: string,
    dto: AffiliateTermsDto,
  ): Promise<AffiliateCodeView> {
    const terms = normalizeAffiliateTerms(dto);
    return this.mutate(
      auth,
      customerId,
      codeId,
      'AFFILIATE_CODE_TERMS_UPDATED',
      (code) => {
        if (code.status === 'RETIRED') {
          throw affiliateStateError('AFFILIATE_CODE_RETIRED');
        }
        code.set({
          discountBasisPoints: undefined,
          discountAmountMinor: undefined,
          discountCurrency: undefined,
          commissionBasisPoints: undefined,
          commissionAmountMinor: undefined,
          commissionCurrency: undefined,
          startsAt: undefined,
          expiresAt: undefined,
          ...terms,
        });
      },
    );
  }

  activate(
    auth: TenantOperationAuthContext,
    customerId: string,
    codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.mutate(
      auth,
      customerId,
      codeId,
      'AFFILIATE_CODE_ACTIVATED',
      (code) => {
        if (code.status !== 'INACTIVE') {
          throw affiliateStateError('AFFILIATE_CODE_NOT_INACTIVE');
        }
        code.status = 'ACTIVE';
        code.reactivatedAt = new Date();
      },
    );
  }

  deactivate(
    auth: TenantOperationAuthContext,
    customerId: string,
    codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.mutate(
      auth,
      customerId,
      codeId,
      'AFFILIATE_CODE_DEACTIVATED',
      (code) => {
        if (code.status !== 'ACTIVE') {
          throw affiliateStateError('AFFILIATE_CODE_NOT_ACTIVE');
        }
        code.status = 'INACTIVE';
        code.deactivatedAt = new Date();
      },
    );
  }

  retire(
    auth: TenantOperationAuthContext,
    customerId: string,
    codeId: string,
  ): Promise<AffiliateCodeView> {
    return this.mutate(
      auth,
      customerId,
      codeId,
      'AFFILIATE_CODE_RETIRED',
      (code) => {
        if (code.status === 'RETIRED') {
          throw affiliateStateError('AFFILIATE_CODE_RETIRED');
        }
        code.status = 'RETIRED';
        code.currentSlot = undefined;
        code.retiredAt = new Date();
      },
    );
  }

  private async mutate(
    auth: TenantOperationAuthContext,
    customerId: string,
    codeId: string,
    action: string,
    change: (
      code: InstanceType<typeof this.database.models.affiliateCode>,
    ) => void,
  ): Promise<AffiliateCodeView> {
    return this.database.withTransaction(async (session) => {
      const code = await this.database.models.affiliateCode
        .findOne({ _id: codeId, tenantId: auth.tenant.id, customerId })
        .session(session)
        .exec();
      if (!code) throw affiliateNotFound();
      change(code);
      await code.save({ session });
      await this.audit.record(
        {
          tenantId: auth.tenant.id,
          actorUserId: auth.userId,
          actorType:
            auth.actorType === 'DELEGATED' ? 'INTERNAL_USER' : 'TENANT_USER',
          action,
          entityType: 'AffiliateCode',
          entityId: code._id,
          metadata: { customerId },
        },
        session,
      );
      return affiliateCodeView(code.toObject());
    });
  }

  private async assertCustomer(
    tenantId: string,
    customerId: string,
    session?: ClientSession,
  ): Promise<void> {
    const exists = await this.database.models.customer
      .exists({
        _id: customerId,
        tenantId,
      })
      .session(session ?? null);
    if (!exists) {
      throw new AppException(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
  }
}

function generatedAffiliateCode(): string {
  return `PB-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function affiliateNotFound(): AppException {
  return new AppException(404, 'AFFILIATE_CODE_NOT_FOUND', 'Code not found');
}

function affiliateStateError(reasonCode: string): AppException {
  return new AppException(409, reasonCode, 'Affiliate code state is invalid');
}
