import { NormalizedInput } from '../channels/channel-adapter';
import { transitionConversation } from './conversation-state-machine';
import { CONVERSATION_STATES } from './conversation.types';

const text = (value: string): NormalizedInput => ({
  kind: 'TEXT',
  text: value,
});

describe('conversation state machine', () => {
  it('covers every persisted state deterministically', () => {
    for (const state of CONVERSATION_STATES) {
      expect(() =>
        transitionConversation(state, {}, text('value')),
      ).not.toThrow();
    }
  });

  it('walks booking context and emits one channel-neutral booking command', () => {
    let result = transitionConversation('MAIN_MENU', {}, text('book'));
    result = transitionConversation(
      result.state,
      result.context,
      text('service-1'),
    );
    result = transitionConversation(
      result.state,
      result.context,
      text('staff-1'),
    );
    result = transitionConversation(
      result.state,
      result.context,
      text('2026-08-21'),
    );
    result = transitionConversation(
      result.state,
      result.context,
      text('14:30'),
    );
    result = transitionConversation(
      result.state,
      result.context,
      text('Ada, +57'),
    );
    result = transitionConversation(
      result.state,
      result.context,
      text('confirm'),
    );

    expect(result).toMatchObject({
      state: 'MAIN_MENU',
      context: {},
      command: {
        type: 'CREATE_BOOKING',
        serviceId: 'service-1',
        professionalId: 'staff-1',
        date: '2026-08-21',
        time: '14:30',
        customerData: 'Ada, +57',
      },
    });
  });

  it('emits explicit reschedule and cancel commands and suppresses handoff', () => {
    const reschedule = transitionConversation(
      'RESCHEDULE_TIME',
      { appointmentId: 'appointment-1', date: '2026-08-22' },
      text('10:00'),
    );
    const cancel = transitionConversation(
      'CANCEL_CONFIRMATION',
      { appointmentId: 'appointment-2' },
      text('yes'),
    );
    const handoff = transitionConversation('HUMAN_HANDOFF', {}, text('hello'));

    expect(reschedule.command).toEqual({
      type: 'RESCHEDULE_BOOKING',
      appointmentId: 'appointment-1',
      date: '2026-08-22',
      time: '10:00',
    });
    expect(cancel.command).toEqual({
      type: 'CANCEL_BOOKING',
      appointmentId: 'appointment-2',
    });
    expect(handoff.replies).toEqual([]);
  });
});
