/**
 * Three organisations, one engine, no leakage.
 *
 * Aurixa Systems is the reporting platform: it supplies the structure, the
 * analysis, the quality controls and the DEFAULT presentation. An organisation
 * using its white-label capability supplies its own name, marks, colour,
 * contact details and disclaimer, and those reach a document through
 * `whitelabel_settings` and `global_report_settings` exactly as they always
 * have. NPC Services is one such organisation - one customer's presentation of
 * the reports, not the engine's identity.
 *
 * The defect this pins: `companyBlock.pure.ts` carried its own fallback name,
 * the literal `'Property Consulting'` - which `issuerIdentity.pure.ts` already
 * lists among the names that are *the absence of a brand rather than a brand*.
 * So a deployment that had configured nothing printed "Aurixa Systems" on its
 * issuer line and "Property Consulting" in the running foot of every body page
 * and as the closing page's lockup. Two answers to one question, in one
 * document, neither of them chosen by anybody.
 *
 * ## The third organisation is synthetic
 *
 * `MERIDIAN` below is invented for this test. No other customer's name, ABN,
 * telephone number, address or mark appears anywhere in this file, and the
 * leakage assertions are what make that worth having: each organisation's
 * document is checked for the OTHER two's identities as well as for its own.
 */
import { describe, expect, it } from 'vitest';
import { buildReportBrandSnapshot } from '../snapshot.pure';
import { resolveSnapshotBrand } from '../documentBrand.pure';
import { FALLBACK_COMPANY_NAME } from '../companyBlock.pure';
import {
  PLATFORM_ISSUER_NAME,
  resolveReportDisclaimer,
  resolveReportIssuer,
} from '@/lib/reports/issuerIdentity.pure';

const AT = '2026-09-18T00:00:00.000Z';

/** The platform's own default: a deployment that has configured nothing. */
const AURIXA_DEFAULT = { capturedAt: AT };

/** NPC Services, as the prime deployment holds it. */
const NPC = {
  capturedAt: AT,
  whitelabel: { companyName: 'Naidu Property Consulting Services', brandColour: '43 74% 49%' },
  contact: {
    company_name: 'Naidu Property Consulting Services',
    phone: '02 8609 3299',
    website: 'www.npcservices.com.au',
  },
};

/** A second customer. Invented for this test; no real organisation. */
const MERIDIAN = {
  capturedAt: AT,
  whitelabel: { companyName: 'Meridian Property Partners', brandColour: '#2F6F4F' },
  contact: {
    company_name: 'Meridian Property Partners',
    phone: '03 5550 0100',
    website: 'meridian.example',
    abn: '11 222 333 444',
  },
};

const brandFor = (input: Parameters<typeof buildReportBrandSnapshot>[0]) =>
  resolveSnapshotBrand({ snapshot: buildReportBrandSnapshot(input).snapshot });

/** Everything a document prints an identity into, as one string. */
const printedIdentity = (input: Parameters<typeof buildReportBrandSnapshot>[0]): string => {
  const b = brandFor(input);
  const issuer = resolveReportIssuer({ companyName: input.contact?.company_name });
  return [
    b.masthead,
    b.company.name.lead,
    b.company.name.tail ?? '',
    ...b.company.rows.map((r) => `${r.label} ${r.value}`),
    b.company.disclaimer.paragraphs.join(' '),
    issuer.name,
    resolveReportDisclaimer(issuer).text,
  ].join(' ~ ');
};

describe('the platform default', () => {
  it('issues under the platform name, in every place a name is printed', () => {
    const b = brandFor(AURIXA_DEFAULT);
    expect(b.masthead).toBe(PLATFORM_ISSUER_NAME);
    expect([b.company.name.lead, b.company.name.tail].filter(Boolean).join(' '))
      .toBe(PLATFORM_ISSUER_NAME.toUpperCase());
  });

  it('the fallback and the issuer line are ONE name, not two', () => {
    // The whole defect in one assertion.
    expect(FALLBACK_COMPANY_NAME).toBe(PLATFORM_ISSUER_NAME);
    expect(resolveReportIssuer({}).name).toBe(FALLBACK_COMPANY_NAME);
  });

  it('never prints a placeholder that the issuer module calls a non-identity', () => {
    const printed = printedIdentity(AURIXA_DEFAULT);
    for (const placeholder of ['Property Consulting', 'Dashboard', 'Property Report']) {
      expect(printed, placeholder).not.toContain(placeholder);
    }
  });

  it('carries no customer identity at all', () => {
    const printed = printedIdentity(AURIXA_DEFAULT);
    for (const leak of ['NPC', 'Naidu', 'npcservices', '8609', 'Meridian', 'meridian.example']) {
      expect(printed, leak).not.toContain(leak);
    }
  });

  it('a row still holding a placeholder is treated as unconfigured, not printed', () => {
    // A restored backup, a hand-edited settings row or a copied clone can put
    // one back into the database, and a placeholder read out of a row is the
    // same false masthead as a placeholder read out of code.
    for (const stale of ['Property Consulting', 'dashboard', 'NPC']) {
      const b = brandFor({ capturedAt: AT, contact: { company_name: stale } });
      expect(b.masthead, stale).toBe(PLATFORM_ISSUER_NAME);
    }
  });

  it('prints the platform disclaimer, which an unidentified deployment cannot switch off', () => {
    const issuer = resolveReportIssuer({});
    expect(issuer.kind).toBe('platform');
    const off = resolveReportDisclaimer(issuer, { is_enabled: false });
    expect(off.source).toBe('platform');
    expect(off.text).toContain(PLATFORM_ISSUER_NAME);
  });
});

describe('NPC Services - one organisation using the white-label capability', () => {
  it('prints its own name, not the platform name', () => {
    const b = brandFor(NPC);
    expect(b.masthead).toBe('Naidu Property Consulting Services');
    expect(resolveReportIssuer({ companyName: NPC.contact.company_name }).kind).toBe('workspace');
  });

  it('its gold is its own - the engine resolves a tenant colour, it does not assume one', () => {
    expect(buildReportBrandSnapshot(NPC).snapshot.brandHex).toBe('#D9A520');
    // A deployment that configured no colour carries none, so nothing
    // downstream can mistake one organisation's brand for the default.
    expect(buildReportBrandSnapshot(AURIXA_DEFAULT).snapshot.brandHex).toBeNull();
  });

  it('carries none of the platform identity and none of the other organisation', () => {
    const printed = printedIdentity(NPC);
    expect(printed).toContain('Naidu Property Consulting Services');
    for (const leak of ['Meridian', 'meridian.example', '5550 0100']) {
      expect(printed, leak).not.toContain(leak);
    }
    // Aurixa is named in the workspace disclaimer only where the workspace has
    // no wording of its own, and never as the issuer.
    expect(resolveReportIssuer({ companyName: NPC.contact.company_name }).name)
      .not.toBe(PLATFORM_ISSUER_NAME);
  });
});

describe('a second organisation renders as itself', () => {
  it('prints its own name, contact rows and colour', () => {
    const b = brandFor(MERIDIAN);
    expect(b.masthead).toBe('Meridian Property Partners');
    expect(buildReportBrandSnapshot(MERIDIAN).snapshot.brandHex).toBe('#2F6F4F');
    expect(b.company.rows.map((r) => r.value).join(' ')).toContain('03 5550 0100');
  });

  it('carries nothing of the other customer, and nothing of the platform', () => {
    const printed = printedIdentity(MERIDIAN);
    expect(printed).toContain('Meridian Property Partners');
    for (const leak of ['NPC', 'Naidu', 'npcservices', '8609 3299', '#D9A520']) {
      expect(printed, leak).not.toContain(leak);
    }
  });

  it('its own disclaimer wins; the platform one is never appended to it', () => {
    const issuer = resolveReportIssuer({ companyName: MERIDIAN.contact.company_name });
    const stored = { text: 'Meridian Property Partners is licensed in Victoria.', is_enabled: true };
    const resolved = resolveReportDisclaimer(issuer, stored);
    expect(resolved.source).toBe('stored');
    expect(resolved.text).toBe(stored.text);
    expect(resolved.text).not.toContain(PLATFORM_ISSUER_NAME);
  });
});

describe('the three render as three', () => {
  it('no two of them share a masthead', () => {
    const mastheads = [AURIXA_DEFAULT, NPC, MERIDIAN].map((o) => brandFor(o).masthead);
    expect(new Set(mastheads).size).toBe(3);
  });

  it('house cover art is never a white-label fallback', () => {
    // `documentBrand.pure.ts` records why: `NPC_HOUSE_COVER_ART` is not a
    // photograph, it is a finished cover with a company name burned into the
    // pixels. A tenant with none gets the typographic cover, which is a
    // designed state rather than a gap.
    for (const org of [AURIXA_DEFAULT, MERIDIAN]) {
      const b = brandFor(org);
      expect(b.heroDataUri).toBeNull();
      // The lockup is still drawn - it is the organisation's own wordmark, set
      // from its own name - but it carries no inherited MARK.
      expect(b.lockup?.markDataUri ?? null).toBeNull();
    }
  });
});
