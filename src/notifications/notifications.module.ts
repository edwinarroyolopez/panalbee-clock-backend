import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';

@Module({
  imports: [ChannelsModule],
  providers: [NotificationService, NotificationDeliveryService],
  exports: [NotificationService],
})
export class NotificationsModule {}
