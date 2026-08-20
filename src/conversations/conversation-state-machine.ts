import { NormalizedInput, ReplyIntent } from '../channels/channel-adapter';
import {
  ConversationContext,
  ConversationState,
  TransitionResult,
} from './conversation.types';

const MAIN_MENU: ReplyIntent = {
  kind: 'INTERACTIVE',
  body: 'How can we help?',
  options: [
    { id: 'book', title: 'Book appointment' },
    { id: 'reschedule', title: 'Reschedule' },
    { id: 'cancel', title: 'Cancel appointment' },
    { id: 'human', title: 'Talk to an advisor' },
  ],
};

function textReply(text: string): ReplyIntent[] {
  return [{ kind: 'TEXT', text }];
}

function inputValue(input: NormalizedInput): string {
  return input.kind === 'TEXT' ? input.text.trim() : input.selectionId.trim();
}

function commandKey(input: NormalizedInput): string {
  return inputValue(input)
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

function advance(
  state: ConversationState,
  context: ConversationContext,
  key: string,
  value: string,
  nextPrompt: string,
): TransitionResult {
  return {
    state,
    context: { ...context, [key]: value },
    replies: textReply(nextPrompt),
  };
}

function mainMenu(input: NormalizedInput): TransitionResult {
  const key = commandKey(input);
  if (['book', 'booking', 'book_appointment', '1'].includes(key)) {
    return {
      state: 'BOOKING_SERVICE',
      context: {},
      replies: textReply('Choose a service.'),
    };
  }
  if (['reschedule', 'reschedule_appointment', '2'].includes(key)) {
    return {
      state: 'RESCHEDULE_SELECT_APPOINTMENT',
      context: {},
      replies: textReply('Choose the appointment to reschedule.'),
    };
  }
  if (['cancel', 'cancel_appointment', '3'].includes(key)) {
    return {
      state: 'CANCEL_SELECT_APPOINTMENT',
      context: {},
      replies: textReply('Choose the appointment to cancel.'),
    };
  }
  if (['human', 'handoff', 'advisor', '4'].includes(key)) {
    return {
      state: 'HUMAN_HANDOFF',
      context: {},
      replies: textReply('A team member will join shortly.'),
    };
  }
  return { state: 'MAIN_MENU', context: {}, replies: [MAIN_MENU] };
}

function bookingConfirmation(
  input: NormalizedInput,
  context: ConversationContext,
): TransitionResult {
  const key = commandKey(input);
  if (['modify', 'change', 'back'].includes(key)) {
    return {
      state: 'BOOKING_SERVICE',
      context: {},
      replies: textReply('Choose a service.'),
    };
  }
  if (['menu', 'stop', 'abort'].includes(key)) {
    return { state: 'MAIN_MENU', context: {}, replies: [MAIN_MENU] };
  }
  if (!['confirm', 'yes', 'book_now'].includes(key)) {
    return {
      state: 'BOOKING_CONFIRMATION',
      context,
      replies: textReply('Reply confirm, modify, or menu.'),
    };
  }
  const required = [
    'serviceId',
    'professionalId',
    'date',
    'time',
    'customerData',
  ] as const;
  if (required.some((field) => !context[field])) {
    return {
      state: 'BOOKING_SERVICE',
      context: {},
      replies: textReply('Booking details expired. Choose a service.'),
    };
  }
  return {
    state: 'MAIN_MENU',
    context: {},
    replies: textReply('Your booking request was received.'),
    command: {
      type: 'CREATE_BOOKING',
      serviceId: context.serviceId,
      professionalId: context.professionalId,
      date: context.date,
      time: context.time,
      customerData: context.customerData,
    },
  };
}

function cancelConfirmation(
  input: NormalizedInput,
  context: ConversationContext,
): TransitionResult {
  const key = commandKey(input);
  if (['no', 'back', 'menu'].includes(key)) {
    return { state: 'MAIN_MENU', context: {}, replies: [MAIN_MENU] };
  }
  if (!['confirm', 'yes', 'cancel_now'].includes(key)) {
    return {
      state: 'CANCEL_CONFIRMATION',
      context,
      replies: textReply('Reply confirm or menu.'),
    };
  }
  if (!context.appointmentId) {
    return {
      state: 'CANCEL_SELECT_APPOINTMENT',
      context: {},
      replies: textReply('Choose the appointment to cancel.'),
    };
  }
  return {
    state: 'MAIN_MENU',
    context: {},
    replies: textReply('Your cancellation request was received.'),
    command: {
      type: 'CANCEL_BOOKING',
      appointmentId: context.appointmentId,
    },
  };
}

export function transitionConversation(
  state: ConversationState,
  context: ConversationContext,
  input: NormalizedInput,
): TransitionResult {
  const value = inputValue(input);
  if (commandKey(input) === 'main_menu') {
    return { state: 'MAIN_MENU', context: {}, replies: [MAIN_MENU] };
  }

  switch (state) {
    case 'MAIN_MENU':
      return mainMenu(input);
    case 'BOOKING_SERVICE':
      return advance(
        'BOOKING_PROFESSIONAL',
        context,
        'serviceId',
        value,
        'Choose a professional.',
      );
    case 'BOOKING_PROFESSIONAL':
      return advance(
        'BOOKING_DATE',
        context,
        'professionalId',
        value,
        'Choose a date.',
      );
    case 'BOOKING_DATE':
      return advance('BOOKING_TIME', context, 'date', value, 'Choose a time.');
    case 'BOOKING_TIME':
      return advance(
        'BOOKING_CUSTOMER_DATA',
        context,
        'time',
        value,
        'Provide the customer details.',
      );
    case 'BOOKING_CUSTOMER_DATA':
      return advance(
        'BOOKING_CONFIRMATION',
        context,
        'customerData',
        value,
        'Reply confirm to create the booking, or modify.',
      );
    case 'BOOKING_CONFIRMATION':
      return bookingConfirmation(input, context);
    case 'RESCHEDULE_SELECT_APPOINTMENT':
      return advance(
        'RESCHEDULE_DATE',
        context,
        'appointmentId',
        value,
        'Choose a new date.',
      );
    case 'RESCHEDULE_DATE':
      return advance(
        'RESCHEDULE_TIME',
        context,
        'date',
        value,
        'Choose a new time.',
      );
    case 'RESCHEDULE_TIME':
      if (!context.appointmentId || !context.date) {
        return {
          state: 'RESCHEDULE_SELECT_APPOINTMENT',
          context: {},
          replies: textReply('Choose the appointment to reschedule.'),
        };
      }
      return {
        state: 'MAIN_MENU',
        context: {},
        replies: textReply('Your reschedule request was received.'),
        command: {
          type: 'RESCHEDULE_BOOKING',
          appointmentId: context.appointmentId,
          date: context.date,
          time: value,
        },
      };
    case 'CANCEL_SELECT_APPOINTMENT':
      return advance(
        'CANCEL_CONFIRMATION',
        context,
        'appointmentId',
        value,
        'Reply confirm to cancel this appointment.',
      );
    case 'CANCEL_CONFIRMATION':
      return cancelConfirmation(input, context);
    case 'HUMAN_HANDOFF':
      return { state, context, replies: [] };
  }
}
