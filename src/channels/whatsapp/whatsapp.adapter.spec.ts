import { AppException } from '../../common/app-exception';
import { WhatsAppAdapter } from './whatsapp.adapter';

describe('WhatsApp adapter delivery', () => {
  it('can be created without live credentials and blocks only live send', async () => {
    const adapter = new WhatsAppAdapter({});
    await expect(
      adapter.send({
        externalAccountId: 'account',
        recipientId: '+573001112233',
        intent: { kind: 'TEXT', text: 'hello' },
      }),
    ).rejects.toMatchObject<AppException>({
      reasonCode: 'CHANNEL_CREDENTIALS_MISSING',
    });
  });

  it('maps provider errors without exposing provider messages', async () => {
    const transport = jest.fn(async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: { code: 131047, message: 'secret provider diagnostics' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      ),
    ) as unknown as typeof fetch;
    const adapter = new WhatsAppAdapter(
      { accessToken: 'test-token' },
      transport,
    );

    await expect(
      adapter.send({
        externalAccountId: 'account',
        recipientId: '+573001112233',
        intent: { kind: 'TEXT', text: 'hello' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<AppException>({
        reasonCode: 'CHANNEL_PROVIDER_REJECTED',
        details: { provider: 'WHATSAPP', status: 400, code: '131047' },
      }),
    );
  });
});
