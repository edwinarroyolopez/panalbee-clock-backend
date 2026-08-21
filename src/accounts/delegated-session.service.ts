import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ClientSession } from 'mongoose';
import { validateAuditReason } from '../audit/audit.service';
import type {
  DelegatedAuthContext,
  InternalAuthContext,
} from '../auth/auth.types';
import type { VerifiedAccessToken } from '../auth/token.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import type {
  DelegatedSessionEntity,
  DelegatedSessionStatus,
} from '../database/models';
import { AccountListItemView, accountListItemView } from './account.views';
import {
  accountUnavailable,
  DelegatedSessionLifecycleService,
} from './delegated-session-lifecycle.service';
import {
  delegatedContext,
  invalidDelegatedToken,
  invalidExchangeCode,
  statusResult,
} from './delegated-session.context';
import type { DelegatedOperationalContext } from './delegated-session.context';

const SESSION_TTL_MS = 15 * 60 * 1000;

export interface DelegatedSessionStartResult {
  id: string;
  exchangeCode: string;
  expiresAt: Date;
  account: AccountListItemView;
}

export interface DelegatedSessionExchangeResult {
  context: DelegatedAuthContext;
  expiresAt: Date;
}

export interface DelegatedSessionStatusResult {
  id: string;
  status: DelegatedSessionStatus;
  expiresAt: Date;
}

@Injectable()
export class DelegatedSessionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly lifecycle: DelegatedSessionLifecycleService,
  ) {}

  async start(
    accountId: string,
    reasonInput: string,
    actor: InternalAuthContext,
    requestId: string,
  ): Promise<DelegatedSessionStartResult> {
    const reason = validateAuditReason(reasonInput);
    const exchangeCode = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    return this.database.withTransaction(async (mongoSession) => {
      const admin = await this.database.models.user
        .findOne({
          _id: actor.userId,
          actorType: 'INTERNAL',
          internalRole: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
        })
        .session(mongoSession)
        .lean()
        .exec();
      if (!admin || actor.internalRole !== 'PLATFORM_ADMIN') {
        throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
      }
      const account = await this.database.models.account
        .findOne({ _id: accountId, status: { $in: ['TRIAL', 'ACTIVE'] } })
        .session(mongoSession)
        .lean()
        .exec();
      if (!account) throw accountUnavailable();
      const tenant = await this.database.models.tenant
        .findOne({ _id: account.tenantId, status: 'ACTIVE' })
        .session(mongoSession)
        .lean()
        .exec();
      if (!tenant) throw accountUnavailable();

      const delegatedSession = new this.database.models.delegatedSession({
        platformAdminId: actor.userId,
        targetTenantId: account.tenantId,
        reason,
        expiresAt,
        status: 'ACTIVE',
        exchangeCodeHash: codeHash(exchangeCode),
      });
      await delegatedSession.save({ session: mongoSession });
      await this.lifecycle.recordStarted(
        delegatedSession.toObject(),
        account._id,
        actor.userId,
        requestId,
        mongoSession,
      );
      return {
        id: delegatedSession._id,
        exchangeCode,
        expiresAt,
        account: accountListItemView(account),
      };
    });
  }

  async exchange(rawCode: string): Promise<DelegatedSessionExchangeResult> {
    const now = new Date();
    return this.database.withTransaction(async (mongoSession) => {
      const delegatedSession = await this.database.models.delegatedSession
        .findOneAndUpdate(
          {
            exchangeCodeHash: codeHash(rawCode),
            status: 'ACTIVE',
            expiresAt: { $gt: now },
            exchangedAt: { $exists: false },
          },
          { $set: { exchangedAt: now } },
          {
            returnDocument: 'after',
            runValidators: true,
            session: mongoSession,
          },
        )
        .lean()
        .exec();
      if (!delegatedSession) throw invalidExchangeCode();
      const operational = await this.operationalContext(
        delegatedSession,
        mongoSession,
      );
      if (!operational) throw invalidExchangeCode();
      return {
        context: delegatedContext(delegatedSession, operational),
        expiresAt: delegatedSession.expiresAt,
      };
    });
  }

  async authenticateSession(
    claims: VerifiedAccessToken,
    requestId?: string,
  ): Promise<DelegatedAuthContext> {
    if (!claims.tenantId || !claims.delegatedSessionId)
      throw invalidDelegatedToken();
    const delegatedSession = await this.database.models.delegatedSession
      .findById(claims.delegatedSessionId)
      .lean()
      .exec();
    if (
      !delegatedSession ||
      delegatedSession.platformAdminId !== claims.userId ||
      delegatedSession.targetTenantId !== claims.tenantId ||
      delegatedSession.status !== 'ACTIVE'
    ) {
      throw invalidDelegatedToken();
    }
    if (delegatedSession.expiresAt.getTime() <= Date.now()) {
      await this.lifecycle.materializeExpiry(delegatedSession._id, requestId);
      throw invalidDelegatedToken();
    }
    const operational = await this.operationalContext(delegatedSession);
    if (!operational) throw invalidDelegatedToken();
    return delegatedContext(delegatedSession, operational);
  }

  async revoke(
    sessionId: string,
    actorUserId: string,
    requestId: string,
  ): Promise<DelegatedSessionStatusResult> {
    return this.database.withTransaction(async (mongoSession) => {
      const admin = await this.database.models.user
        .exists({
          _id: actorUserId,
          actorType: 'INTERNAL',
          internalRole: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
        })
        .session(mongoSession)
        .exec();
      if (!admin) {
        throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
      }
      const delegatedSession = await this.database.models.delegatedSession
        .findById(sessionId)
        .session(mongoSession)
        .lean()
        .exec();
      if (!delegatedSession) {
        throw new AppException(
          404,
          'DELEGATED_SESSION_NOT_FOUND',
          'Delegated session not found',
        );
      }
      if (delegatedSession.status !== 'ACTIVE') {
        return statusResult(delegatedSession);
      }
      const status =
        delegatedSession.expiresAt.getTime() <= Date.now()
          ? 'EXPIRED'
          : 'REVOKED';
      await this.lifecycle.endActive(
        delegatedSession,
        status,
        actorUserId,
        requestId,
        mongoSession,
      );
      return { ...statusResult(delegatedSession), status };
    });
  }

  private async operationalContext(
    delegatedSession: DelegatedSessionEntity,
    mongoSession?: ClientSession,
  ): Promise<DelegatedOperationalContext | null> {
    const [user, account, tenant] = await Promise.all([
      this.database.models.user
        .findOne({
          _id: delegatedSession.platformAdminId,
          actorType: 'INTERNAL',
          internalRole: 'PLATFORM_ADMIN',
          status: 'ACTIVE',
        })
        .session(mongoSession ?? null)
        .lean()
        .exec(),
      this.database.models.account
        .findOne({
          tenantId: delegatedSession.targetTenantId,
          status: { $in: ['TRIAL', 'ACTIVE'] },
        })
        .session(mongoSession ?? null)
        .lean()
        .exec(),
      this.database.models.tenant
        .findOne({
          _id: delegatedSession.targetTenantId,
          status: 'ACTIVE',
        })
        .session(mongoSession ?? null)
        .lean()
        .exec(),
    ]);
    return user && account && tenant ? { user, account, tenant } : null;
  }
}

function codeHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
