import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { NotificationService } from './notification.service';

@Module({
  imports: [ChannelsModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
