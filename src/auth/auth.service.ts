import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  TenantEntity,
  TenantMembershipEntity,
  UserEntity,
} from '../database/models';
import { LoginDto } from './auth.dto';
import {
  AuthContext,
  InternalAuthContext,
  TenantAuthContext,
} from './auth.types';
import { normalizeLoginPhone } from './login-identity';
import { hashPassword, verifyPassword } from './password';
import { TokenService, VerifiedAccessToken } from './token.service';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: AuthContext;
}

interface ActiveMembership {
  membership: TenantMembershipEntity;
  tenant: TenantEntity;
}

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash = hashPassword(
    'panalbee-clock-dummy-login-password',
  );

  constructor(
    private readonly database: DatabaseService,
    private readonly tokens: TokenService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const email = dto.email?.toLowerCase();
    const phone = dto.phone ? normalizeLoginPhone(dto.phone) : undefined;
    if (Number(Boolean(email)) + Number(Boolean(phone)) !== 1) {
      throw new AppException(
        400,
        'LOGIN_IDENTITY_INVALID',
        'Exactly one login identifier is required',
      );
    }
    const identity = email ? { email } : { phone };
    const user = await this.database.models.user
      .findOne({ ...identity, status: 'ACTIVE' })
      .lean()
      .exec();
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    if (!(await verifyPassword(dto.password, passwordHash)) || !user) {
      throw this.invalidCredentials();
    }

    const context =
      user.actorType === 'INTERNAL'
        ? this.internalLoginContext(user, dto.tenantSlug)
        : await this.tenantLoginContext(user, dto.tenantSlug);
    const accessToken = await this.tokens.issue({
      userId: context.userId,
      actorType: context.actorType,
      ...(context.actorType === 'TENANT'
        ? { tenantId: context.tenant.id }
        : {}),
    });
    return {
      accessToken,
      expiresIn: this.tokens.expiresInSeconds,
      user: context,
    };
  }

  async authenticate(token: string): Promise<AuthContext> {
    const claims = await this.tokens.verify(token);
    return claims.actorType === 'TENANT'
      ? this.authenticateTenant(claims)
      : this.authenticateInternal(claims);
  }

  private internalLoginContext(
    user: UserEntity,
    tenantSlug?: string,
  ): InternalAuthContext {
    if (tenantSlug || !user.internalRole) throw this.invalidCredentials();
    return {
      userId: user._id,
      ...this.identityContext(user),
      displayName: user.displayName,
      actorType: 'INTERNAL',
      internalRole: user.internalRole,
    };
  }

  private async tenantLoginContext(
    user: UserEntity,
    tenantSlug?: string,
  ): Promise<TenantAuthContext> {
    const memberships = await this.activeMemberships(user._id);
    const selected = tenantSlug
      ? memberships.find(({ tenant }) => tenant.slug === tenantSlug)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!tenantSlug && memberships.length > 1) {
      throw new AppException(
        400,
        'TENANT_SELECTION_REQUIRED',
        'A tenant slug is required for this account',
      );
    }
    if (!selected) throw this.invalidCredentials();
    return this.tenantContext(user, selected.membership, selected.tenant);
  }

  private async activeMemberships(userId: string): Promise<ActiveMembership[]> {
    const memberships = await this.database.models.tenantMembership
      .find({ userId })
      .lean()
      .exec();
    const tenantIds = memberships.map(({ tenantId }) => tenantId);
    const tenants = await this.database.models.tenant
      .find({ _id: { $in: tenantIds }, status: 'ACTIVE' })
      .lean()
      .exec();
    const byId = new Map(tenants.map((tenant) => [tenant._id, tenant]));
    return memberships
      .flatMap((membership) => {
        const tenant = byId.get(membership.tenantId);
        return tenant ? [{ membership, tenant }] : [];
      })
      .sort((left, right) => left.tenant.slug.localeCompare(right.tenant.slug));
  }

  private async authenticateTenant(
    claims: VerifiedAccessToken,
  ): Promise<TenantAuthContext> {
    if (!claims.tenantId) throw this.invalidToken();
    const [user, membership, tenant] = await Promise.all([
      this.database.models.user
        .findOne({ _id: claims.userId, actorType: 'TENANT', status: 'ACTIVE' })
        .lean()
        .exec(),
      this.database.models.tenantMembership
        .findOne({ tenantId: claims.tenantId, userId: claims.userId })
        .lean()
        .exec(),
      this.database.models.tenant
        .findOne({ _id: claims.tenantId, status: 'ACTIVE' })
        .lean()
        .exec(),
    ]);
    if (!user || !membership || !tenant) throw this.invalidToken();
    return this.tenantContext(user, membership, tenant);
  }

  private async authenticateInternal(
    claims: VerifiedAccessToken,
  ): Promise<InternalAuthContext> {
    const user = await this.database.models.user
      .findOne({ _id: claims.userId, actorType: 'INTERNAL', status: 'ACTIVE' })
      .lean()
      .exec();
    if (!user?.internalRole) throw this.invalidToken();
    return this.internalLoginContext(user);
  }

  private tenantContext(
    user: UserEntity,
    membership: TenantMembershipEntity,
    tenant: TenantEntity,
  ): TenantAuthContext {
    return {
      userId: user._id,
      ...this.identityContext(user),
      displayName: user.displayName,
      actorType: 'TENANT',
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug },
      tenantRole: membership.role,
    };
  }

  private invalidCredentials(): AppException {
    return new AppException(
      401,
      'INVALID_CREDENTIALS',
      'Login identifier or password is invalid',
    );
  }

  private identityContext(user: UserEntity): {
    email?: string;
    phone?: string;
  } {
    return {
      ...(user.email ? { email: user.email } : {}),
      ...(user.phone ? { phone: user.phone } : {}),
    };
  }

  private invalidToken(): AppException {
    return new AppException(
      401,
      'ACCESS_TOKEN_INVALID',
      'Access token is invalid or expired',
    );
  }
}
