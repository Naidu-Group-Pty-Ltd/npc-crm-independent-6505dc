/**
 * Billing identity: one workspace, one deployment.
 *
 * A billing uid names exactly one workspace's balance in Mission Control —
 * `startUidCheckout` resolves it against `clones` before `tenants`, and
 * whatever is bought with it is credited there. This deployment's own uid
 * (`npc-prime`) was a compiled-in `??` default, inherited verbatim by every
 * mirrored clone, and Mission Control had published `VITE_AURIXA_BILLING_UID`
 * to none of them: measured 22 Sep 2026, all four live clones carried NULL in
 * `clones.billing_user_id`. A clone's customer clicking a fallback purchase
 * link would have credited the prime.
 *
 * Two rules, enforced here. The uid is named in exactly ONE module, so a
 * mirror has one thing to change rather than a search to run. And the built-in
 * is bound to the Supabase project its workspace runs on, so a clone pointed
 * at its own backend stops spending this identity on its own — resolving to
 * NO credential and a browse-only pricing page, which is the right answer when
 * the alternative is charging the wrong workspace.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  AURIXA_BILLING_UID_ENV,
  AURIXA_PRICING_BASE,
  pricingUrlFor,
  resolveAurixaBillingUid,
} from '../aurixaBillingIdentity';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'src');

/** This deployment's own identity, and the backend its workspace runs on. */
const OWN_UID = 'npc-prime';
const OWN_BACKEND_REF = 'dduzbchuswwbefdunfct';

/** The one module allowed to name it. */
const RESOLVER = join('src', 'lib', 'aurixaBillingIdentity.ts');
const THIS_SPEC = join('src', 'lib', '__tests__', 'aurixaBillingIdentity.spec.ts');

/**
 * Comments and string bodies removed, so a scan reads CODE.
 *
 * A character scanner rather than a regex, because both naive forms are wrong
 * on this very file: `//` appears inside `'https://www.aurixasystems.com.au'`,
 * and the resolver's own doc comment contains `import.meta.env[name]` as the
 * example of the form it forbids. A stripper that ate either would make the
 * assertions below pass on a live reintroduction.
 */
function code(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        out += src[i];
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('the billing uid is named in exactly one module', () => {
  const files = walk(SRC).map((f) => relative(REPO_ROOT, f));

  it('scans a plausible number of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('strips comments and string bodies without eating the code around them', () => {
    // Not vacuous: both naive strippers fail one of these.
    expect(code("const u = 'https://x/pricing'; // note")).toContain("https://x/pricing");
    expect(code('/* import.meta.env[name] */ const a = 1;')).not.toContain('import.meta.env');
    expect(code('const a = 1; // npc-prime')).not.toContain('npc-prime');
    expect(code('const a = "npc-prime";')).toContain('npc-prime');
  });

  it('is not inlined in any production module', () => {
    // Prose may name it — the defect is worth explaining. Code may not, and
    // test fixtures legitimately use it as a sample uid for something else.
    const naming = files.filter(
      (f) =>
        f !== RESOLVER &&
        !/\.(test|spec)\.[jt]sx?$/.test(f) &&
        code(readFileSync(join(REPO_ROOT, f), 'utf8')).includes(OWN_UID),
    );
    expect(naming, 'these modules inline the prime billing uid instead of resolving it').toEqual(
      [],
    );
  });

  it('the resolver does name it', () => {
    expect(readFileSync(join(REPO_ROOT, RESOLVER), 'utf8')).toContain(OWN_UID);
  });

  // The variable is read in exactly one place too. Two reads of one variable
  // are two rules — and the second one, in `useWorkspaceEntitlements`, carried
  // the same `?? "npc-prime"` literal, so a clone's cached entitlements were
  // keyed on the prime's handle.
  it('the environment variable is read in exactly one module', () => {
    const reading = files.filter(
      (f) =>
        f !== RESOLVER &&
        f !== THIS_SPEC &&
        code(readFileSync(join(REPO_ROOT, f), 'utf8')).includes(
          `import.meta.env.${AURIXA_BILLING_UID_ENV}`,
        ),
    );
    expect(reading, 'these files read the billing uid env var directly').toEqual([]);
  });

  // Vite substitutes the literal token sequence `import.meta.env.NAME` at build
  // time. A bracket or an optional chain between them is never replaced, and
  // reads `undefined` in a production bundle however the environment is set.
  it('reads it in the one form the bundler replaces', () => {
    const src = code(readFileSync(join(REPO_ROOT, RESOLVER), 'utf8'));
    expect(src).toContain(`import.meta.env.${AURIXA_BILLING_UID_ENV}`);
    expect(src).not.toMatch(/import\.meta\s*\?\.\s*env/);
    expect(src).not.toMatch(/import\.meta\.env\s*\[/);
  });
});

describe('resolveAurixaBillingUid precedence', () => {
  it('uses the configured uid when one is set, over the built-in', () => {
    const r = resolveAurixaBillingUid({
      configured: 'npc-client-dashboard',
      backendRef: OWN_BACKEND_REF,
    });
    expect(r).toEqual({ uid: 'npc-client-dashboard', source: 'env', warning: null });
  });

  it('trims a configured uid and ignores a blank one', () => {
    expect(resolveAurixaBillingUid({ configured: '  acme-corp  ' }).uid).toBe('acme-corp');
    expect(resolveAurixaBillingUid({ configured: '   ', backendRef: null }).uid).toBeNull();
  });

  it('uses the built-in for this deployment', () => {
    const r = resolveAurixaBillingUid({ backendRef: OWN_BACKEND_REF });
    expect(r).toEqual({ uid: OWN_UID, source: 'built-in', warning: null });
  });

  // The defect, stated as a test. `plisdzywzleljorrphxv` is the client
  // dashboard's own Supabase project.
  it('a build pointed at another project gets NOTHING, never this identity', () => {
    const r = resolveAurixaBillingUid({ backendRef: 'plisdzywzleljorrphxv' });
    expect(r.uid).toBeNull();
    expect(r.source).toBe('unset');
    expect(r.warning).toContain(AURIXA_BILLING_UID_ENV);
    expect(r.warning).toContain(OWN_BACKEND_REF);
  });

  it('a build whose backend cannot be identified gets nothing', () => {
    expect(resolveAurixaBillingUid({ backendRef: null }).uid).toBeNull();
  });

  it('a clone Mission Control HAS published to keeps its own identity', () => {
    // The healthy end state: the env wins whatever project the build talks to.
    const r = resolveAurixaBillingUid({
      configured: 'npc-client-dashboard',
      backendRef: 'plisdzywzleljorrphxv',
    });
    expect(r.uid).toBe('npc-client-dashboard');
    expect(r.warning).toBeNull();
  });

  it('a mirror that clears the built-in resolves to unset', () => {
    const r = resolveAurixaBillingUid({
      builtInUid: null,
      builtInBackendRef: null,
      backendRef: OWN_BACKEND_REF,
    });
    expect(r.uid).toBeNull();
    expect(r.warning).toContain(AURIXA_BILLING_UID_ENV);
  });
});

describe('pricingUrlFor', () => {
  it('carries the credential when there is one', () => {
    expect(pricingUrlFor('acme-corp')).toBe(`${AURIXA_PRICING_BASE}?uid=acme-corp`);
  });

  it('is the browse-only page when there is none — never a bare dangling ?', () => {
    expect(pricingUrlFor(null)).toBe(AURIXA_PRICING_BASE);
  });

  it('appends an action without losing the credential', () => {
    expect(pricingUrlFor('acme-corp', 'action=save-card')).toBe(
      `${AURIXA_PRICING_BASE}?uid=acme-corp&action=save-card`,
    );
  });

  it('carries an action with no credential, and still parses', () => {
    const url = new URL(pricingUrlFor(null, 'action=save-card'));
    expect(url.searchParams.get('action')).toBe('save-card');
    expect(url.searchParams.get('uid')).toBeNull();
  });

  it('encodes a uid that would otherwise break the query string', () => {
    expect(pricingUrlFor('a b&c=d')).toBe(`${AURIXA_PRICING_BASE}?uid=a%20b%26c%3Dd`);
  });
});
