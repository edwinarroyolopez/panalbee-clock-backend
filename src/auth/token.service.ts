import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
import { ActorType } from './auth.types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VerifiedAccessToken {
  userId: string;
  actorType: ActorType;
  tenantId?: string;
  delegatedSessionId?: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  readonly expiresInSeconds: number;

  constructor(config: ConfigService<Environment, true>) {
    this.key = new TextEncoder().encode(
      config.get('ACCESS_TOKEN_SECRET', { infer: true }),
    );
    this.issuer = config.get('ACCESS_TOKEN_ISSUER', { infer: true });
    this.audience = config.get('ACCESS_TOKEN_AUDIENCE', { infer: true });
    this.expiresInSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });
  }

  async issue(
    claims: VerifiedAccessToken,
    maximumExpiresAt?: Date,
  ): Promise<string> {
    const { SignJWT } = await import('jose');
    const issuedAt = Math.floor(Date.now() / 1000);
    const defaultExpiry = issuedAt + this.expiresInSeconds;
    const expiration = maximumExpiresAt
      ? Math.min(defaultExpiry, Math.floor(maximumExpiresAt.getTime() / 1000))
      : defaultExpiry;
    if (expiration <= issuedAt) {
      throw new AppException(
        401,
        'ACCESS_TOKEN_INVALID',
        'Access token is invalid or expired',
      );
    }
    return new SignJWT({
      actorType: claims.actorType,
      ...(claims.tenantId ? { tenantId: claims.tenantId } : {}),
      ...(claims.delegatedSessionId
        ? { delegatedSessionId: claims.delegatedSessionId }
        : {}),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiration)
      .sign(this.key);
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
        typ: 'JWT',
        clockTolerance: 5,
      });
      const actorType = payload.actorType;
      const tenantId = payload.tenantId;
      const delegatedSessionId = payload.delegatedSessionId;

      if (
        !payload.sub ||
        !UUID.test(payload.sub) ||
        (actorType !== 'TENANT' &&
          actorType !== 'INTERNAL' &&
          actorType !== 'DELEGATED') ||
        (actorType === 'TENANT' &&
          (typeof tenantId !== 'string' ||
            !UUID.test(tenantId) ||
            delegatedSessionId !== undefined)) ||
        (actorType === 'INTERNAL' &&
          (tenantId !== undefined || delegatedSessionId !== undefined)) ||
        (actorType === 'DELEGATED' &&
          (typeof tenantId !== 'string' ||
            !UUID.test(tenantId) ||
            typeof delegatedSessionId !== 'string' ||
            !UUID.test(delegatedSessionId)))
      ) {
        throw new Error('Invalid claims');
      }

      return {
        userId: payload.sub,
        actorType,
        ...(typeof tenantId === 'string' ? { tenantId } : {}),
        ...(typeof delegatedSessionId === 'string'
          ? { delegatedSessionId }
          : {}),
      };
    } catch {
      throw new AppException(
        401,
        'ACCESS_TOKEN_INVALID',
        'Access token is invalid or expired',
      );
    }
  }
}
