import {
  normalizeWhatsAppPayload,
  normalizeWhatsAppPhone,
} from './whatsapp-normalizer';

describe('WhatsApp normalization', () => {
  it('normalizes phone, event/message identity, text, and interactive input', () => {
    const events = normalizeWhatsAppPayload({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'account-1' },
                contacts: [{ wa_id: '573001112233', profile: { name: 'Ada' } }],
                messages: [
                  {
                    id: 'wamid.text',
                    from: '573001112233',
                    timestamp: '1787184000',
                    type: 'text',
                    text: { body: ' Book ' },
                  },
                  {
                    id: 'wamid.list',
                    from: '573001112233',
                    type: 'interactive',
                    interactive: {
                      type: 'list_reply',
                      list_reply: { id: 'service-1', title: 'Haircut' },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toEqual([
      expect.objectContaining({
        providerEventId: 'wamid.text',
        providerMessageId: 'wamid.text',
        externalAccountId: 'account-1',
        externalThreadId: '+573001112233',
        customerDisplayName: 'Ada',
        input: { kind: 'TEXT', text: 'Book' },
      }),
      expect.objectContaining({
        providerEventId: 'wamid.list',
        input: {
          kind: 'INTERACTIVE',
          selectionId: 'service-1',
          title: 'Haircut',
        },
      }),
    ]);
    expect(normalizeWhatsAppPhone('+573001112233')).toBe('+573001112233');
  });
});
