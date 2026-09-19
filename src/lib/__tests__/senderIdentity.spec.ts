import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearBrandConfigCache,
  getBrandConfig,
  resolveSenderEmail,
} from '../../../supabase/functions/_shared/brand-config';

/**
 * The from-header is a credential, not a preference.
 *
 * A clone provisioned by Mission Control holds a Resend key that is
 * `sending_access`-scoped to ONE domain — `send.<clone-fqdn>`. Anything it
 * hands Resend as a `from` on another domain is refused outright. So the
 * address is not a display choice the tenant happens to make; it is the other
 * half of the key, and this file pins that it is resolved as one.
 *
 * The failure these tests exist for, measured on the first clone
 * (`npc-client-dashboard`): `send.npc.aurixasystems.com.au` was registered,
 * DNS-installed, verified by Resend and had a scoped key written to the
 * clone — and every password-recovery mail answered 403, because
 * `global_report_settings` was EMPTY, so the sender fell through to the
 * hard-coded `noreply@npcservices.com.au`, an address in a Resend account this
 * deployment does not hold.
 */

const REAL_DENO = (globalThis as { Deno?: unknown }).Deno;

function setEnv(vars: Record<string, string | undefined>) {
  (globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => vars[k] },
  };
}

/** A settings table with no `contact_details` row — a freshly provisioned clone. */
function emptySettings() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  };
}

function settingsWith(contact: Record<string, string>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { setting_value: contact }, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => clearBrandConfigCache());
afterEach(() => {
  clearBrandConfigCache();
  (globalThis as { Deno?: unknown }).Deno = REAL_DENO;
  vi.restoreAllMocks();
});

describe('resolveSenderEmail', () => {
  it('prefers the deployment\'s own verified sender over anything configured', () => {
    setEnv({ RESEND_FROM_EMAIL: 'notifications@send.npc.aurixasystems.com.au' });
    // Even a perfectly reasonable configured address loses: the key in use
    // cannot send from it, so preferring it would mean preferring a 403.
    expect(resolveSenderEmail('hello@tenant-brand.com.au', 'noreply@npcservices.com.au')).toBe(
      'notifications@send.npc.aurixasystems.com.au',
    );
  });

  it('falls back to the configured address, then the legacy one', () => {
    setEnv({});
    expect(resolveSenderEmail('hello@tenant-brand.com.au', 'noreply@npcservices.com.au')).toBe(
      'hello@tenant-brand.com.au',
    );
    expect(resolveSenderEmail('   ', 'noreply@npcservices.com.au')).toBe(
      'noreply@npcservices.com.au',
    );
  });

  it('ignores an unparseable value rather than sending to a 422', () => {
    setEnv({ RESEND_FROM_EMAIL: 'not-an-address' });
    expect(resolveSenderEmail('hello@tenant-brand.com.au', 'noreply@npcservices.com.au')).toBe(
      'hello@tenant-brand.com.au',
    );
  });
});

describe('getBrandConfig — a clone with its own domain-scoped key', () => {
  const SENDER = 'notifications@send.npc.aurixasystems.com.au';

  it('sends from the verified domain even when the settings table is EMPTY', async () => {
    // The exact production state: zero rows in global_report_settings.
    setEnv({ RESEND_FROM_EMAIL: SENDER });
    const brand = await getBrandConfig(emptySettings() as never);

    for (const header of [
      brand.fromHeader,
      brand.fromHeaderAdmin,
      brand.fromHeaderNotifications,
    ]) {
      expect(header).toContain(SENDER);
      // The regression itself: the prime's legacy domain must not appear in a
      // from-header on a deployment whose key cannot send from it.
      expect(header).not.toContain('npcservices.com.au');
    }
    expect(brand.senderEmail).toBe(SENDER);
  });

  it('keeps the CONTACT address the tenant\'s own', async () => {
    setEnv({ RESEND_FROM_EMAIL: SENDER });
    const brand = await getBrandConfig(
      settingsWith({ company_name: 'Acme Property', email: 'hello@acme.example' }) as never,
    );
    // Who to reply to and which mailbox the transport used are different
    // questions; collapsing them is what caused the outage.
    expect(brand.contactEmail).toBe('hello@acme.example');
    expect(brand.senderEmail).toBe(SENDER);
    expect(brand.fromHeader).toBe(`Acme Property <${SENDER}>`);
  });
});

describe('getBrandConfig — the prime, which sets no RESEND_FROM_EMAIL', () => {
  it('behaves exactly as before', async () => {
    setEnv({});
    const brand = await getBrandConfig(
      settingsWith({
        company_name: 'Naidu Property Consulting Services',
        email: 'admin@npcservices.com.au',
      }) as never,
    );
    expect(brand.fromHeader).toBe(
      'Naidu Property Consulting Services <admin@npcservices.com.au>',
    );
    expect(brand.contactEmail).toBe('admin@npcservices.com.au');
  });

  it('still falls back to the legacy sender when nothing is configured', async () => {
    setEnv({});
    const brand = await getBrandConfig(emptySettings() as never);
    expect(brand.fromHeader).toBe('Property Consulting <noreply@npcservices.com.au>');
  });
});
