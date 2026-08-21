import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../config/environment';
import {
  CHANNEL_ADAPTERS,
  ChannelAdapterRegistry,
} from './channel-adapter.registry';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';

function whatsappFromEnvironment(
  config: ConfigService<Environment, true>,
): WhatsAppAdapter {
  return new WhatsAppAdapter({
    appSecret: config.get('WHATSAPP_APP_SECRET', { infer: true }),
    verifyToken: config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN', { infer: true }),
    accessToken: config.get('WHATSAPP_PERMANENT_TOKEN', { infer: true }),
    graphVersion: config.get('WHATSAPP_API_VERSION', { infer: true }),
    apiBaseUrl: config.get('WHATSAPP_API_BASE_URL', { infer: true }),
  });
}

@Module({
  providers: [
    {
      provide: WhatsAppAdapter,
      inject: [ConfigService],
      useFactory: whatsappFromEnvironment,
    },
    {
      provide: CHANNEL_ADAPTERS,
      inject: [WhatsAppAdapter],
      useFactory: (whatsApp: WhatsAppAdapter) => [whatsApp],
    },
    ChannelAdapterRegistry,
  ],
  exports: [ChannelAdapterRegistry, CHANNEL_ADAPTERS],
})
export class ChannelsModule {}
