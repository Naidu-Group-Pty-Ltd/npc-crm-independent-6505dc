/**
 * The request builder, and the descriptors that ride on it.
 *
 * Everything here fails silently in production if it is wrong: an unresolved
 * reference becomes the literal text "undefined" in a customer's SMS, a missing
 * credential becomes an opaque 401, a keyValue field reaches Airtable as an
 * array it cannot read, and a Slack post that never happened records as sent.
 * None of those are visible without either a vendor account or a customer
 * complaint, so they are asserted here instead.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  mapOutputs,
  requestFailure,
} from '../../../../supabase/functions/_shared/workflow/httpRequest.pure';
import { CATALOG, getCatalogNode } from '../catalog';
import { LIVE_CAPABLE } from '../runtime/performers';
import type { CatalogNode, NodeRequest } from '../types';

const node = (id: string): CatalogNode => {
  const found = getCatalogNode(id);
  if (!found) throw new Error(`${id} is not in the catalog`);
  return found;
};

const build = (id: string, config: Record<string, unknown>, secrets: Record<string, string>) =>
  buildRequest({ request: node(id).request as NodeRequest, config, secrets });

const ok = (result: ReturnType<typeof build>) => {
  if (result.ok === false) throw new Error(`expected a request, got: ${result.failure.error}`);
  return result.request;
};

const AIRTABLE = { AIRTABLE_API_KEY: 'pat_secret_value', AIRTABLE_WORKFLOW_BASE_ID: 'appABC' };
const TWILIO = { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok_secret_value' };

describe('resolving templates', () => {
  it('reads config and credentials into the URL', () => {
    const request = ok(build('airtable.list_records', { table: 'Listings' }, AIRTABLE));
    expect(request.url).toContain('https://api.airtable.com/v0/appABC/Listings');
    expect(request.headers.Authorization).toBe('Bearer pat_secret_value');
  });

  /**
   * The failure this whole module exists to prevent. A blank optional field
   * must not interpolate as the four characters "undefined" — which is exactly
   * what naive string replacement produces, and what a client then receives.
   */
  it('never interpolates the word undefined', () => {
    const request = ok(build('twilio.send_sms', { to: '+61400000000', body: 'Hi' }, { ...TWILIO, TWILIO_FROM_NUMBER: '+61399999999' }));
    expect(request.body).not.toContain('undefined');
    expect(request.body).not.toContain('null');
  });

  it('drops an optional field rather than sending it empty', () => {
    const request = ok(build('slack.post_message', { channel: '#ops', text: 'hello' }, { SLACK_BOT_TOKEN: 't' }));
    const body = JSON.parse(request.body as string);
    // `thread_ts` was not set; Slack treats an empty string as an invalid
    // timestamp rather than as "no thread".
    expect(body).not.toHaveProperty('thread_ts');
    expect(body.text).toBe('hello');
  });

  it('turns a keyValue field into the object the API expects', () => {
    const request = ok(build(
      'airtable.create_record',
      { table: 'Leads', fields: [{ key: 'Name', value: 'Ada' }, { key: 'Stage', value: 'New' }] },
      AIRTABLE,
    ));
    expect(JSON.parse(request.body as string).fields).toEqual({ Name: 'Ada', Stage: 'New' });
  });

  it('ignores a keyValue row with no name', () => {
    const request = ok(build(
      'airtable.create_record',
      { table: 'Leads', fields: [{ key: '', value: 'orphan' }, { key: 'Name', value: 'Ada' }] },
      AIRTABLE,
    ));
    expect(JSON.parse(request.body as string).fields).toEqual({ Name: 'Ada' });
  });

  it('keeps a whole-object reference an object rather than stringifying it', () => {
    const request = ok(build(
      'make.trigger_scenario',
      { payload: { suburb: 'Carlton', score: 7 } },
      { MAKE_WEBHOOK_URL: 'https://hook.make.com/abc' },
    ));
    expect(JSON.parse(request.body as string)).toEqual({ suburb: 'Carlton', score: 7 });
  });
});

describe('falling back to an integration-wide default', () => {
  it('uses the step’s own value when it has one', () => {
    const request = ok(build(
      'twilio.send_sms',
      { to: '+61400000000', body: 'Hi', from: '+61411111111' },
      { ...TWILIO, TWILIO_FROM_NUMBER: '+61399999999' },
    ));
    expect(request.body).toContain(encodeURIComponent('+61411111111'));
  });

  it('falls back to the saved default when the step leaves it blank', () => {
    const request = ok(build(
      'twilio.send_sms',
      { to: '+61400000000', body: 'Hi' },
      { ...TWILIO, TWILIO_FROM_NUMBER: '+61399999999' },
    ));
    expect(request.body).toContain(encodeURIComponent('+61399999999'));
  });

  it('sends the recipient as a list where the vendor wants one', () => {
    const request = ok(build(
      'resend.send_email',
      { to: 'a@example.com', subject: 'Hi', html: '<p>Hi</p>' },
      { RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'NPC <no-reply@example.com>' },
    ));
    const body = JSON.parse(request.body as string);
    expect(body.to).toEqual(['a@example.com']);
    expect(body.from).toBe('NPC <no-reply@example.com>');
  });
});

describe('auth', () => {
  it('signs Twilio with basic auth over the account SID and token', () => {
    const request = ok(build('twilio.send_sms', { to: '+61400000000', body: 'Hi', from: '+61411111111' }, TWILIO));
    expect(request.headers.Authorization).toBe(`Basic ${btoa('AC123:tok_secret_value')}`);
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('reports every missing credential at once rather than one at a time', () => {
    const result = build('airtable.list_records', { table: 'Listings' }, {});
    if (result.ok !== false) throw new Error('expected a failure');
    expect(result.failure.missingSecrets.sort()).toEqual(['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID']);
    expect(result.failure.error).toMatch(/Integrations page/);
  });

  it('names the credential values so a caller can redact them', () => {
    const request = ok(build('airtable.list_records', { table: 'Listings' }, AIRTABLE));
    expect(request.secretValues).toContain('pat_secret_value');
  });
});

describe('reading the response', () => {
  it('maps a vendor payload onto the outputs the canvas promised', () => {
    const output = mapOutputs(node('airtable.create_record'), {
      status: 200,
      body: { id: 'rec123', createdTime: '2026-01-01T00:00:00Z', fields: {} },
    });
    expect(output.recordId).toBe('rec123');
    expect(output.createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('fills a declared output from the HTTP status when asked', () => {
    const output = mapOutputs(node('make.trigger_scenario'), { status: 200, body: 'Accepted' });
    expect(output.status).toBe(200);
  });

  /**
   * Slack answers 200 with `{"ok": false}`. Trusting the status code alone
   * records a message that never appeared as successfully sent, and the run
   * history then says the workflow worked.
   */
  it('treats a 200 that says ok:false as a failure', () => {
    const request = node('slack.post_message').request as NodeRequest;
    expect(requestFailure(request, { status: 200, body: { ok: false, error: 'channel_not_found' } }))
      .toBe('channel_not_found');
    expect(requestFailure(request, { status: 200, body: { ok: true, ts: '1.2' } })).toBeNull();
  });

  it('still fails on an HTTP error even when the body says nothing', () => {
    const request = node('airtable.list_records').request as NodeRequest;
    expect(requestFailure(request, { status: 422, body: {} })).toMatch(/422/);
  });

  it('surfaces the vendor’s own message when there is one', () => {
    const request = node('twilio.send_sms').request as NodeRequest;
    expect(requestFailure(request, { status: 400, body: { message: 'The From number is not valid' } }))
      .toBe('The From number is not valid');
  });
});

describe('the catalog’s descriptors as a whole', () => {
  const described = CATALOG.filter((n) => n.request);

  it('declares a runnable operation for each of the named integrations', () => {
    const apps = new Set(described.map((n) => n.integrationId));
    for (const id of ['airtable', 'twilio', 'slack', 'resend', 'make', 'zapier']) {
      expect(apps).toContain(id);
    }
  });

  it('never declares one on a trigger', () => {
    // A trigger is started by an event arriving, not by us calling out. A
    // descriptor on one would be dead weight the executor would never reach.
    expect(described.filter((n) => n.kind === 'trigger')).toEqual([]);
  });

  it('only maps outputs the operation actually declares', () => {
    for (const entry of described) {
      const declared = new Set(entry.outputs.map((o) => o.key));
      for (const key of Object.keys(entry.request?.outputs ?? {})) {
        expect(declared, `${entry.id} maps an undeclared output "${key}"`).toContain(key);
      }
    }
  });

  it('builds every descriptor without throwing, given nothing at all', () => {
    // Robustness against a half-filled step: the builder must report, not throw.
    for (const entry of described) {
      expect(() => buildRequest({ request: entry.request!, config: {}, secrets: {} })).not.toThrow();
    }
  });

  it('makes every described operation live-capable on the client', () => {
    for (const entry of described) {
      expect(LIVE_CAPABLE, `${entry.id} has a descriptor but is not offered live`).toContain(entry.id);
    }
  });
});

describe('the AI steps', () => {
  /**
   * `{ role: 'system' }` with no content is rejected by every model API, so an
   * unset system prompt has to remove the whole message rather than leave an
   * empty key behind. That is what `$when` is for.
   */
  it('omits the system message entirely when there is no system prompt', () => {
    const request = ok(build('openai.chat', { model: 'gpt-4o', prompt: 'Hi', maxTokens: 256 }, { OPENAI_API_KEY: 'sk' }));
    const body = JSON.parse(request.body as string);
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('includes it when there is one', () => {
    const request = ok(build(
      'openai.chat',
      { model: 'gpt-4o', system: 'Be terse.', prompt: 'Hi', maxTokens: 256 },
      { OPENAI_API_KEY: 'sk' },
    ));
    expect(JSON.parse(request.body as string).messages).toEqual([
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'Hi' },
    ]);
  });

  it('keeps numeric settings numeric rather than stringifying them', () => {
    const request = ok(build(
      'openai.chat',
      { model: 'gpt-4o', prompt: 'Hi', maxTokens: 512, temperature: 0.3 },
      { OPENAI_API_KEY: 'sk' },
    ));
    const body = JSON.parse(request.body as string);
    expect(body.max_tokens).toBe(512);
    expect(body.temperature).toBe(0.3);
  });

  it('authenticates Anthropic with its own header, not a bearer', () => {
    const request = ok(build(
      'anthropic.messages',
      { model: 'claude-sonnet-4', prompt: 'Hi', maxTokens: 256 },
      { ANTHROPIC_API_KEY: 'sk-ant' },
    ));
    expect(request.headers['x-api-key']).toBe('sk-ant');
    expect(request.headers['anthropic-version']).toBe('2023-06-01');
    expect(request.headers.Authorization).toBeUndefined();
  });

  it('reads the answer out of each vendor’s own response shape', () => {
    expect(mapOutputs(node('openai.chat'), {
      status: 200,
      body: { choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9 } },
    })).toMatchObject({ text: 'Hello', finishReason: 'stop', promptTokens: 9 });

    expect(mapOutputs(node('anthropic.messages'), {
      status: 200,
      body: { content: [{ text: 'Hello' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 4 } },
    })).toMatchObject({ text: 'Hello', finishReason: 'end_turn', promptTokens: 9, completionTokens: 4 });
  });
});
