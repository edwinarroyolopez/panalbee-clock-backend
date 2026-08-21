import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import type {
  DelegatedSessionEntity,
  DelegatedSessionStatus,
} from '../database/models';

@Injectable()
export class DelegatedSessionLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  recordStarted(
    delegatedSession: DelegatedSessionEntity,
    accountId: string,
    actorUserId: string,
    requestId: string,
    mongoSession: ClientSession,
  ): Promise<void> {
    return this.recordLifecycle(
      delegatedSession,
      accountId,
      actorUserId,
      'DELEGATED_SESSION_STARTED',
      'ACTIVE',
      requestId,
      mongoSession,
    );
  }

  async materializeExpiry(
    sessionId: string,
    requestId?: string,
  ): Promise<void> {
    await this.database.withTransaction(async (mongoSession) => {
      const delegatedSession = await this.database.models.delegatedSession
        .findOne({
          _id: sessionId,
          status: 'ACTIVE',
          expiresAt: { $lte: new Date() },
        })
        .session(mongoSession)
        .lean()
        .exec();
      if (!delegatedSession) return;
      await this.endActive(
        delegatedSession,
        'EXPIRED',
        delegatedSession.platformAdminId,
        requestId,
        mongoSession,
      );
    });
  }

  async endActive(
    delegatedSession: DelegatedSessionEntity,
    status: Extract<DelegatedSessionStatus, 'EXPIRED' | 'REVOKED'>,
    actorUserId: string,
    requestId: string | undefined,
    mongoSession: ClientSession,
  ): Promise<void> {
    const account = await this.database.models.account
      .findOne({ tenantId: delegatedSession.targetTenantId })
      .session(mongoSession)
      .lean()
      .exec();
    if (!account) throw accountUnavailable();
    const update = await this.database.models.delegatedSession.updateOne(
      { _id: delegatedSession._id, status: 'ACTIVE' },
      {
        $set: {
          status,
          ...(status === 'REVOKED'
            ? { revokedAt: new Date(), revokedBy: actorUserId }
            : {}),
        },
      },
      { runValidators: true, session: mongoSession },
    );
    if (update.modifiedCount !== 1) return;
    await this.recordLifecycle(
      delegatedSession,
      account._id,
      actorUserId,
      'DELEGATED_SESSION_ENDED',
      status,
      requestId,
      mongoSession,
    );
  }

  private recordLifecycle(
    delegatedSession: DelegatedSessionEntity,
    accountId: string,
    actorUserId: string,
    action: 'DELEGATED_SESSION_STARTED' | 'DELEGATED_SESSION_ENDED',
    status: DelegatedSessionStatus,
    requestId: string | undefined,
    mongoSession: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        tenantId: delegatedSession.targetTenantId,
        actorUserId,
        actorType: 'INTERNAL_USER',
        action,
        entityType: 'account',
        entityId: accountId,
        reason: delegatedSession.reason,
        ...(requestId ? { requestId } : {}),
        metadata: {
          sessionId: delegatedSession._id,
          status,
          expiry: delegatedSession.expiresAt.toISOString(),
        },
      },
      mongoSession,
    );
  }
}

export function accountUnavailable(): AppException {
  return new AppException(
    404,
    'ACCOUNT_NOT_AVAILABLE',
    'Account is not available for delegated access',
  );
}
