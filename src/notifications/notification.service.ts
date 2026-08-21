import { Injectable } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AppException } from '../common/app-exception';
import { DatabaseService } from '../database/database.service';
import {
  INDEX_NAMES,
  isNamedDuplicateKey,
  NotificationEntity,
} from '../database/models';
import {
  CreateNotificationIntent,
  NotificationProcessingSummary,
  NotificationView,
} from './notification.types';
import { NotificationDeliveryService } from './notification-delivery.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  async createIntent(
    input: CreateNotificationIntent,
    session?: ClientSession,
  ): Promise<NotificationView> {
    let notification: NotificationEntity | null;
    try {
      notification = await this.database.models.notification
        .findOneAndUpdate(
          { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
          {
            $setOnInsert: {
              tenantId: input.tenantId,
              appointmentId: input.appointmentId,
              customerId: input.customerId,
              channelId: input.channelId,
              type: input.type,
              scheduledFor: input.scheduledFor,
              idempotencyKey: input.idempotencyKey,
            },
          },
          {
            upsert: true,
            returnDocument: 'after',
            runValidators: true,
            session,
          },
        )
        .lean()
        .exec();
    } catch (error) {
      if (
        session ||
        !isNamedDuplicateKey(error, INDEX_NAMES.notificationIdempotency)
      ) {
        throw error;
      }
      notification = await this.database.models.notification
        .findOne({
          tenantId: input.tenantId,
          idempotencyKey: input.idempotencyKey,
        })
        .lean()
        .exec();
    }
    if (!notification) {
      throw new Error('Notification upsert did not return a document');
    }
    if (!this.sameIntent(notification, input)) {
      throw new AppException(
        409,
        'NOTIFICATION_IDEMPOTENCY_CONFLICT',
        'Notification idempotency key was reused with different input',
      );
    }
    return this.view(notification);
  }

  async processPending(
    limit = 25,
    maxAttempts = 5,
    tenantId?: string,
  ): Promise<NotificationProcessingSummary> {
    const boundedLimit = Math.min(Math.max(limit, 1), 100);
    const boundedAttempts = Math.min(Math.max(maxAttempts, 1), 20);
    let sent = 0;
    let failed = 0;
    for (let index = 0; index < boundedLimit; index += 1) {
      const claimed = await this.claimOne(boundedAttempts, tenantId);
      if (!claimed) break;
      if (await this.dispatch(claimed)) sent += 1;
      else failed += 1;
    }
    return { sent, failed };
  }

  async processOne(
    tenantId: string,
    notificationId: string,
  ): Promise<NotificationView> {
    const claimed = await this.claimOne(5, tenantId, notificationId);
    if (claimed) await this.dispatch(claimed);
    const notification = await this.database.models.notification
      .findOne({ _id: notificationId, tenantId })
      .lean()
      .exec();
    if (!notification) throw new Error('Notification does not exist');
    return this.view(notification);
  }

  private claimOne(
    maxAttempts: number,
    tenantId?: string,
    notificationId?: string,
  ): Promise<NotificationEntity | null> {
    const now = new Date();
    return this.database.models.notification
      .findOneAndUpdate(
        {
          scheduledFor: { $lte: now },
          attempts: { $lt: maxAttempts },
          ...(tenantId ? { tenantId } : {}),
          ...(notificationId ? { _id: notificationId } : {}),
          $or: [
            { status: { $in: ['PENDING', 'FAILED'] } },
            {
              status: 'PROCESSING',
              $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }],
            },
          ],
        },
        {
          $set: {
            status: 'PROCESSING',
            leaseUntil: new Date(now.getTime() + 5 * 60 * 1_000),
            lastErrorCode: null,
          },
          $inc: { attempts: 1 },
        },
        {
          sort: { scheduledFor: 1, createdAt: 1, _id: 1 },
          returnDocument: 'after',
          runValidators: true,
        },
      )
      .lean()
      .exec();
  }

  private async dispatch(notification: NotificationEntity): Promise<boolean> {
    try {
      const providerMessageId = await this.delivery.send(notification);
      return await this.database.withTransaction(async (session) => {
        const updated = await this.database.models.notification
          .findOneAndUpdate(
            {
              _id: notification._id,
              tenantId: notification.tenantId,
              status: 'PROCESSING',
              attempts: notification.attempts,
            },
            {
              $set: { status: 'SENT', lastErrorCode: null },
              $unset: { leaseUntil: 1 },
            },
            { returnDocument: 'after', runValidators: true, session },
          )
          .lean()
          .exec();
        if (!updated) return false;
        await this.database.models.auditEvent.create(
          [
            {
              tenantId: notification.tenantId,
              actorType: 'SYSTEM',
              action: 'NOTIFICATION_SENT',
              entityType: 'notification',
              entityId: notification._id,
              metadata: { providerMessageId },
            },
          ],
          { session },
        );
        return true;
      });
    } catch (error) {
      await this.database.models.notification.updateOne(
        {
          _id: notification._id,
          tenantId: notification.tenantId,
          status: 'PROCESSING',
          attempts: notification.attempts,
        },
        {
          $set: {
            status: 'FAILED',
            lastErrorCode: safeErrorCode(error),
          },
          $unset: { leaseUntil: 1 },
        },
        { runValidators: true },
      );
      return false;
    }
  }

  private sameIntent(
    notification: NotificationEntity,
    input: CreateNotificationIntent,
  ): boolean {
    return (
      notification.appointmentId === input.appointmentId &&
      notification.customerId === input.customerId &&
      (notification.channelId ?? null) === (input.channelId ?? null) &&
      notification.type === input.type &&
      notification.scheduledFor.getTime() === input.scheduledFor.getTime()
    );
  }

  private view(notification: NotificationEntity): NotificationView {
    return {
      id: notification._id,
      tenantId: notification.tenantId,
      appointmentId: notification.appointmentId,
      customerId: notification.customerId,
      channelId: notification.channelId ?? null,
      type: notification.type,
      scheduledFor: notification.scheduledFor,
      status: notification.status,
      attempts: notification.attempts,
      idempotencyKey: notification.idempotencyKey,
      lastErrorCode: notification.lastErrorCode ?? null,
    };
  }
}

function safeErrorCode(error: unknown): string {
  return error instanceof AppException &&
    /^[A-Z0-9_]{1,80}$/.test(error.reasonCode)
    ? error.reasonCode
    : 'CHANNEL_DELIVERY_UNAVAILABLE';
}
