/**
 * The request schemas must accept what real callers actually send.
 *
 * ## Why this file exists
 *
 * Every other control in this programme proves a gate **fails when the control
 * is removed** — `check-security-gate-negatives.mjs` mutates the tree and
 * requires each gate to go red. That is the right test for a gate, and it is
 * blind in exactly one direction: nothing proved a schema **accepts legitimate
 * traffic**.
 *
 * That is the direction WP-27 broke in. `z.string().optional()` accepts
 * `undefined` and rejects `null`; every login form in this product holds its
 * CAPTCHA token as `useState<string | null>(null)` and sends it
 * unconditionally. Four of the five logins — staff, client, finance and
 * solicitor — answered
 *
 *     400 {"error":"Invalid request","code":"invalid_body","fields":["turnstile_token"]}
 *
 * to every sign-in attempt, in production, with a green CI. `builder-portal-login`
 * survived only because `src/lib/builderPortal.ts` happens to spread the key
 * conditionally.
 *
 * ## The rule for adding a case here
 *
 * Each payload below is transcribed from a real call site, cited by file and
 * line, including its nulls. A payload invented to match the schema tests
 * nothing — the schema was written to match an invented payload, and that is
 * the bug.
 *
 * Both directions are asserted for every schema: the real payload parses, and
 * operator injection still does not. A null-tolerance fix that also let
 * `{"$ne": null}` through would be a worse bug than the one it fixed.
 */
import { describe, expect, it } from 'vitest';
import {
  AcceptInviteRequest,
  ForgotPasswordRequest,
  PortalLoginRequest,
  ResetPasswordRequest,
  StaffLoginRequest,
} from '../../../supabase/functions/_shared/authBodySchemas.ts';
import {
  LocalityRequest,
  PublicTransportRequest,
  SchoolDataRequest,
} from '../../../supabase/functions/_shared/publicServiceSchemas.ts';

/** Every schema in front of an endpoint a caller in this repo posts to. */
const SCHEMAS = {
  PortalLoginRequest,
  StaffLoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  AcceptInviteRequest,
  LocalityRequest,
  SchoolDataRequest,
  PublicTransportRequest,
};

describe('the payloads real callers send are accepted', () => {
  /**
   * `[schema, payload, whereItComesFrom]`.
   *
   * The nulls are the point of each row. Where a call site sends `undefined`
   * the key is simply absent from the JSON, which never had a problem.
   */
  const REAL_PAYLOADS: Array<[keyof typeof SCHEMAS, Record<string, unknown>, string]> = [
    // Staff console. `turnstileToken` is `string | null` and is passed straight
    // through, so an unsolved (or unconfigured) CAPTCHA sends null.
    ['StaffLoginRequest',
      { username: 'a.person', password: 'correct horse battery staple', turnstile_token: null },
      'src/hooks/useAuth.tsx:359'],

    // The three portal logins that send the token unconditionally.
    ['PortalLoginRequest',
      { email: 'client@example.com', password: 'pw', turnstile_token: null },
      'src/hooks/usePortalAuth.tsx:110'],
    ['PortalLoginRequest',
      { email: 'agent@example.com', password: 'pw', turnstile_token: null },
      'src/hooks/useFinancePortalAuth.tsx:221'],
    ['PortalLoginRequest',
      { email: 'solicitor@example.com', password: 'pw', turnstile_token: null },
      'src/hooks/useSolicitorPortalAuth.tsx:55'],

    // A CAPTCHA that HAS been solved must still work — at a REALISTIC length.
    //
    // The first version of this row used `'0.abcdef'`, and that was the same
    // mistake this file's header warns about, committed in the file that warns
    // about it: a payload invented to match the schema. `tokenField` bounded
    // turnstile_token at 512 characters, Cloudflare documents tokens as "up to
    // 2048" and reserves the right to grow them, and a real token therefore came
    // back `invalid_body` — so the null fix restored the unsolved-CAPTCHA path
    // and left the solved one broken. An eight-character fixture could never
    // have shown that.
    ['StaffLoginRequest',
      { username: 'a.person', password: 'pw', turnstile_token: `0.${'A'.repeat(1200)}` },
      'a real Turnstile token, which runs to four figures'],
    ['PortalLoginRequest',
      { email: 'client@example.com', password: 'pw', turnstile_token: `0.${'A'.repeat(2048)}` },
      "Cloudflare's documented ceiling of 2048"],

    // Forgot-password: one field, and the form may hold it empty.
    ['ForgotPasswordRequest', { email: 'a@example.com' }, 'the four forgot-password forms'],

    // Reset-password multiplexes on `action`, so whichever fields the current
    // action does not use arrive null.
    ['ResetPasswordRequest',
      { action: 'request', email: 'a@example.com', otp: null, new_password: null },
      'the OTP-request step'],
    ['ResetPasswordRequest',
      { action: 'reset', email: 'a@example.com', otp: '123456', new_password: 'a new passphrase' },
      'the reset step'],

    // Accept-invite likewise: validating the token carries no password yet.
    ['AcceptInviteRequest',
      { action: 'validate', token: 'inv_abc', password: null },
      'the invite-validation step'],
    ['AcceptInviteRequest',
      { action: 'accept', token: 'inv_abc', password: 'a new passphrase' },
      'the invite-acceptance step'],

    // An address with no four-digit postcode sets it to null explicitly —
    // `postcode = postcodeMatch ? postcodeMatch[1] : null` — and posts it to
    // three locality services.
    ['LocalityRequest',
      { suburb: 'Parramatta', state: 'NSW', postcode: null },
      'generate-investment-report/index.ts:2255 -> crime/abs-employment/climate'],
    ['LocalityRequest',
      { suburb: null, state: 'NSW', postcode: '2150' },
      'the same builder, when the suburb is the part that is missing'],

    // School data sends lat/long as `x || undefined`, so those keys drop out,
    // but postcode comes from the same nullable source.
    ['SchoolDataRequest',
      { suburb: 'Parramatta', state: 'NSW', postcode: null },
      'generate-investment-report/index.ts:2879, regenerate-report-qualitative/index.ts:730'],
    ['SchoolDataRequest',
      { suburb: 'Parramatta', state: 'NSW', postcode: '2150', latitude: -33.81, longitude: 151.0 },
      'the same call sites, with coordinates resolved'],

    // Public transport takes coordinates plus a nullable suburb.
    ['PublicTransportRequest',
      { lat: -33.81, lng: 151.0, state: 'NSW', suburb: null },
      'location-intelligence-service/index.ts:224'],
  ];

  it.each(REAL_PAYLOADS)('%s accepts the body from %s', (name, payload) => {
    const result = SCHEMAS[name].safeParse(payload);
    // Name the fields on failure — a bare `expect(success).toBe(true)` tells you
    // nothing about which field moved.
    const failed = result.success
      ? []
      : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(failed).toEqual([]);
  });

  it('accepts an empty body — presence is the handler\'s check, not the schema\'s', () => {
    for (const [name, schema] of Object.entries(SCHEMAS)) {
      // The two schemas with genuinely required coordinates/state are exempt:
      // every caller guards them, and they are required on purpose.
      if (name === 'PublicTransportRequest' || name === 'LocalityRequest' || name === 'SchoolDataRequest') continue;
      expect(schema.safeParse({}).success, `${name} rejected {}`).toBe(true);
    }
  });
});

describe('null tolerance did not open the door it was closing', () => {
  /** The shapes these schemas exist to reject. */
  const HOSTILE: Array<[string, unknown]> = [
    ['a Mongo-style operator object', { $ne: null }],
    ['a nested operator object', { $gt: '' }],
    ['an array', [null]],
    ['a number where a string belongs', 12345],
    ['a boolean', true],
    ['an object with a toString', { toString: 'x' }],
  ];

  it.each(HOSTILE)('StaffLoginRequest still rejects %s as a password', (_label, value) => {
    expect(StaffLoginRequest.safeParse({ username: 'a', password: value }).success).toBe(false);
  });

  it.each(HOSTILE)('PortalLoginRequest still rejects %s as a turnstile token', (_label, value) => {
    expect(PortalLoginRequest.safeParse({ email: 'a@b.c', turnstile_token: value }).success).toBe(false);
  });

  it('accepts a Turnstile token at the documented ceiling, and beyond it', () => {
    // The bound exists to stop an unbounded string, not to second-guess
    // Cloudflare's format. 2048 is documented; the field allows 4096 so a
    // format change does not lock everyone out again.
    for (const len of [512, 1024, 2048, 4096]) {
      const token = 'A'.repeat(len);
      expect(
        StaffLoginRequest.safeParse({ username: 'a', password: 'b', turnstile_token: token }).success,
        `a ${len}-character Turnstile token was rejected`,
      ).toBe(true);
    }
  });

  it('still rejects an over-long value', () => {
    const tooLong = 'x'.repeat(600);
    expect(StaffLoginRequest.safeParse({ password: tooLong }).success).toBe(false);
    expect(ResetPasswordRequest.safeParse({ otp: 'y'.repeat(64) }).success).toBe(false);
  });

  it('still rejects an unknown key on the strict locality schemas', () => {
    // `.strict()` is deliberate on these five and stays — every caller's key set
    // matches exactly, and an unknown key there means a caller asking for
    // something the endpoint does not implement.
    expect(LocalityRequest.safeParse({ state: 'NSW', drop_table: 1 }).success).toBe(false);
  });

  it('a null in a REQUIRED field is still a failure', () => {
    // Null means "not supplied". For a field that must be supplied, that is
    // still a rejection — the tolerance is about optionality, not about nulls.
    expect(LocalityRequest.safeParse({ suburb: 'x', state: null }).success).toBe(false);
    expect(PublicTransportRequest.safeParse({ lat: null, lng: 151, state: 'NSW' }).success).toBe(false);
  });
});

describe('the parsed value is still the type the handlers destructure', () => {
  it('yields undefined, not null, so `T | undefined` holds downstream', () => {
    const parsed = StaffLoginRequest.parse({ username: 'a', password: 'b', turnstile_token: null });
    expect(parsed.turnstile_token).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, 'turnstile_token')).toBe(true);
  });

  it('still coerces a numeric postcode to a string', () => {
    // The transform on `postcodeField` must survive being wrapped.
    expect(LocalityRequest.parse({ state: 'NSW', postcode: 2150 }).postcode).toBe('2150');
    expect(LocalityRequest.parse({ state: 'NSW', postcode: '2150' }).postcode).toBe('2150');
  });
});
