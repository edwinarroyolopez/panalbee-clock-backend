import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelAdapterRegistry } from '../channels/channel-adapter.registry';
import { AppException } from '../common/app-exception';
import { Environment } from '../config/environment';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CustomerAccessDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async account(tenantId: string): Promise<string> {
    const channel = await this.database.models.channel
      .findOne({ tenantId, type: 'WHATSAPP', status: 'ACTIVE' })
      .select({ externalAccountId: 1 })
      .lean()
      .exec();
    const externalAccountId =
      channel?.externalAccountId ??
      this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    if (!externalAccountId) {
      throw new AppException(
        503,
        'CUSTOMER_ACCESS_UNAVAILABLE',
        'Customer access is temporarily unavailable',
      );
    }
    return externalAccountId;
  }

  async send(
    tenantId: string,
    challengeId: string,
    externalAccountId: string,
    phone: string,
    code: string,
  ): Promise<void> {
    try {
      const delivery = await this.adapters.get('WHATSAPP').send({
        externalAccountId,
        recipientId: phone,
        intent: {
          kind: 'TEMPLATE',
          name: this.config.get('WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_NAME', {
            infer: true,
          }),
          language: this.config.get(
            'WHATSAPP_CUSTOMER_ACCESS_TEMPLATE_LANGUAGE',
            { infer: true },
          ),
          variables: [code],
        },
        idempotencyKey: challengeId,
      });
      await this.database.models.auditEvent.create({
        tenantId,
        actorType: 'SYSTEM',
        action: 'CUSTOMER_ACCESS_CODE_SENT',
        entityType: 'customer_access_challenge',
        entityId: challengeId,
        metadata: { providerMessageId: delivery.providerMessageId },
      });
    } catch {
      await this.database.models.customerAccessChallenge.updateOne(
        { _id: challengeId, consumedAt: { $exists: false } },
        { $set: { codeExpiresAt: new Date() } },
      );
    }
  }
}
