import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ConversationEngineService } from './conversation-engine.service';
import { ConversationQueryController } from './conversation-query.controller';
import { ConversationQueryService } from './conversation-query.service';
import { HandoffController } from './handoff.controller';
import { HandoffService } from './handoff.service';

@Module({
  imports: [AppointmentsModule],
  controllers: [HandoffController, ConversationQueryController],
  providers: [
    ConversationEngineService,
    ConversationQueryService,
    HandoffService,
  ],
  exports: [ConversationEngineService, HandoffService],
})
export class ConversationsModule {}
