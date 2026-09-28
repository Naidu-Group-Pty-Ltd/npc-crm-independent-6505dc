import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every Resend email is sent as the deployment that sends it.
 *
 * These are source contracts for the same reason the white-labelling had to be
 * done at all: the fault is invisible from the deployment that commits it. A
 * clone that sends from the prime's address gets a 403 nobody reads. A clone
 * whose invite links into the prime's application gets an invite that looks
 * perfect. A clone named "Property Consulting" sends mail that arrives. Each of
 * these send sites kept working with the defect in it, so each has to be held
 * to the rule by reading it.
 *
 * The first test is the ratchet. A NEW Resend send site fails it until it is
 * classified: white-labelled through `emailIdentity.ts`, or, if it is password
 * recovery, deliberately left on `getBrandConfig()` as the owner decided.
 */

const FUNCTIONS = 'supabase/functions';

/** Sends that go out as the deployment: its name, its sender, its links. */
const WHITE_LABELLED = [
  '_shared/portal-notification-email.ts',
  'admin-user-management/index.ts',
  'aml-reliance/index.ts',
  'aml-step-up/index.ts',
  'client-portal-invite/index.ts',
  'finance-portal-invite/index.ts',
  'portal-book-appointment/index.ts',
  'report-qa/index.ts',
  'send-call-alert-email/index.ts',
  'send-weekly-call-report/index.ts',
  'solicitor-portal-invite/index.ts',
];

/**
 * Password recovery, excluded from the white-label work by the owner's
 * decision (24 Sep 2026). These still resolve their sender through
 * `getBrandConfig()`, which is what lets a clone send them at all.
 */
const PASSWORD_RECOVERY = [
  'admin-password-reset/index.ts',
  'client-portal-forgot-password/index.ts',
  'finance-portal-forgot-password/index.ts',
  'solicitor-portal-forgot-password/index.ts',
];

/** Mail a workflow author composes. Its From is theirs, defaulting to `RESEND_FROM_EMAIL`. */
const AUTHOR_COMPOSED = ['_shared/workflow/catalog/engagement.pure.ts'];

/** The four send sites that build a link into the application. */
const LINK_BUILDERS = [
  '_shared/portal-notification-email.ts',
  'client-portal-invite/index.ts',
  'finance-portal-invite/index.ts',
  'solicitor-portal-invite/index.ts',
];

const SENDS_THROUGH_RESEND = /api\.resend\.com\/emails|new Resend\(|\.emails\.send\(/;

/**
 * Literals that name the prime: its sender domain, its application, its
 * Lovable URL, the Lovable editor (the notifier's old fallback), and the
 * generic name every empty clone used to send under.
 */
const PRIME_LITERALS =
  /npcservices\.com\.au|npc-property-dashbord\.lovable\.app|app\.lovable\.dev|['"`]Property Consulting['"`]/;

const read = (relative: string) => readFileSync(join(FUNCTIONS, relative), 'utf8');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('every Resend send site is classified', () => {
  it('and there are no others', () => {
    const found = walk(FUNCTIONS)
      .filter((path) => SENDS_THROUGH_RESEND.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(FUNCTIONS.length + 1))
      .sort();
    expect(
      found,
      'A new Resend send site must be added to WHITE_LABELLED (and use emailIdentity.ts) — ' +
        'or to PASSWORD_RECOVERY, if that is what it is.',
    ).toEqual([...WHITE_LABELLED, ...PASSWORD_RECOVERY, ...AUTHOR_COMPOSED].sort());
  });
});

describe('white-labelled sends go out as the deployment', () => {
  for (const file of WHITE_LABELLED) {
    describe(file, () => {
      const source = read(file);

      it('takes its identity from emailIdentity.ts', () => {
        expect(source).toMatch(/from ["'](?:\.\.\/_shared|\.)\/emailIdentity\.ts["']/);
        expect(source).toContain('getEmailIdentity(');
      });

      it('addresses the email through resendAddressing, not a header of its own', () => {
        expect(source).toContain('resendAddressing(');
        expect(source, "brand-config's headers name nobody on a clone with empty settings").not.toMatch(
          /\.fromHeader(Admin|Notifications)?\b/,
        );
        expect(source).not.toMatch(/\bfrom:\s*[`'"]/);
      });

      it('names nothing that belongs to the prime', () => {
        expect(source.match(PRIME_LITERALS)?.[0] ?? null).toBeNull();
      });
    });
  }
});

describe("a link in a clone's email opens the clone", () => {
  for (const file of LINK_BUILDERS) {
    it(`${file} resolves its origin through linkOrigin`, () => {
      const source = read(file);
      expect(source).toContain('linkOrigin(identity');
      // The hard pin that sent every clone's finance partners and solicitors
      // into the prime's application.
      expect(source).not.toMatch(/https:\/\/command-centre\./);
    });
  }

  it("the AML public links follow the same rule and carry no prime origin", () => {
    const source = read('_shared/aml/directAcknowledgement.ts');
    expect(source).toContain('deploymentLinkOrigin(');
    expect(source).not.toMatch(/https:\/\/command-centre\./);
  });

  it('an invitation with no provisioned origin is refused before anything is written', () => {
    // Refusing after the token was stored would leave an invitation nobody
    // received; the guard has to come first in the invite action.
    const sections: Record<string, string> = {
      'client-portal-invite/index.ts': '// === SEND INVITE ===',
      'finance-portal-invite/index.ts': '// === SEND INVITE ===',
      'solicitor-portal-invite/index.ts': '// === INVITE / RESEND ===',
    };
    for (const [file, marker] of Object.entries(sections)) {
      const source = read(file);
      const section = source.slice(source.indexOf(marker));
      expect(source.indexOf(marker), file).toBeGreaterThan(-1);
      const guard = section.indexOf('if (!appUrl)');
      const firstWrite = section.search(/\.(insert|update|upsert)\(/);
      expect(guard, file).toBeGreaterThan(-1);
      expect(firstWrite, file).toBeGreaterThan(-1);
      expect(guard, `${file}: the guard must precede the first write`).toBeLessThan(firstWrite);
    }
  });
});

describe('the portal notifier decides the organisation itself', () => {
  it('takes no company name from its callers', () => {
    const source = read('_shared/portal-notification-email.ts');
    const iface = source.slice(source.indexOf('interface PortalNotificationEmail'));
    expect(iface.slice(0, iface.indexOf('}'))).not.toContain('companyName');
  });

  it('and no caller passes one', () => {
    for (const path of walk(FUNCTIONS)) {
      const source = readFileSync(path, 'utf8');
      if (!source.includes('sendPortalNotificationEmail(')) continue;
      expect(source, path).not.toMatch(/companyName:\s*(emailInfo|wl)/);
    }
  });
});

describe('password recovery is deliberately left alone', () => {
  for (const file of PASSWORD_RECOVERY) {
    it(`${file} still sends through getBrandConfig`, () => {
      const source = read(file);
      expect(source).toContain('getBrandConfig');
      expect(source).not.toContain('emailIdentity');
    });
  }

  it('brand-config.ts does not depend on the email identity', () => {
    // The identity reads brand-config for its sender; the reverse would make
    // the recovery path's behaviour depend on this module.
    expect(read('_shared/brand-config.ts')).not.toContain('emailIdentity');
  });
});
