import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearBrandConfigCache } from '../../../supabase/functions/_shared/brand-config';
import {
  clearEmailIdentityCache,
  getEmailIdentity,
  resendAddressing,
} from '../../../supabase/functions/_shared/emailIdentity';

/**
 * The Deno half of the email identity: what it reads, and what it does when a
 * read fails. The rules themselves are pinned in `emailIdentity.spec.ts`.
 */

const REAL_DENO = (globalThis as { Deno?: unknown }).Deno;

function setEnv(vars: Record<string, string | undefined>) {
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => vars[k] } };
}

type Answer = { data: unknown; error: { message: string } | null };

/**
 * A client that answers the two settings tables. Every read is counted, so a
 * test can tell a cached identity from a fresh one.
 */
function fakeClient(tables: { contact?: Answer; whitelabel?: Answer }) {
  const reads: string[] = [];
  const contact = tables.contact ?? { data: null, error: null };
  const whitelabel = tables.whitelabel ?? { data: null, error: null };
  const client = {
    from(table: string) {
      reads.push(table);
      const answer = table === 'whitelabel_settings' ? whitelabel : contact;
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () => answer,
      };
      return chain;
    },
  };
  return { client, reads };
}

beforeEach(() => {
  clearBrandConfigCache();
  clearEmailIdentityCache();
});
afterEach(() => {
  clearBrandConfigCache();
  clearEmailIdentityCache();
  (globalThis as { Deno?: unknown }).Deno = REAL_DENO;
});

const CLONE_ENV = {
  SUPABASE_URL: 'https://umrtusxohxjxzodxorim.supabase.co',
  RESEND_FROM_EMAIL: 'notifications@send.npc-test.aurixasystems.com.au',
  MISSION_CONTROL_AGENCY_NAME: 'NPC Test',
  PUBLIC_APP_URL: 'https://npc-test.aurixasystems.com.au',
  APP_URL: 'https://npc-test.aurixasystems.com.au',
};

describe('getEmailIdentity on a clone with EMPTY settings', () => {
  it('reads the name, sender and origin Mission Control provisioned', async () => {
    setEnv(CLONE_ENV);
    const { client } = fakeClient({});
    const identity = await getEmailIdentity(client as never);

    expect(identity.deployment).toBe('clone');
    expect(identity.organisationName).toBe('NPC Test');
    expect(identity.senderAddress).toBe('notifications@send.npc-test.aurixasystems.com.au');
    expect(identity.cloneOrigin).toBe('https://npc-test.aurixasystems.com.au');
    expect(identity.contactEmail).toBeNull();
    expect(resendAddressing(identity, 'Admin')).toEqual({
      from: 'NPC Test Admin <notifications@send.npc-test.aurixasystems.com.au>',
    });
  });
});

describe('a settings read that FAILS', () => {
  it('is not mistaken for the prime, and is never cached', async () => {
    setEnv(CLONE_ENV);
    const { client, reads } = fakeClient({
      whitelabel: { data: null, error: { message: 'relation does not exist' } },
    });

    const first = await getEmailIdentity(client as never);
    expect(first.organisationName).toBe('NPC Test');
    expect(first.contactEmail).toBeNull();

    const before = reads.filter((t) => t === 'whitelabel_settings').length;
    await getEmailIdentity(client as never);
    const after = reads.filter((t) => t === 'whitelabel_settings').length;
    expect(after, 'a failed read must be retried, not served from cache').toBe(before + 1);
  });

  it('caches an identity whose reads succeeded', async () => {
    setEnv(CLONE_ENV);
    const { client, reads } = fakeClient({});
    await getEmailIdentity(client as never);
    const before = reads.length;
    await getEmailIdentity(client as never);
    expect(reads.length).toBe(before);
  });
});

describe('getEmailIdentity on the prime', () => {
  it('produces the header brand-config always produced', async () => {
    setEnv({ SUPABASE_URL: 'https://dduzbchuswwbefdunfct.supabase.co' });
    const { client } = fakeClient({
      contact: {
        data: {
          setting_key: 'contact_details',
          setting_value: {
            company_name: 'Naidu Property Consulting Services',
            email: 'admin@npcservices.com.au',
          },
        },
        error: null,
      },
      whitelabel: {
        data: { company_name: 'Naidu Property Consulting Services ' },
        error: null,
      },
    });
    const identity = await getEmailIdentity(client as never);
    expect(identity.deployment).toBe('prime');
    expect(resendAddressing(identity, 'Admin')).toEqual({
      from: 'Naidu Property Consulting Services Admin <admin@npcservices.com.au>',
    });
  });
});
