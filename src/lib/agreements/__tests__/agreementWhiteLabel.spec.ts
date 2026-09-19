/**
 * No agreement may name a company the deployment did not configure.
 *
 * This product is sold to other agencies. Every party name, ABN, email, phone
 * and wordmark on a generated agreement has to come from that deployment's own
 * settings — and the failure mode is quiet, because a document that is wrong
 * in one line and right in every other does not look wrong.
 *
 * The audit that produced these tests found the founding tenant's identity in
 * three database column defaults (fixed in
 * `20260901001200_agreement_white_label_defaults.sql`) and nowhere in the code.
 * These tests hold the code side of that line: the locked content and the
 * field registry are checked for tenant literals, and an empty party name is
 * checked to print the template's own bracket rather than inherit a company
 * from somewhere.
 *
 * The other half of that guarantee moved when the download became the shipped
 * document rather than a render. The DOCX builder these tests used to exercise
 * is gone; `agreementTemplateFiles.spec.ts` now scans the whole shipped
 * package — body copy AND the Word metadata a builder never wrote — for the
 * same identity, which is a stronger check than the one it replaces.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agreementTemplate,
  projectFieldValues,
  substitutePlain,
  templateKeyForDirection,
  type AgreementTemplateKey,
} from '@/lib/agreements';

const KEYS: AgreementTemplateKey[] = ['strategic_property_referral', 'finance_referral_commission'];

/**
 * The founding tenant, in every form it appears in this repository's history.
 * A match on any of these inside the agreement path is a white-label leak.
 */
const TENANT_IDENTITY = [
  'Naidu',
  'NPC Services',
  'NPC Property',
  'npcservices',
  '50 684 555 771',
  '8609 3299',
  'admin@npcservices',
];

/** Modules that compose an agreement document. Comments count — a literal in
 *  a comment today is a literal in code after the next careless edit. */
const AGREEMENT_SOURCES = [
  'supabase/functions/_shared/agreements/contentStrategicReferral.pure.ts',
  'supabase/functions/_shared/agreements/contentFinanceReferral.pure.ts',
  'supabase/functions/_shared/agreements/fields.pure.ts',
  'supabase/functions/_shared/agreements/types.pure.ts',
  'supabase/functions/_shared/agreements/templateResource.pure.ts',
  'supabase/functions/_shared/agreements/documentHtml.pure.ts',
  'supabase/functions/_shared/agreements/templateFiles.pure.ts',
  'src/lib/agreements/templateDownloads.ts',
];

describe('the agreement path names no tenant', () => {
  for (const relative of AGREEMENT_SOURCES) {
    it(`${relative} carries no tenant identity`, () => {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      for (const needle of TENANT_IDENTITY) {
        expect(source).not.toContain(needle);
      }
    });
  }

  for (const key of KEYS) {
    it(`${key}: the locked content names no tenant`, () => {
      const serialised = JSON.stringify(agreementTemplate(key));
      for (const needle of TENANT_IDENTITY) {
        expect(serialised).not.toContain(needle);
      }
    });
  }
});

describe('an empty party name prints a bracket, not a company', () => {
  // This is the behaviour the migration relies on. `principal_legal_name`
  // defaulted to a company name; it now defaults to empty, which is only safe
  // because an empty value renders as the field's own placeholder.
  for (const key of KEYS) {
    it(`${key}: empty renders as the placeholder`, () => {
      expect(substitutePlain('{{ba_legal_name}}', key, { ba_legal_name: '' }))
        .toBe('<<INSERT>>');
      expect(substitutePlain('{{ba_legal_name}}', key, {}))
        .toBe('<<INSERT>>');
      expect(substitutePlain('{{ba_legal_name}}', key, { ba_legal_name: '   ' }))
        .toBe('<<INSERT>>');
    });
  }

  it('projects an empty register column as unset rather than blank text', () => {
    const key = templateKeyForDirection('inbound_property_referral');
    const values = projectFieldValues(key, {
      principal_legal_name: '',
      principal_trading_name: '',
      schedule_extras: {},
    } as never);
    expect(substitutePlain('{{ba_legal_name}}', key, values)).toBe('<<INSERT>>');
  });
});

/**
 * The PDF cover's band structure.
 *
 * `page-cover` is a zero-margin page — the design system reserves it for a
 * full-bleed treatment. This cover was written as ordinary flowed content and
 * inherited that page, so it rendered with every line hard against the paper's
 * edge, the title at report-cover scale four lines deep and running off the
 * page, and the whole cover spilling onto a second sheet. The three bands are
 * what supply the insets; asserting they are emitted is the cheap half of the
 * guard, and the render is the other half.
 */
describe('the PDF cover supplies its own page geometry', () => {
  it('emits a canvas, a paper band and a foot', async () => {
    const { buildAgreementDocument } = await import(
      '../../../../supabase/functions/_shared/agreements/documentHtml.pure.ts');
    const snapshot = {
      version: 1,
      company: { name: 'Harbourline Property Co', tradingName: 'Harbourline', abn: '11 222 333 444',
        website: '', email: '', phone: '', address: '' },
      brandHex: '#1F4D8F', preset: 'signature',
      logo: { report: null, mono: null },
      document: { confidentiality: '', preparedBy: 'Harbourline' },
      source: { whitelabelSettingId: null, themeVersion: 1, capturedAt: '2026-08-09T00:00:00Z' },
    };
    const { html } = buildAgreementDocument({
      content: agreementTemplate('strategic_property_referral') as never,
      values: {}, snapshot: snapshot as never, versionLabel: 'Draft', includeTemplatePack: true,
    } as never);

    for (const band of ['agc-cover-canvas', 'agc-cover-paper', 'agc-cover-foot']) {
      expect(html).toContain(band);
    }
    // Each band carries its own inset, so no cover line can sit on the trim.
    expect(html).toMatch(/\.agc-cover-canvas\s*\{[^}]*padding:/);
    expect(html).toMatch(/\.agc-cover-paper\s*\{[^}]*padding:/);
    expect(html).toMatch(/\.agc-cover-foot\s*\{[^}]*padding:/);
    // And the bands are height-bounded so the cover cannot spill to page two.
    expect(html).toMatch(/\.agc-cover\s*\{[^}]*height:\s*297mm/);
  });
});
