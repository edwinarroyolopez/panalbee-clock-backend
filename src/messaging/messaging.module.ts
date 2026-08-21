import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ConversationMessagesController } from './conversation-messages.controller';
import { MessageDeliveryService } from './message-delivery.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [ChannelsModule, ConversationsModule],
  controllers: [WhatsAppWebhookController, ConversationMessagesController],
  providers: [MessageDeliveryService, WhatsAppWebhookService],
  exports: [MessageDeliveryService, WhatsAppWebhookService],
})
export class MessagingModule {}
