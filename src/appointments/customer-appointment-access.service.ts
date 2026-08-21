import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { INDEX_NAMES, isNamedDuplicateKey } from '../database/models';
import { CustomerAccessDeliveryService } from './customer-access-delivery.service';
import {
  CustomerAccessCodeResult,
  CustomerAccessContext,
  CustomerSessionResult,
} from './customer-appointment-access.types';

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_PHONE_REQUESTS = 5;
const MAX_REQUESTER_REQUESTS = 20;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class CustomerAppointmentAccessService {
  private readonly secret: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly delivery: CustomerAccessDeliveryService,
    private readonly config: ConfigService<Environment, true>,
  ) {
    this.secret = config.get('MANAGEMENT_TOKEN_SECRET', { infer: true });
  }

  async requestCode(
    tenantSlug: string,
    phone: string,
    requesterAddress: string,
  ): Promise<CustomerAccessCodeResult> {
    const tenant = await this.activeTenant(tenantSlug);
    const externalAccountId = await this.delivery.account(tenant._id);
    const phoneHash = this.hmac(`phone:${tenant._id}:${phone}`);
    const requesterHash = this.hmac(
      `requester:${tenant._id}:${requesterAddress}`,
    );
    const now = new Date();
    const windowStart = new Date(now.getTime() - REQUEST_WINDOW_MS);
    const [latest, phoneRequests, requesterRequests] = await Promise.all([
      this.database.models.customerAccessChallenge
        .findOne({ tenantId: tenant._id, phoneHash })
        .sort({ createdAt: -1 })
        .select({ createdAt: 1 })
        .lean()
        .exec(),
      this.database.models.customerAccessChallenge.countDocuments({
        tenantId: tenant._id,
        phoneHash,
        createdAt: { $gt: windowStart },
      }),
      this.database.models.customerAccessChallenge.countDocuments({
        tenantId: tenant._id,
        requesterHash,
        createdAt: { $gt: windowStart },
      }),
    ]);
    if (
      (latest &&
        latest.createdAt.getTime() > now.getTime() - REQUEST_COOLDOWN_MS) ||
      phoneRequests >= MAX_PHONE_REQUESTS ||
      requesterRequests >= MAX_REQUESTER_REQUESTS
    ) {
      return acceptedCode();
    }

    const customer = await this.database.models.customer
      .findOne({ tenantId: tenant._id, phone })
      .select({ _id: 1 })
      .lean()
      .exec();
    const hasAppointments = await this.database.models.appointment
      .exists({
        tenantId: tenant._id,
        customerId: customer?._id ?? randomUUID(),
      })
      .exec();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    try {
      await this.database.models.customerAccessChallenge.create({
        _id: challengeId,
        tenantId: tenant._id,
        phoneHash,
        requestBucket: Math.floor(now.getTime() / REQUEST_COOLDOWN_MS),
        requesterHash,
        ...(customer && hasAppointments ? { customerId: customer._id } : {}),
        codeHash: this.hmac(`code:${challengeId}:${code}`),
        codeExpiresAt: expiresAt,
        expiresAt,
      });
    } catch (error) {
      if (isNamedDuplicateKey(error, INDEX_NAMES.customerAccessPhoneBucket)) {
        return acceptedCode();
      }
      throw error;
    }

    if (!customer || !hasAppointments) return acceptedCode();
    await this.delivery.send(
      tenant._id,
      challengeId,
      externalAccountId,
      phone,
      code,
    );
    return acceptedCode();
  }

  async verifyCode(
    tenantSlug: string,
    phone: string,
    code: string,
  ): Promise<CustomerSessionResult> {
    const tenant = await this.activeTenant(tenantSlug);
    const now = new Date();
    const phoneHash = this.hmac(`phone:${tenant._id}:${phone}`);
    const challenge = await this.database.models.customerAccessChallenge
      .findOneAndUpdate(
        {
          tenantId: tenant._id,
          phoneHash,
          codeExpiresAt: { $gt: now },
          consumedAt: { $exists: false },
          attempts: { $lt: MAX_CODE_ATTEMPTS },
        },
        { $inc: { attempts: 1 } },
        {
          sort: { createdAt: -1 },
          returnDocument: 'after',
          runValidators: true,
        },
      )
      .lean()
      .exec();
    if (
      !challenge ||
      !challenge.customerId ||
      !this.matchesCode(challenge._id, code, challenge.codeHash)
    ) {
      throw invalidCode();
    }

    const accessToken = randomBytes(32).toString('base64url');
    const sessionExpiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const consumed = await this.database.withTransaction(async (session) => {
      const updated = await this.database.models.customerAccessChallenge
        .findOneAndUpdate(
          {
            _id: challenge._id,
            tenantId: tenant._id,
            consumedAt: { $exists: false },
            codeExpiresAt: { $gt: new Date() },
          },
          {
            $set: {
              consumedAt: new Date(),
              sessionTokenHash: tokenHash(accessToken),
              expiresAt: sessionExpiresAt,
            },
          },
          { returnDocument: 'after', runValidators: true, session },
        )
        .lean()
        .exec();
      if (!updated?.customerId) return null;
      await this.database.models.auditEvent.create(
        [
          {
            tenantId: tenant._id,
            actorType: 'CUSTOMER',
            action: 'CUSTOMER_ACCESS_SESSION_STARTED',
            entityType: 'customer',
            entityId: updated.customerId,
            metadata: {
              challengeId: updated._id,
              expiresAt: sessionExpiresAt.toISOString(),
            },
          },
        ],
        { session },
      );
      return updated;
    });
    if (!consumed) throw invalidCode();
    return {
      accessToken,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  async authenticate(
    tenantSlug: string,
    accessToken: string,
  ): Promise<CustomerAccessContext> {
    if (!SESSION_TOKEN_PATTERN.test(accessToken)) throw invalidSession();
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!tenant) throw invalidSession();
    const session = await this.database.models.customerAccessChallenge
      .findOne({
        tenantId: tenant._id,
        sessionTokenHash: tokenHash(accessToken),
        customerId: { $type: 'string' },
        consumedAt: { $type: 'date' },
        expiresAt: { $gt: new Date() },
      })
      .select({ customerId: 1 })
      .lean()
      .exec();
    if (!session?.customerId) throw invalidSession();
    return { tenantId: tenant._id, customerId: session.customerId };
  }

  private async activeTenant(tenantSlug: string) {
    const tenant = await this.database.models.tenant
      .findOne({ slug: tenantSlug, status: 'ACTIVE' })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (!tenant) {
      throw new AppException(
        404,
        'PUBLIC_ACCOUNT_UNAVAILABLE',
        'Public account is unavailable',
      );
    }
    return tenant;
  }

  private matchesCode(
    challengeId: string,
    code: string,
    expectedHash: string,
  ): boolean {
    const actual = Buffer.from(this.hmac(`code:${challengeId}:${code}`), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
}

function acceptedCode(): CustomerAccessCodeResult {
  return { accepted: true, expiresInSeconds: CODE_TTL_MS / 1000 };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invalidCode(): AppException {
  return new AppException(
    401,
    'CUSTOMER_ACCESS_CODE_INVALID',
    'Verification code is invalid or expired',
  );
}

function invalidSession(): AppException {
  return new AppException(
    401,
    'CUSTOMER_SESSION_INVALID',
    'Customer session is invalid or expired',
  );
}
