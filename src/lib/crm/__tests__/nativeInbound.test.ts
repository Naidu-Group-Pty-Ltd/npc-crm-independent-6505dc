/**
 * Inbound is the one CRM path a stranger can reach, so what is asserted here
 * is mostly what it REFUSES, and in what order.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INBOUND_REFUSAL_BODY,
  INBOUND_REFUSAL_STATUS,
  TWILIO_INBOUND_CREDENTIAL,
  canVerifyInbound,
  planInboundMessage,
  twilioSignatureBase,
} from '../../../../supabase/functions/_shared/crm/nativeInbound.pure.ts';

const SIGNED = { TWILIO_AUTH_TOKEN: 'a-real-token' };
const MESSAGE = { From: '+61400000000', To: '+61400000001', Body: 'hello', MessageSid: 'SM1' };

const plan = (over: Partial<Parameters<typeof planInboundMessage>[0]> = {}) =>
  planInboundMessage({
    env: SIGNED,
    signatureHeader: 'sig',
    signatureValid: true,
    params: MESSAGE,
    ...over,
  });

describe('a deployment that cannot verify refuses everything', () => {
  it('refuses when the auth token is absent, whatever the caller claims', () => {
    for (const env of [{}, { TWILIO_AUTH_TOKEN: '' }, { TWILIO_AUTH_TOKEN: '   ' }]) {
      const r = plan({ env, signatureValid: true, signatureHeader: 'anything' });
      expect(r.act).toBe('refuse');
      expect(r.act === 'refuse' && r.kind).toBe('unverifiable');
    }
  });

  it('a supplied `signatureValid: true` cannot talk it round', () => {
    // The caller computes that flag from the token. With no token there is
    // nothing it could have computed it from, so it carries no information and
    // must not be able to open the door.
    const r = plan({ env: {}, signatureValid: true });
    expect(r.act).toBe('refuse');
  });

  it('names the credential it needs, in one place', () => {
    expect(TWILIO_INBOUND_CREDENTIAL).toBe('TWILIO_AUTH_TOKEN');
    expect(canVerifyInbound(SIGNED)).toBe(true);
    expect(canVerifyInbound({})).toBe(false);
  });
});

describe('verification outranks everything else', () => {
  it('refuses an unsigned request even where the payload is perfect', () => {
    for (const header of [null, undefined, '', '  ']) {
      const r = plan({ signatureHeader: header });
      expect(r.act === 'refuse' && r.kind).toBe('unsigned');
    }
  });

  it('refuses a bad signature', () => {
    expect(plan({ signatureValid: false }).act).toBe('refuse');
    expect(
      plan({ signatureValid: false }).act === 'refuse' &&
        (plan({ signatureValid: false }) as { kind: string }).kind,
    ).toBe('bad_signature');
  });

  it('never reports a payload problem to an unverified caller', () => {
    // Ordering: an unsigned request with junk in it must be refused as
    // UNSIGNED. Answering `unusable_payload` would confirm the signature check
    // is not what stopped them.
    const r = plan({ signatureHeader: null, params: { Body: 'x' } });
    expect(r.act === 'refuse' && r.kind).toBe('unsigned');
  });
});

describe('a verified message is placed, or refused for being unplaceable', () => {
  it('records a well-formed message', () => {
    const r = plan();
    expect(r.act).toBe('record');
    if (r.act !== 'record') return;
    expect(r.from).toBe('+61400000000');
    expect(r.providerMessageId).toBe('SM1');
    expect(r.channel).toBe('sms');
  });

  it('accepts an empty body — an MMS may carry only an attachment', () => {
    const r = plan({ params: { ...MESSAGE, Body: '' } });
    expect(r.act).toBe('record');
    expect(r.act === 'record' && r.body).toBe('');
  });

  it('refuses a message it cannot address', () => {
    const r = plan({ params: { ...MESSAGE, From: '' } });
    expect(r.act === 'refuse' && r.kind).toBe('unusable_payload');
  });

  it('refuses a message it cannot de-duplicate', () => {
    // Without the provider's id a Twilio retry becomes a second copy of one
    // reply, which is worse than losing it: the operator sees the customer
    // said it twice.
    const r = plan({ params: { From: '+61400000000', To: '+1', Body: 'hi' } });
    expect(r.act === 'refuse' && r.kind).toBe('unusable_payload');
  });

  it('takes SmsSid where MessageSid is absent', () => {
    const r = plan({ params: { From: '+61400000000', To: '+1', Body: 'hi', SmsSid: 'SM2' } });
    expect(r.act === 'record' && r.providerMessageId).toBe('SM2');
  });

  it('never reformats the number it was given', () => {
    // It is a lookup key against `clients.primary_mobile`. Normalising here
    // and not there is how a known client stops being found.
    const r = plan({ params: { ...MESSAGE, From: '  +61 400 000 000  ' } });
    expect(r.act === 'record' && r.from).toBe('+61 400 000 000');
  });
});

describe('the signature base is the provider’s, checked rather than believed', () => {
  it('matches Twilio’s own published worked example', () => {
    // From Twilio's security documentation: the URL, then every POST
    // parameter in key order, name immediately followed by value.
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675309',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
    };
    expect(twilioSignatureBase(url, params)).toBe(
      'https://mycompany.com/myapp.php?foo=1&bar=2' +
        'CallSidCA1234567890ABCDE' +
        'Caller+14158675309' +
        'Digits1234' +
        'From+14158675309' +
        'To+18005551212',
    );
  });

  it('sorts by key rather than taking insertion order', () => {
    const a = twilioSignatureBase('u', { b: '2', a: '1' });
    const b = twilioSignatureBase('u', { a: '1', b: '2' });
    expect(a).toBe(b);
    expect(a).toBe('ua1b2');
  });
});

describe('every refusal looks identical from outside', () => {
  const fn = readFileSync(
    join(
      __dirname, '..', '..', '..', '..',
      'supabase', 'functions', 'crm-inbound-message', 'index.ts',
    ),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('answers one status and one body, from the shared constants', () => {
    expect(INBOUND_REFUSAL_STATUS).toBe(403);
    expect(INBOUND_REFUSAL_BODY).toBe('Forbidden');
    expect(fn).toContain('INBOUND_REFUSAL_STATUS');
    expect(fn).toContain('INBOUND_REFUSAL_BODY');
  });

  it('has exactly one function that builds a refusal response', () => {
    // Two would be two chances for one of them to say more than the other.
    expect((fn.match(/function refuse\(/g) ?? []).length).toBe(1);
  });

  it('never puts a refusal reason in the response body', () => {
    /**
     * Pinned on the BODY ARGUMENT, not on the names that might carry a reason.
     * The first version of this scanned every `new Response(...)` for
     * `plan.reason`, and a planted `new Response(reason, …)` — the local the
     * function already holds — sailed through it. What the rule is actually
     * about is that a refusal says the constant and nothing else, so that is
     * what is asserted.
     */
    const body = fn.slice(fn.indexOf('function refuse('));
    const response = body.slice(body.indexOf('new Response('));
    expect(
      response.startsWith('new Response(INBOUND_REFUSAL_BODY,'),
      'a refusal must answer the shared constant — anything else describes ' +
        'this deployment to whoever found the URL.',
    ).toBe(true);

    // And the reason reaches the log, which is the reader that may have it.
    expect(fn).toMatch(/console\.error\([^)]*refused/);
  });

  it('answers no CORS preflight, because no browser calls it', () => {
    expect(fn).not.toContain('OPTIONS');
    expect(fn).not.toContain('createCorsHeaders');
  });
});

describe('the write path', () => {
  const fn = readFileSync(
    join(
      __dirname, '..', '..', '..', '..',
      'supabase', 'functions', 'crm-inbound-message', 'index.ts',
    ),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('refuses the wrong provider before reading the body', () => {
    const guard = fn.indexOf("servingCrmProvider() !== 'native'");
    const body = fn.indexOf('req.formData()');
    expect(guard).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body);
  });

  it('plans before it touches the database', () => {
    const planned = fn.indexOf('planInboundMessage(');
    const db = fn.indexOf('createClient(');
    // `createClient` is imported at the top, so compare against the CALL that
    // builds the client inside the handler.
    const clientBuilt = fn.indexOf('createClient(\n');
    expect(planned).toBeGreaterThan(-1);
    expect(db).toBeGreaterThan(-1);
    expect(planned).toBeLessThan(clientBuilt === -1 ? fn.length : clientBuilt);
  });

  it('is idempotent on the provider’s id, not on one we mint', () => {
    expect(fn).toMatch(/\.eq\('ghl_message_id', plan\.providerMessageId\)/);
    expect(fn).toContain('status: 204');
  });

  it('invents no client', () => {
    // A number nobody recognises is recorded against a null client_id. An
    // insert into `clients` here would fill the CRM with people nobody added.
    expect(fn).not.toMatch(/from\('clients'\)[\s\S]{0,80}\.insert\(/);
    expect(fn).toContain('client_id: client?.id ?? null');
  });

  it('retries are possible: a write fault answers 5xx, a refusal does not', () => {
    expect(fn).toContain('status: 500');
    // 403 is the refusal; 500 is only in the catch.
    const catchBlock = fn.slice(fn.lastIndexOf('} catch (error)'));
    expect(catchBlock).toContain('500');
  });

  it('sends no auto-reply', () => {
    // Anything inside <Response> is delivered to the customer as an SMS.
    expect(fn).toContain('<Response></Response>');
    expect(fn).not.toMatch(/<Message>/);
  });
});
