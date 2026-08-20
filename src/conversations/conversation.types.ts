import { ReplyIntent } from '../channels/channel-adapter';

export const CONVERSATION_STATES = [
  'MAIN_MENU',
  'BOOKING_SERVICE',
  'BOOKING_PROFESSIONAL',
  'BOOKING_DATE',
  'BOOKING_TIME',
  'BOOKING_CUSTOMER_DATA',
  'BOOKING_CONFIRMATION',
  'RESCHEDULE_SELECT_APPOINTMENT',
  'RESCHEDULE_DATE',
  'RESCHEDULE_TIME',
  'CANCEL_SELECT_APPOINTMENT',
  'CANCEL_CONFIRMATION',
  'HUMAN_HANDOFF',
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];
export type ConversationControl = 'BOT' | 'HUMAN';
export type ConversationContext = Record<string, string>;

export type ConversationCommand =
  | {
      type: 'CREATE_BOOKING';
      serviceId: string;
      professionalId: string;
      date: string;
      time: string;
      customerData: string;
    }
  | {
      type: 'RESCHEDULE_BOOKING';
      appointmentId: string;
      date: string;
      time: string;
    }
  | { type: 'CANCEL_BOOKING'; appointmentId: string };

export interface TransitionResult {
  state: ConversationState;
  context: ConversationContext;
  replies: ReplyIntent[];
  command?: ConversationCommand;
}

export interface ConversationView {
  id: string;
  tenantId: string;
  customerId: string;
  channelId: string;
  externalThreadId: string;
  state: ConversationState;
  context: ConversationContext;
  controlStatus: ConversationControl;
  assignedTo: string | null;
  status: 'OPEN' | 'CLOSED';
  updatedAt: Date;
}

export interface QueuedConversationMessage {
  id: string;
  tenantId: string;
}
