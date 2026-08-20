import { RequestWithId } from '../common/request-id.middleware';

export const TENANT_ROLES = ['OWNER', 'MANAGER', 'AGENT', 'STAFF'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const INTERNAL_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] as const;
export type InternalRole = (typeof INTERNAL_ROLES)[number];

export type ActorType = 'TENANT' | 'INTERNAL';

interface BaseAuthContext {
  userId: string;
  email?: string;
  phone?: string;
  displayName: string;
}

export interface TenantAuthContext extends BaseAuthContext {
  actorType: 'TENANT';
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  tenantRole: TenantRole;
}

export interface InternalAuthContext extends BaseAuthContext {
  actorType: 'INTERNAL';
  internalRole: InternalRole;
}

export type AuthContext = TenantAuthContext | InternalAuthContext;

export interface AuthenticatedRequest extends RequestWithId {
  auth: AuthContext;
}

export type AuthorityPolicy =
  | { type: 'authenticated' }
  | { type: 'tenant'; roles: readonly TenantRole[] }
  | { type: 'internal'; roles: readonly InternalRole[] };
