/**
 * The one place a native deployment puts an SMS on the wire.
 *
 * Two callers send a text from this line: `crm-send-message` (staff, from a
 * conversation) and `finance-portal-client-comms` (a finance partner, from a
 * client's file). Each decides first, through `planNativeSend`, whether a send
 * may happen at all; this module only makes the call they were told to make,
 * so the two cannot come to address Twilio differently.
 *
 * It never decides and never records. Credentials are read here rather than
 * passed in, because the planner has already refused a deployment without all
 * three, and passing a secret through two call sites is two places to log it.
 */

export type TwilioSmsResult =
  | { readonly ok: true; readonly providerMessageId: string | null }
  /** `detail` came from the carrier, so it may be about the recipient. */
  | { readonly ok: false; readonly detail: string };

export async function sendTwilioSms(
  to: string,
  body: string,
  env: { get(key: string): string | undefined } = Deno.env,
): Promise<TwilioSmsResult> {
  const sid = env.get('TWILIO_ACCOUNT_SID') ?? '';
  const token = env.get('TWILIO_AUTH_TOKEN') ?? '';
  const from = env.get('TWILIO_FROM_NUMBER') ?? '';

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    },
  );
  const answer = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      ok: false,
      detail: typeof answer?.message === 'string'
        ? answer.message
        : 'The SMS provider rejected this message.',
    };
  }
  return { ok: true, providerMessageId: typeof answer?.sid === 'string' ? answer.sid : null };
}
