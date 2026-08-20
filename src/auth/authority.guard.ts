import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../common/app-exception';
import { AUTHORITY_POLICY_KEY, PUBLIC_ROUTE_KEY } from './auth.decorators';
import { AuthenticatedRequest, AuthorityPolicy } from './auth.types';

@Injectable()
export class AuthorityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const policy = this.reflector.getAllAndOverride<AuthorityPolicy>(
      AUTHORITY_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;

    if (policy?.type === 'authenticated') return true;
    if (
      policy?.type === 'tenant' &&
      auth.actorType === 'TENANT' &&
      policy.roles.includes(auth.tenantRole)
    ) {
      return true;
    }
    if (
      policy?.type === 'internal' &&
      auth.actorType === 'INTERNAL' &&
      policy.roles.includes(auth.internalRole)
    ) {
      return true;
    }

    throw new AppException(403, 'INSUFFICIENT_ROLE', 'Access is denied');
  }
}
