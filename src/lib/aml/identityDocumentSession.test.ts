import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  IDENTITY_DOCUMENT_CHOICES,
  IDENTITY_DOCUMENT_COUNTRY,
  IDENTITY_RETURN_PATH,
  identityReturnUrl,
  isDocumentChoice,
  parseDocumentChoice,
} from '../../../supabase/functions/_shared/aml/identityDocuments.pure.ts';
import {
  diditExpectedDetails,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';

/**
 * NPC asks which document; the provider is told, and told nothing else.
 *
 * ## What this replaced
 *
 * The provider's hosted flow ran inside an iframe in NPC's own page, and it
 * opened on ITS country picker and ITS document picker — two screens NPC
 * already knew the answer to, presented in another product's chrome, inside
 * ours. The customer's first impression of an NPC identity check was a
 * third-party application asking them which country they were in.
 *
 * The fix is not a migration. The Workflow session is exactly the same call it
 * always was; what changed is that NPC now asks the question itself and passes
 * the answer down as a session-level restriction, so the provider opens on the
 * one screen it is actually needed for.
 *
 * ## The line these tests hold
 *
 * A browser may declare an INTENT — "I will use my licence". It may not
 * declare authority. Everything that decides what a verification means stays
 * server-side: the provider, the workflow, the environment, the country, the
 * callback, and the outcome. So the document choice is matched against a
 * closed list rather than forwarded, and the mapping to the provider's own
 * vocabulary happens where the browser cannot reach it.
 */

const PORTAL_FN = readFileSync('supabase/functions/aml-client-portal/index.ts', 'utf8');
const PROVIDERS = readFileSync('supabase/functions/_shared/aml/providers/index.ts', 'utf8');
const DIDIT_CLIENT = readFileSync(
  'supabase/functions/_shared/aml/providers/diditClient.ts', 'utf8');
const STEP = readFileSync('src/components/portal/IdentityVerificationStep.tsx', 'utf8');
const RETURN_PAGE = readFileSync('src/pages/portal/PortalIdentityReturn.tsx', 'utf8');
/**
 * Source with comments removed.
 *
 * Several assertions here are "this identifier must not appear", and the
 * comments explaining why it must not appear necessarily contain it — the
 * hosted-cutover notes in particular. Strip them so the assertion reads code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const PORTAL_API = readFileSync('src/lib/aml/amlPortalApi.ts', 'utf8');

/* ─────────────────────── the closed list of documents ────────────────────── */

describe('the document choice is a closed list, not a string', () => {
  it('offers exactly the four Australian photographic documents', () => {
    expect([...IDENTITY_DOCUMENT_CHOICES])
      .toEqual(['passport', 'driver_licence', 'identity_card', 'residence_permit']);
  });

  it('accepts each supported choice', () => {
    for (const choice of IDENTITY_DOCUMENT_CHOICES) {
      expect(parseDocumentChoice(choice)).toBe(choice);
      expect(isDocumentChoice(choice)).toBe(true);
    }
  });

  it('refuses everything else, including the documents NPC does not accept', () => {
    // Medicare, health and concession cards are not identity documents for
    // this purpose and there is deliberately no value that reaches one.
    for (const rejected of [
      'medicare', 'medicare_card', 'health_card', 'concession_card', 'birth_certificate',
      'HIC', 'TC', 'SSC', 'P', 'DL', 'ID', 'RP',
    ]) {
      expect(parseDocumentChoice(rejected)).toBeNull();
    }
  });

  it('refuses anything that is not one of the four strings', () => {
    for (const junk of [
      undefined, null, '', ' ', 42, true, {}, [], ['passport'],
      { document_type: 'passport' },
      // A workflow id is the value that must never work: provider authority
      // is server-side, and a browser that could name a workflow would be
      // choosing which modules run on its own verification.
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      'passport; DROP TABLE', 'passport,driver_licence', '../passport',
    ]) {
      expect(parseDocumentChoice(junk)).toBeNull();
      expect(isDocumentChoice(junk)).toBe(false);
    }
  });

  it('normalises case and surrounding space rather than refusing a near miss', () => {
    expect(parseDocumentChoice('  Driver_Licence ')).toBe('driver_licence');
    expect(parseDocumentChoice('PASSPORT')).toBe('passport');
  });
});

/* ──────────────────── translation into provider vocabulary ───────────────── */

describe('the provider mapping is server-owned and Australia-only', () => {
  it('maps each choice onto the documented enum value', () => {
    // Values read off the current Session API reference for
    // `expected_details.expected_document_types`.
    expect(diditExpectedDetails('passport')?.expected_document_types).toEqual(['P']);
    expect(diditExpectedDetails('driver_licence')?.expected_document_types).toEqual(['DL']);
    expect(diditExpectedDetails('identity_card')?.expected_document_types).toEqual(['ID']);
    expect(diditExpectedDetails('residence_permit')?.expected_document_types).toEqual(['RP']);
  });

  it('pins the country to Australia on every session, declared or not', () => {
    // Alpha-3, because the documented field is alpha-3. `AU` would be refused
    // or — worse — ignored, which reads on our side as "restricted" while the
    // customer is still shown a global country picker.
    expect(IDENTITY_DOCUMENT_COUNTRY).toBe('AUS');
    for (const choice of [...IDENTITY_DOCUMENT_CHOICES, null, undefined]) {
      expect(diditExpectedDetails(choice)?.id_country).toBe('AUS');
    }
  });

  it('restricts nothing but the country when no document was declared', () => {
    // An older portal build, or a caller resuming. It still must not put a
    // country picker back in front of the customer.
    expect(diditExpectedDetails(null)).toEqual({ id_country: 'AUS' });
  });

  it('can never emit a non-photographic document type', () => {
    const emitted = IDENTITY_DOCUMENT_CHOICES
      .flatMap((c) => (diditExpectedDetails(c)?.expected_document_types ?? []) as string[]);
    expect(emitted.sort()).toEqual(['DL', 'ID', 'P', 'RP']);
    for (const forbidden of ['HIC', 'TC', 'SSC']) {
      expect(emitted).not.toContain(forbidden);
    }
  });

  it('sends no customer detail with the restriction', () => {
    /*
     * `expected_details` also accepts a name, a date of birth, an address and
     * a document number. Populating any of them would export PII into the
     * provider's own record of the session for nothing — correlation is on
     * `vendor_data`, which discloses nothing.
     */
    for (const choice of IDENTITY_DOCUMENT_CHOICES) {
      expect(Object.keys(diditExpectedDetails(choice) ?? {}).sort())
        .toEqual(['expected_document_types', 'id_country']);
    }
  });

  it('keeps the provider vocabulary out of the module the browser imports', () => {
    // The portal imports `identityDocuments.pure.ts`. If the provider's codes
    // travelled with the choices, the browser bundle would carry the vendor's
    // vocabulary — the same reason the workflow id and the provider key never
    // cross that boundary.
    const shared = readFileSync(
      'supabase/functions/_shared/aml/identityDocuments.pure.ts', 'utf8')
      // Comments are stripped at build; what ships is the code. The header
      // does name the provider module, and pointing a reader at it is the
      // opposite of a leak.
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(shared).not.toMatch(/expected_document_types/);
    expect(shared).not.toMatch(/didit/i);
    expect(shared).not.toMatch(/\bworkflow\b/i);
  });
});

/* ────────────────────────── the callback origin ──────────────────────────── */

describe('the return URL is server-controlled', () => {
  it('builds the NPC-owned return path on the configured origin', () => {
    expect(identityReturnUrl('https://portal.example.com', 'https://fallback.example'))
      .toBe(`https://portal.example.com${IDENTITY_RETURN_PATH}`);
  });

  it('discards a path, query or fragment on the configured origin', () => {
    // Only the origin is taken. A configured value carrying a path would
    // otherwise produce `/a/b/client/aml/identity-return`.
    expect(identityReturnUrl('https://portal.example.com/a/b?x=1#y', 'https://fallback.example'))
      .toBe(`https://portal.example.com${IDENTITY_RETURN_PATH}`);
  });

  it('falls back rather than concatenating an unusable origin', () => {
    // `command-centre.npcservices.com.au` with no scheme is a relative string;
    // the provider would resolve it against its OWN host and send the customer
    // to a 404 there at the end of their verification.
    for (const broken of ['command-centre.example.com', '', '   ', 'javascript:alert(1)',
      'not a url', undefined, null]) {
      expect(identityReturnUrl(broken, 'https://fallback.example'))
        .toBe(`https://fallback.example${IDENTITY_RETURN_PATH}`);
    }
  });

  it('takes no parameter a browser could reach', () => {
    // Two arguments, both from the deployment: `PUBLIC_APP_URL` and a
    // compiled-in constant. There is no request, no header and no body field
    // in the signature, so an origin from a caller cannot become a redirect
    // NPC's own server mints and hands to a customer mid-verification.
    expect(identityReturnUrl.length).toBe(2);
    expect(PORTAL_FN).toMatch(/function hostedReturnUrl\(\)[\s\S]{0,200}?PUBLIC_APP_URL/);
    expect(PORTAL_FN).not.toMatch(/callback[_A-Za-z]*\s*[:=]\s*(String\()?body\./);
    expect(PORTAL_FN).not.toMatch(/identityReturnUrl\([^)]*req\./);
  });
});

/* ─────────────────── what the edge function will accept ──────────────────── */

describe('the session handler allow-lists the browser and nothing more', () => {
  it('parses the document type through the closed list', () => {
    expect(PORTAL_FN).toMatch(/parseDocumentChoice\(body\.document_type\)/);
  });

  it('refuses a present-but-unrecognised document type instead of ignoring it', () => {
    // Silently dropping a typo would produce an unrestricted session — the
    // country and document pickers back in front of the customer, with nothing
    // on our side to show that it had happened.
    expect(PORTAL_FN).toMatch(/code: 'unsupported_document_type'[\s\S]{0,40}?\}, 400\)/);
  });

  it('takes the workflow from server configuration, never from the request', () => {
    expect(PORTAL_FN).toMatch(/diditWorkflowId\(resolved\)/);
    expect(PORTAL_FN).not.toMatch(/body\.workflow/);
    expect(PORTAL_FN).not.toMatch(/body\.provider/);
    expect(PORTAL_FN).not.toMatch(/body\.environment/);
  });

  it('never lets the browser name a workflow, provider or environment', () => {
    // Against code, not prose: since the hosted cutover both modules carry a
    // comment recording that server-side settlement (didit-webhook) survives
    // the removal of the capture UI.
    for (const source of [PORTAL_API, STEP]) {
      expect(codeOnly(source)).not.toMatch(/workflow_id/);
      expect(codeOnly(source)).not.toMatch(/didit/i);
    }
  });
});

/* ───────────────── the payload the provider actually receives ────────────── */

describe('the session request stays a Workflow session', () => {
  /**
   * `diditClient.ts` reads `Deno.env` when it loads, so the module is imported
   * against a stub. Worth the trouble: this asserts the bytes that go on the
   * wire rather than a description of them.
   */
  let sent: { url: string; body: Record<string, unknown> } | null = null;

  beforeEach(async () => {
    sent = null;
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (k: string) => (k === 'DIDIT_API_BASE_URL' ? 'https://provider.test' : undefined) },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({
        session_id: 'sess-1', url: 'https://provider.test/s/TOKEN', status: 'Not Started',
        workflow_id: 'wf-1', workflow_version: 3, expires_at: null,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).Deno;
    vi.resetModules();
  });

  async function create(extra: Record<string, unknown> = {}) {
    const { createDiditSession } = await import(
      '../../../supabase/functions/_shared/aml/providers/diditClient.ts');
    await createDiditSession({
      apiKey: 'key', workflowId: 'wf-1',
      vendorData: 'npc:case:party:1', metadata: { verification_check_id: 'row-1' },
      ...extra,
    } as Parameters<typeof createDiditSession>[0]);
    return sent!;
  }

  it('posts a workflow session and never a standalone verification endpoint', async () => {
    const req = await create();
    /*
     * The whole point of this work: better UX WITHOUT leaving the Workflow
     * product. A standalone `id-verification` / `passive-liveness` /
     * `face-match` call would be billed per call and would forfeit the
     * Workflow allowance NPC is on.
     */
    expect(req.url).toBe('https://provider.test/v3/session/');
    expect(req.body.workflow_id).toBe('wf-1');
    for (const standalone of ['id-verification', 'passive-liveness', 'face-match']) {
      expect(req.url).not.toContain(standalone);
    }
  });

  it('carries the expected details when they are supplied', async () => {
    const req = await create({ expectedDetails: diditExpectedDetails('driver_licence') });
    expect(req.body.expected_details)
      .toEqual({ id_country: 'AUS', expected_document_types: ['DL'] });
  });

  it('omits expected_details entirely when there is nothing to restrict', async () => {
    // An empty object is not the same as an absent field: sending one invites
    // the provider to interpret it, and there is nothing to interpret.
    expect((await create({ expectedDetails: {} })).body).not.toHaveProperty('expected_details');
    expect((await create({ expectedDetails: null })).body).not.toHaveProperty('expected_details');
  });

  it('sends callback_method only alongside a callback', async () => {
    const withCallback = await create({
      callback: 'https://npc.test/client/aml/identity-return', callbackMethod: 'both',
    });
    expect(withCallback.body.callback).toBe('https://npc.test/client/aml/identity-return');
    // `both`, so a customer who handed off to a phone also lands on an NPC
    // page rather than the provider's own end screen.
    expect(withCallback.body.callback_method).toBe('both');

    const without = await create({ callbackMethod: 'both' });
    expect(without.body).not.toHaveProperty('callback');
    expect(without.body).not.toHaveProperty('callback_method');
  });

  it('sends no verification feature NPC has not configured', async () => {
    const req = await create({ expectedDetails: diditExpectedDetails('passport') });
    // The workflow decides which modules run. Nothing in the payload may turn
    // on AML screening, PEP, sanctions, adverse media, KYB, proof of address,
    // or phone/email/IP checks — NPC's screening system is separate.
    const serialised = JSON.stringify(req.body).toLowerCase();
    for (const scope of ['aml', 'pep', 'sanction', 'adverse', 'kyb', 'proof_of_address',
      'poa', 'phone', 'email', 'ip_address', 'questionnaire']) {
      expect(serialised).not.toContain(scope);
    }
  });
});

/* ──────────── nothing in the browser can settle a verification ───────────── */

describe('the callback is a receipt, never a result', () => {
  it('the return page reads no status out of the redirect', () => {
    /*
     * The provider appends `verificationSessionId` and `status` to the
     * callback URL. A redirect is authored by whatever the browser was last
     * pointed at — trusting one would mean anybody who can type a URL could
     * mark themselves verified.
     */
    expect(RETURN_PAGE).not.toMatch(/useSearchParams|URLSearchParams|location\.search/);
    expect(RETURN_PAGE).not.toMatch(/verificationSessionId/);
    expect(RETURN_PAGE).not.toMatch(/status\s*===/);
    expect(RETURN_PAGE).not.toMatch(/\bApproved\b/);
  });

  it('the return page claims receipt and never a verdict', () => {
    expect(RETURN_PAGE).toMatch(/Verification received/);
    // "Received" is what NPC knows. "Verified" is what only the server-side
    // decision may say, and this page has not read it.
    expect(RETURN_PAGE).not.toMatch(/Identity verified|You are verified|Verification successful/);
  });

  it('the return page notifies its opener with a payload that has no status field', () => {
    expect(RETURN_PAGE).toMatch(/RETURN_NOTICE = \{ type: 'npc:identity-return' \}/);
    // Targeted at this origin, so only an NPC page can receive it.
    expect(RETURN_PAGE).toMatch(/postMessage\(RETURN_NOTICE, window\.location\.origin\)/);
  });

  it('the return-message handler is bounded to this origin and reads no verdict', () => {
    /*
     * The listener is back with the window it belongs to: a window NPC opened
     * needs a way to say "the customer came back". What it may do with that is
     * the narrow part — the message is origin-checked against NPC's own page,
     * matched on a bare type, and its ONLY effect is to re-read server state.
     *
     * The payload has no status field (asserted above, on the return page), so
     * there is nothing here for a future edit to start trusting.
     */
    const code = codeOnly(STEP);
    expect(code).toMatch(/event\.origin !== window\.location\.origin/);
    expect(code).toMatch(/addEventListener\('message'/);
    expect(code).toContain("'npc:identity-return'");
    // The handler re-reads and does nothing else — no status is taken off the
    // event, and no branch of it can reach a verification outcome.
    const handler = code.slice(code.indexOf('const onMessage'), code.indexOf("addEventListener('message'"));
    expect(handler).not.toMatch(/verified|approved|status\s*===/i);
    expect(handler).toContain('onRefresh()');
  });

  it('the step holds no path from a browser event to a verification status', () => {
    for (const forbidden of [
      /setStatus\(\s*'verified'/, /status:\s*'verified'/, /markVerified/,
      /verificationStatus\.verified\s*=/,
    ]) {
      expect(STEP).not.toMatch(forbidden);
    }
  });
});

/* ─────────────────── the embedded provider UI is gone ────────────────────── */

describe('the provider no longer runs inside NPC', () => {
  it('the step renders no iframe and delegates no permissions', () => {
    // The provider runs in a separate TOP-LEVEL window, not inside NPC's page.
    // A withheld iframe capability became a silent device handoff, which is why
    // the embed is the one thing that must never come back.
    expect(STEP).not.toMatch(/<iframe/);
    expect(STEP).not.toMatch(/HOSTED_IFRAME_ALLOW/);
    expect(STEP).not.toMatch(/iframeRef/);
    expect(STEP).not.toMatch(/allowFullScreen/);
    // The camera permission is no longer NPC's to delegate: the capture page
    // is top-level and asks for it in its own right, under its own origin,
    // which is also what lets the customer see whose page is asking.
    expect(STEP).not.toMatch(/'camera',\s*\n\s*'microphone'/);
  });

  it('opens the window SYNCHRONOUSLY inside the click, before the session request', () => {
    /*
     * The ordering the whole hosted flow rests on: open the window inside the
     * gesture, THEN await the session, THEN navigate the window already held.
     * A window opened after an `await` is an unsolicited popup and is blocked
     * on default settings in Safari and Firefox — getting this order wrong
     * does not degrade the flow, it ends it.
     *
     * Asserted positionally rather than by reading the comment beside it,
     * because the comment cannot fail when somebody reorders the code.
     */
    const code = codeOnly(STEP);
    const begin = code.slice(code.indexOf('const begin ='), code.indexOf('const requirements ='));
    expect(begin.length).toBeGreaterThan(0);

    const opened = begin.indexOf('window.open(');
    const awaited = begin.indexOf('await amlPortalApi.startHostedVerification');
    const navigated = begin.indexOf('location.replace(');
    expect(opened, 'the window is opened').toBeGreaterThan(-1);
    expect(awaited, 'the session is requested').toBeGreaterThan(-1);
    expect(navigated, 'the window is navigated').toBeGreaterThan(-1);
    expect(opened, 'window.open precedes the await').toBeLessThan(awaited);
    expect(awaited, 'the navigation follows the session').toBeLessThan(navigated);

    // Nothing is awaited before the window opens — that is what keeps the
    // browser treating it as user-initiated.
    expect(begin.slice(0, opened)).not.toContain('await');
  });

  it('never writes the session URL to storage or a log', () => {
    // The URL embeds the customer's session token. Web storage survives the
    // restart that should have ended it and is readable by every script on the
    // origin.
    expect(STEP).not.toMatch(/(localStorage|sessionStorage)\.setItem[^\n]*url/i);
    expect(STEP).not.toMatch(/console\.(log|info|warn|error)\([^)]*url/i);
    expect(STEP).not.toMatch(/toast\.[a-z]+\([^)]*verification_url/);
  });

  it('the backend still returns the URL to the browser and stores nothing', () => {
    expect(PORTAL_FN).toMatch(/verification_url: session\.url/);
    // Identifiers only on the row: the URL embeds a live credential.
    expect(PORTAL_FN).not.toMatch(/session_url:\s*session\.url/);
    expect(PORTAL_FN).not.toMatch(/url:\s*session\.url,\s*\n\s*(status|expires)/);
  });
});

/* ──────────────── a changed document costs the customer nothing ──────────── */

describe('re-choosing a document supersedes technically, never punitively', () => {
  it('replaces an unstarted session rather than dead-ending the customer', () => {
    // A session minted for a passport restricts the provider to a passport. A
    // customer who comes back and picks their licence would otherwise be
    // handed a picker that will not offer it.
    expect(PORTAL_FN).toMatch(/document_choice_changed/);
    expect(PORTAL_FN).toMatch(/String\(decision\['status'\] \?\? ''\) !== 'Not Started'/);
  });

  it('returns a started session to the customer whatever they picked here', () => {
    expect(PORTAL_FN).toMatch(/documentChoice && !startedAlready/);
  });

  it('releases without touching status or the attempt allowance', () => {
    // `releaseHostedCheck` guards on `attempt_consumed = false` and writes
    // neither `status` nor `attempt_consumed` — changing your mind about which
    // card to hold up is not a failed identity check.
    const release = PORTAL_FN.slice(
      PORTAL_FN.indexOf('async function releaseHostedCheck'),
      PORTAL_FN.indexOf('type IdvAvailability'));
    expect(release).toMatch(/\.eq\('attempt_consumed', false\)/);
    expect(release).not.toMatch(/status:\s*'(failed|passed|referred|exhausted)'/);
    expect(release).not.toMatch(/attempt_consumed:\s*true/);
  });

  it('records it as a technical event on the case timeline', () => {
    const event = PORTAL_FN.slice(PORTAL_FN.indexOf("reason: 'document_choice_changed'"));
    expect(event.slice(0, 200)).toMatch(/category: 'technical'/);
    expect(event.slice(0, 200)).toMatch(/attempt_consumed: false/);
  });
});

/* ─────────────────── the Workflow product is retained ────────────────────── */

describe('the provider architecture is unchanged', () => {
  it('creates sessions through the workflow adapter and no other route', () => {
    expect(PROVIDERS).toMatch(/createDiditSession\(\{/);
    expect(DIDIT_CLIENT).toMatch(/'\/v3\/session\/'/);
    expect(DIDIT_CLIENT).toMatch(/\/v3\/session\/\$\{encodeURIComponent\(sessionId\)\}\/decision\//);
  });

  it('introduces no standalone verification call anywhere', () => {
    for (const source of [PROVIDERS, DIDIT_CLIENT, PORTAL_FN, STEP]) {
      for (const standalone of [
        '/v2/id-verification', '/v2/passive-liveness', '/v2/face-match',
        'id-verification/', 'passive-liveness/', 'face-match/',
      ]) {
        expect(source).not.toContain(standalone);
      }
    }
  });

  it('keeps the decision authoritative and server-side', () => {
    // The webhook body carries a decision object and is still not trusted:
    // the signature admits the event, and this fetch says what it means.
    const webhook = readFileSync('supabase/functions/didit-webhook/index.ts', 'utf8');
    expect(webhook).toMatch(/decision = await fetchDiditDecision\(apiKey, sessionId\)/);
    expect(webhook).toMatch(/verifyDiditWebhook\(\{/);
  });

  it('holds the API key and webhook secret server-side only', () => {
    for (const secret of ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_WORKFLOW_ID']) {
      expect(STEP).not.toContain(secret);
      expect(PORTAL_API).not.toContain(secret);
    }
  });
});
