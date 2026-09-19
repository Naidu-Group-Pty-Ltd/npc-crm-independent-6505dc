/**
 * Stage 4 — who a report is issued BY, and the disclaimer that party may speak.
 *
 * Every fixture here is a value the production renderer actually printed, taken
 * from a render of `6 Acer Court, Bowral NSW 2576` on 2026-09-08 with the
 * settings a freshly provisioned clone holds — no white-label brand, no report
 * contact company name, the seeded `professional_disclaimer` row.
 *
 * One report of one property carried three businesses that are not the issuer:
 * `NPC` tiled across every body page as the watermark, `NPC Property` as the
 * PDF's `Author`, and `PROPERTY CONSULTING` — a name no business holds — on the
 * back-page masthead. The fourth copy was the disclaimer itself: the prime's own
 * buyer's-agent wording, defaulted in `useGlobalReportSettings`.
 *
 * The rule under test: **an identity and its disclaimer travel together**, and
 * there are exactly two issuers.
 */
import { describe, expect, it } from 'vitest';

import {
  PLATFORM_DISCLAIMER,
  PLATFORM_ISSUER_NAME,
  WORKSPACE_DEFAULT_DISCLAIMER,
  resolveReportDisclaimer,
  resolveReportIssuer,
} from '../issuerIdentity.pure';

/** The prime's own wording, verbatim from `global_report_settings`. */
const NPC_DISCLAIMER =
  'As a Professional Property Consultant & Buyers Agent, we provide information '
  + 'and advice based on our expertise and experience in the real estate market.';

describe('resolveReportIssuer', () => {
  it('issues under the workspace name when it has one', () => {
    const issuer = resolveReportIssuer({ companyName: 'Naidu Property Consulting Services' });
    expect(issuer).toEqual({ name: 'Naidu Property Consulting Services', kind: 'workspace' });
  });

  it('falls back to the white-label brand name', () => {
    expect(resolveReportIssuer({ companyName: '', brandName: 'Harcourts Bowral' }))
      .toEqual({ name: 'Harcourts Bowral', kind: 'workspace' });
  });

  it('prefers the report contact name over the brand name, as every surface already did', () => {
    expect(resolveReportIssuer({ companyName: 'Contact Co', brandName: 'Brand Co' }).name)
      .toBe('Contact Co');
  });

  it('issues under the platform when the workspace has said nothing', () => {
    expect(resolveReportIssuer({})).toEqual({ name: PLATFORM_ISSUER_NAME, kind: 'platform' });
    expect(resolveReportIssuer({ companyName: '   ', brandName: null }).kind).toBe('platform');
  });

  it('never issues under an invented trading name', () => {
    // The four placeholders the report path used to fall through to. Listed
    // rather than merely deleted from the call sites: a restored backup or a
    // hand-edited settings row can put one back into the database.
    for (const invented of ['Property Consulting', 'Property Report', 'NPC', 'NPC Property']) {
      const issuer = resolveReportIssuer({ companyName: invented });
      expect(issuer.kind, invented).toBe('platform');
      expect(issuer.name, invented).toBe(PLATFORM_ISSUER_NAME);
    }
  });

  it('treats the brand store default "Dashboard" as no brand at all', () => {
    // The same set `submissionRecordBrand` refuses, deliberately kept in step:
    // a document and its compliance record must not disagree about the issuer.
    expect(resolveReportIssuer({ brandName: 'Dashboard' }).kind).toBe('platform');
  });

  it('never returns an empty name', () => {
    for (const input of [{}, { companyName: '' }, { companyName: null, brandName: undefined }]) {
      expect(resolveReportIssuer(input).name.trim()).not.toBe('');
    }
  });
});

describe('the disclaimer follows the issuer', () => {
  const WORKSPACE = resolveReportIssuer({ companyName: 'Naidu Property Consulting Services' });
  const PLATFORM = resolveReportIssuer({});

  it('prints a named business its own configured wording', () => {
    const out = resolveReportDisclaimer(WORKSPACE, { text: NPC_DISCLAIMER, is_enabled: true });
    expect(out).toEqual({ text: NPC_DISCLAIMER, source: 'stored' });
  });

  it('prints a named business with nothing configured the neutral default', () => {
    // Verbatim the literal `render-investment-report-pdf` already fell through
    // to, so a branded deployment's document does not move.
    expect(resolveReportDisclaimer(WORKSPACE, { text: '' }).text).toBe(WORKSPACE_DEFAULT_DISCLAIMER);
    expect(resolveReportDisclaimer(WORKSPACE, null).source).toBe('workspace_default');
  });

  it('honours a named business switching its disclaimer off', () => {
    expect(resolveReportDisclaimer(WORKSPACE, { text: NPC_DISCLAIMER, is_enabled: false }))
      .toEqual({ text: '', source: 'disabled' });
  });

  it('prints the platform wording under the platform name, whatever is stored', () => {
    // This is the case a better DEFAULT would not have fixed. A clone seeded
    // from the prime carries the prime's text in the row, so no default ever
    // fires. The switch is on the read, keyed on the resolved issuer.
    const out = resolveReportDisclaimer(PLATFORM, { text: NPC_DISCLAIMER, is_enabled: true });
    expect(out).toEqual({ text: PLATFORM_DISCLAIMER, source: 'platform' });
  });

  it('will not let an unidentified deployment switch the platform disclaimer off', () => {
    expect(resolveReportDisclaimer(PLATFORM, { text: '', is_enabled: false }).source).toBe('platform');
  });
});

describe('the platform disclaimer says what the platform is', () => {
  it('never claims to be a property or financial adviser', () => {
    // The clauses that made the consultancy wording false under this masthead.
    // Matched case-insensitively on the SUBSTANCE rather than the sentence, so
    // a rewording that reintroduces the claim still fails.
    for (const claim of [
      /\bwe provide\b/i,
      /\bour services\b/i,
      /\bby engaging (our|us)\b/i,
      /\bour (expertise|experience)\b/i,
      /\bnegotiat\w* purchase\b/i,
    ]) {
      expect(PLATFORM_DISCLAIMER, String(claim)).not.toMatch(claim);
    }
  });

  it('disclaims the licensed CATEGORY, not merely the responsibility', () => {
    // Saying only "accepts no responsibility" leaves the category claim
    // standing, and the category claim is the licensing one: acting as or
    // holding out as a real estate or buyer's agent is licensed conduct in
    // every Australian state.
    expect(PLATFORM_DISCLAIMER).toMatch(/not a real estate agent/i);
    expect(PLATFORM_DISCLAIMER).toMatch(/buyer's agent/i);
    expect(PLATFORM_DISCLAIMER).toMatch(/licensed valuer/i);
    expect(PLATFORM_DISCLAIMER).toMatch(/does not provide financial product, credit, taxation or legal advice/i);
    expect(PLATFORM_DISCLAIMER).toMatch(/not a party to any property transaction/i);
  });

  it('does not extinguish the operator\'s own obligations to the reader', () => {
    // A platform disclaimer that appeared to wipe out the rights of a reader
    // against the business that handed them the report would be a worse
    // document than the one it replaces.
    expect(PLATFORM_DISCLAIMER).toMatch(/does not limit the obligations of the business that provided this report to you/i);
  });

  it('says a projection is not a forecast', () => {
    expect(PLATFORM_DISCLAIMER).toMatch(/assumptions are not predictions/i);
  });

  it('sends the reader to independent advice', () => {
    expect(PLATFORM_DISCLAIMER).toMatch(/independent advice from appropriately licensed or qualified professionals/i);
  });

  it('names no tenant but the platform', () => {
    expect(PLATFORM_DISCLAIMER).not.toMatch(/naidu|npcservices|\bNPC\b/i);
    expect(PLATFORM_DISCLAIMER).toContain(PLATFORM_ISSUER_NAME);
  });

  it('is paragraphed, so the renderer\'s blank-line split produces a readable page', () => {
    // `render-investment-report-pdf` splits on blank lines and wraps each in a
    // `<p>`; one 250-word block would print as a single grey slab.
    expect(PLATFORM_DISCLAIMER.split(/\n\s*\n/).length).toBe(5);
  });
});
