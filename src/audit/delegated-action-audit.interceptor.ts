import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { concatMap, Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AuditService } from './audit.service';

@Injectable()
export class DelegatedActionAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const auth = request.auth;
    if (auth?.actorType === 'DELEGATED') {
      await this.audit.record({
        tenantId: auth.tenant.id,
        actorUserId: auth.userId,
        actorType: 'INTERNAL_USER',
        action: 'DELEGATED_ACTION_ATTEMPTED',
        entityType: 'delegated_session',
        entityId: auth.delegatedSession.id,
        reason: auth.delegatedSession.reason,
        requestId: request.requestId,
        metadata: {
          sessionId: auth.delegatedSession.id,
          method: request.method.toUpperCase().slice(0, 16),
          path: requestPath(request),
        },
      });
      return next.handle().pipe(
        concatMap(async (value: unknown): Promise<unknown> => {
          await this.audit.record({
            tenantId: auth.tenant.id,
            actorUserId: auth.userId,
            actorType: 'INTERNAL_USER',
            action: 'DELEGATED_ACTION_COMPLETED',
            entityType: 'delegated_session',
            entityId: auth.delegatedSession.id,
            reason: auth.delegatedSession.reason,
            requestId: request.requestId,
            metadata: {
              sessionId: auth.delegatedSession.id,
              method: request.method.toUpperCase().slice(0, 16),
              path: requestPath(request),
              statusCode: response.statusCode,
            },
          });
          return value;
        }),
      );
    }
    return next.handle();
  }
}

function requestPath(request: AuthenticatedRequest): string {
  const route = request.route as { path?: unknown } | undefined;
  const candidate =
    typeof route?.path === 'string' ? route.path : request.path.split('?')[0];
  return candidate.replace(/[^A-Za-z0-9_:/.*-]/g, '').slice(0, 300);
}
