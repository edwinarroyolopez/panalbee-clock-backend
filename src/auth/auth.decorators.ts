import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import {
  AuthContext,
  AuthenticatedRequest,
  AuthorityPolicy,
  InternalRole,
  TenantRole,
} from './auth.types';

export const PUBLIC_ROUTE_KEY = 'public-route';
export const AUTHORITY_POLICY_KEY = 'authority-policy';

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const Authenticated = () =>
  SetMetadata(AUTHORITY_POLICY_KEY, {
    type: 'authenticated',
  } satisfies AuthorityPolicy);
export const TenantRoles = (...roles: TenantRole[]) =>
  SetMetadata(AUTHORITY_POLICY_KEY, {
    type: 'tenant',
    roles,
  } satisfies AuthorityPolicy);
export const InternalRoles = (...roles: InternalRole[]) =>
  SetMetadata(AUTHORITY_POLICY_KEY, {
    type: 'internal',
    roles,
  } satisfies AuthorityPolicy);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);
