import type { DelegatedAuthContext } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import type {
  AccountEntity,
  DelegatedSessionEntity,
  TenantEntity,
  UserEntity,
} from '../database/models';
import type { DelegatedSessionStatusResult } from './delegated-session.service';

export interface DelegatedOperationalContext {
  user: UserEntity;
  tenant: TenantEntity;
  account: AccountEntity;
}

export function delegatedContext(
  delegatedSession: DelegatedSessionEntity,
  operational: DelegatedOperationalContext,
): DelegatedAuthContext {
  return {
    userId: operational.user._id,
    ...(operational.user.email ? { email: operational.user.email } : {}),
    ...(operational.user.phone ? { phone: operational.user.phone } : {}),
    displayName: operational.user.displayName,
    actorType: 'DELEGATED',
    internalRole: 'PLATFORM_ADMIN',
    tenant: {
      id: operational.tenant._id,
      name: operational.tenant.name,
      slug: operational.tenant.slug,
    },
    tenantRole: 'OWNER',
    effectiveTenantRole: 'OWNER',
    delegatedSession: {
      id: delegatedSession._id,
      reason: delegatedSession.reason,
      expiresAt: delegatedSession.expiresAt,
    },
  };
}

export function statusResult(
  delegatedSession: DelegatedSessionEntity,
): DelegatedSessionStatusResult {
  return {
    id: delegatedSession._id,
    status: delegatedSession.status,
    expiresAt: delegatedSession.expiresAt,
  };
}

export function invalidExchangeCode(): AppException {
  return new AppException(
    401,
    'DELEGATED_SESSION_CODE_INVALID',
    'Delegated session exchange code is invalid or expired',
  );
}

export function invalidDelegatedToken(): AppException {
  return new AppException(
    401,
    'ACCESS_TOKEN_INVALID',
    'Access token is invalid or expired',
  );
}
