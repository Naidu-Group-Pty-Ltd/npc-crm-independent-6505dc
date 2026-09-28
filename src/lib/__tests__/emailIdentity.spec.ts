import { describe, expect, it } from 'vitest';
import {
  deploymentKind,
  deploymentLinkOrigin,
  escapeHtml,
  formatMailbox,
  isPrimeOrigin,
  linkOrigin,
  PRIME_APP_ORIGIN,
  provisionedOrigin,
  resendAddressing,
  resolveEmailIdentity,
  UNNAMED_ORGANISATION,
  type EmailIdentityFacts,
} from '../../../supabase/functions/_shared/emailIdentity.pure';

/**
 * Who a deployment's email is from.
 *
 * The facts below are the four deployments as they stood on 24 Sep 2026: the
 * prime with its settings filled in, the NPC clone whose contact address
 * Mission Control once overwrote with its own sending mailbox, and three clones
 * whose settings tables are EMPTY and whose mail therefore came from "Property
 * Consulting".
 */

const PRIME_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const CLONE_URL = 'https://egrmsulhtmqnmhvuccxr.supabase.co';

const PRIME: EmailIdentityFacts = {
  supabaseUrl: PRIME_URL,
  senderAddress: 'admin@npcservices.com.au',
  provisionedSender: null,
  workspaceName: null,
  provisionedOrigins: [],
  contactDetails: {
    company_name: 'Naidu Property Consulting Services',
    email: 'admin@npcservices.com.au',
    phone: '02 8609 3299',
    website: 'www.npcservices.com.au',
  },
  whitelabel: {
    // The live row carries a trailing space.
    company_name: 'Naidu Property Consulting Services ',
    email_signature_email: 'admin@npcservices.com.au',
  },
};

const PREFLIGHT_SENDER = 'notifications@send.preflight-property-group.aurixasystems.com.au';
const PREFLIGHT: EmailIdentityFacts = {
  supabaseUrl: CLONE_URL,
  senderAddress: PREFLIGHT_SENDER,
  provisionedSender: PREFLIGHT_SENDER,
  workspaceName: 'Preflight Property Group',
  provisionedOrigins: [
    'https://preflight-property-group.aurixasystems.com.au',
    'https://preflight-property-group.aurixasystems.com.au',
    'https://preflight-property-group.aurixasystems.com.au',
  ],
  contactDetails: null,
  whitelabel: null,
};

const NPC_SENDER = 'notifications@send.npc.aurixasystems.com.au';
const NPC_CLONE: EmailIdentityFacts = {
  supabaseUrl: 'https://plisdzywzleljorrphxv.supabase.co',
  senderAddress: NPC_SENDER,
  provisionedSender: NPC_SENDER,
  workspaceName: 'NPC Client Dashboard',
  provisionedOrigins: ['https://npc.aurixasystems.com.au/'],
  contactDetails: {
    company_name: 'Naidu Property Consulting Services',
    // Written by Mission Control's sender alignment: the transport mailbox.
    email: NPC_SENDER,
    phone: '02 8609 3299',
  },
  whitelabel: {
    company_name: 'Naidu Property Consulting Services',
    email_signature_email: 'admin@npcservices.com.au',
  },
};

describe('which deployment this is', () => {
  it('is the prime only when SUPABASE_URL is the prime project', () => {
    expect(deploymentKind(PRIME_URL)).toBe('prime');
    expect(deploymentKind(CLONE_URL)).toBe('clone');
  });

  it('treats anything it cannot positively identify as a clone', () => {
    // A test harness, `supabase start` and a missing variable must never
    // reach a prime literal.
    for (const url of [null, undefined, '', 'not a url', 'http://kong:8000']) {
      expect(deploymentKind(url)).toBe('clone');
    }
  });
});

describe('the organisation an email is from', () => {
  it('names a clone with EMPTY settings by the name Mission Control provisioned', () => {
    const identity = resolveEmailIdentity(PREFLIGHT);
    expect(identity.organisationName).toBe('Preflight Property Group');
    expect(identity.organisationNameFrom).toBe('workspace');
    // The regression itself.
    expect(identity.organisationName).not.toBe(UNNAMED_ORGANISATION);
  });

  it("prefers the tenant's own settings to the workspace name", () => {
    const identity = resolveEmailIdentity({
      ...PREFLIGHT,
      whitelabel: { company_name: 'Preflight Property Group Pty Ltd' },
    });
    expect(identity.organisationName).toBe('Preflight Property Group Pty Ltd');
    expect(identity.organisationNameFrom).toBe('whitelabel');

    const fromReportSettings = resolveEmailIdentity({
      ...PREFLIGHT,
      contactDetails: { company_name: 'Preflight' },
      whitelabel: { company_name: 'Preflight Property Group Pty Ltd' },
    });
    expect(fromReportSettings.organisationName).toBe('Preflight');
    expect(fromReportSettings.organisationNameFrom).toBe('contact_details');
  });

  it('falls back to the generic word only when nothing names the organisation', () => {
    const identity = resolveEmailIdentity({ ...PREFLIGHT, workspaceName: '   ' });
    expect(identity.organisationName).toBe(UNNAMED_ORGANISATION);
    expect(identity.organisationNameFrom).toBe('unnamed');
  });
});

describe('the prime, which sets no RESEND_FROM_EMAIL', () => {
  const identity = resolveEmailIdentity(PRIME);

  it('sends exactly the headers brand-config always produced', () => {
    expect(resendAddressing(identity).from).toBe(
      'Naidu Property Consulting Services <admin@npcservices.com.au>',
    );
    expect(resendAddressing(identity, 'Admin').from).toBe(
      'Naidu Property Consulting Services Admin <admin@npcservices.com.au>',
    );
  });

  it('adds no Reply-To, because its sender is its contact', () => {
    expect(identity.replyTo).toBeNull();
    expect(resendAddressing(identity)).not.toHaveProperty('reply_to');
  });

  it('keeps its contact details for body copy', () => {
    expect(identity.contactEmail).toBe('admin@npcservices.com.au');
    expect(identity.contactPhone).toBe('02 8609 3299');
    expect(identity.contactWebsite).toBe('www.npcservices.com.au');
  });

  it('keeps the origin each call site always used', () => {
    expect(identity.cloneOrigin).toBeNull();
    expect(linkOrigin(identity, PRIME_APP_ORIGIN)).toBe(PRIME_APP_ORIGIN);
    expect(linkOrigin(identity, 'https://configured.example/')).toBe('https://configured.example');
  });
});

describe('a clone with its own domain-scoped key', () => {
  it('sends from the provisioned mailbox, under its own name', () => {
    const identity = resolveEmailIdentity(PREFLIGHT);
    const addressing = resendAddressing(identity, 'Admin');
    expect(addressing.from).toBe(`Preflight Property Group Admin <${PREFLIGHT_SENDER}>`);
    for (const value of Object.values(addressing)) {
      expect(value).not.toMatch(/npcservices|Property Consulting/);
    }
  });

  it('names no contact it was never given: never the prime mailbox, never the transport one', () => {
    const identity = resolveEmailIdentity(PREFLIGHT);
    expect(identity.contactEmail).toBeNull();
    expect(identity.replyTo).toBeNull();
    expect(resendAddressing(identity)).not.toHaveProperty('reply_to');
  });

  it("sends replies to the tenant's own contact address", () => {
    const identity = resolveEmailIdentity({
      ...PREFLIGHT,
      contactDetails: { email: 'hello@preflight.example' },
    });
    expect(identity.replyTo).toBe('hello@preflight.example');
    expect(resendAddressing(identity)).toEqual({
      from: `Preflight Property Group <${PREFLIGHT_SENDER}>`,
      reply_to: 'hello@preflight.example',
    });
  });

  it('skips a contact address that is really the transport mailbox (the NPC clone)', () => {
    const identity = resolveEmailIdentity(NPC_CLONE);
    expect(identity.contactEmail).toBe('admin@npcservices.com.au');
    expect(identity.replyTo).toBe('admin@npcservices.com.au');
    expect(identity.organisationName).toBe('Naidu Property Consulting Services');
  });

  it('opens its own application', () => {
    expect(resolveEmailIdentity(PREFLIGHT).cloneOrigin).toBe(
      'https://preflight-property-group.aurixasystems.com.au',
    );
    expect(resolveEmailIdentity(NPC_CLONE).cloneOrigin).toBe('https://npc.aurixasystems.com.au');
  });

  it("never falls back to the prime's origin, whatever the call site passes", () => {
    const identity = resolveEmailIdentity({ ...PREFLIGHT, provisionedOrigins: [] });
    expect(identity.cloneOrigin).toBeNull();
    expect(linkOrigin(identity, PRIME_APP_ORIGIN)).toBeNull();
  });
});

describe('the provisioned origin', () => {
  it('takes the first usable value, in order', () => {
    expect(provisionedOrigin([null, '', 'https://b.example/', 'https://c.example'])).toBe(
      'https://b.example',
    );
  });

  it("refuses the prime's own hosts, previews, localhost and junk", () => {
    expect(
      provisionedOrigin([
        'https://command-centre.npcservices.com.au',
        'https://npc-property-dashbord.lovable.app/',
        'https://preview--npc-test.lovable.app',
        'http://localhost:8080',
        'ftp://files.example',
        'not a url',
      ]),
    ).toBeNull();
  });

  it('keeps a path, because call sites append their own', () => {
    expect(provisionedOrigin(['https://host.example/app/'])).toBe('https://host.example/app');
  });

  it('recognises the prime hosts', () => {
    expect(isPrimeOrigin(PRIME_APP_ORIGIN)).toBe(true);
    expect(isPrimeOrigin('https://npc.aurixasystems.com.au')).toBe(false);
    expect(isPrimeOrigin(null)).toBe(false);
  });
});

describe('deploymentLinkOrigin, for a synchronous link builder', () => {
  it("keeps the prime's own choice on the prime", () => {
    expect(
      deploymentLinkOrigin({ supabaseUrl: PRIME_URL, provisionedOrigins: [] }, PRIME_APP_ORIGIN),
    ).toBe(PRIME_APP_ORIGIN);
  });

  it("gives a clone its own origin, or nothing — never the prime's", () => {
    expect(
      deploymentLinkOrigin(
        { supabaseUrl: CLONE_URL, provisionedOrigins: ['https://clone.example'] },
        PRIME_APP_ORIGIN,
      ),
    ).toBe('https://clone.example');
    expect(
      deploymentLinkOrigin({ supabaseUrl: CLONE_URL, provisionedOrigins: [] }, PRIME_APP_ORIGIN),
    ).toBeNull();
  });
});

describe('formatMailbox', () => {
  it('leaves a plain name unquoted', () => {
    expect(formatMailbox('Acme Property', 'a@b.example')).toBe('Acme Property <a@b.example>');
  });

  it('quotes a name that would otherwise read as two addresses', () => {
    expect(formatMailbox('Smith, Jones & Co.', 'a@b.example')).toBe(
      '"Smith, Jones & Co." <a@b.example>',
    );
  });

  it('cannot be used to inject a header or a second address', () => {
    const out = formatMailbox('Evil\r\nBcc: victim@x.example <x@y.example> "', 'a@b.example');
    expect(out).not.toMatch(/[\r\n]/);
    expect(out.match(/</g)).toHaveLength(1);
    expect(out.endsWith('<a@b.example>')).toBe(true);
  });

  it('sends the bare address when the name is empty', () => {
    expect(formatMailbox('  ', 'a@b.example')).toBe('a@b.example');
  });
});

describe('escapeHtml', () => {
  it('escapes what an HTML body cannot carry raw', () => {
    expect(escapeHtml(`Smith & Jones <"Co's">`)).toBe(
      'Smith &amp; Jones &lt;&quot;Co&#39;s&quot;&gt;',
    );
  });
});
