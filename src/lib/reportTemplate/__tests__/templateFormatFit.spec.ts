/**
 * A design that cannot carry a format's report is named before the document
 * is made, not after it exists.
 *
 * The 500 Investment Compass family masters are generated against each
 * format's own adapter vocabulary and fit by construction; the 43 voice
 * templates were authored against a sample preset, and six of them bind a
 * vocabulary no adapter publishes. Those six were offered as ordinary
 * choices, and the substitution that followed was announced by a toast raised
 * after the PDF already existed.
 */
import { describe, expect, it } from 'vitest';
import {
  assessTemplateFit,
  templateFitCaveat,
  FORMAT_PUBLISHED_NAMESPACES,
  FURNITURE_ONLY_NAMESPACES,
} from '../templateFormatFit.pure';
import { FURNITURE_NAMESPACES } from '../../../../supabase/functions/_shared/reports/templateBindingCoverage.pure';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

describe('the furniture set is one set', () => {
  it('matches the coverage measure’s, so the two cannot drift', () => {
    expect([...FURNITURE_ONLY_NAMESPACES].sort()).toEqual([...FURNITURE_NAMESPACES].sort());
  });
});

describe('what the Investment format publishes', () => {
  it('covers every namespace the projection actually produces', () => {
    // The declaration is judged against the projection's own output rather
    // than against a list somebody maintained: a renamed key fails here.
    const produced = Object.keys(projectInvestmentReport({
      property_address: '262 Pallas Street, Maryborough QLD 4650',
      property_specs: { bedrooms: 3, bathrooms: 1 },
      financial_calculations: { income: { weeklyRent: 500 } },
      investment_score: { totalScore: 54, grade: 'C+' },
      report_content: '## Executive Verdict\n\nA sentence.\n',
    }));
    const declared = new Set(FORMAT_PUBLISHED_NAMESPACES.investment);
    const missing = produced.filter((k) => !declared.has(k));
    expect(missing, `undeclared namespaces: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers every namespace the fifty Investment masters bind', () => {
    const bound = new Set<string>();
    for (const t of INVESTMENT_COMPASS_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_]+)[.\s|}]/g)) bound.add(m[1]);
    }
    const declared = new Set(FORMAT_PUBLISHED_NAMESPACES.investment);
    const foreign = [...bound].filter((n) => !declared.has(n)).sort();
    // A master binding something the format does not publish would be caveated
    // as foreign on its own format, which is exactly the false alarm rule 1
    // forbids.
    expect(foreign, `masters bind namespaces the format does not declare: ${foreign.join(', ')}`).toEqual([]);
  });
});

describe('reading a template’s declared bindings', () => {
  it('passes a design that speaks the format’s vocabulary', () => {
    const r = assessTemplateFit(
      ['property.address', 'financials.weeklyRent', 'org.name'],
      'investment',
    );
    expect(r.fit).toBe('carries');
    expect(templateFitCaveat(r, 'Investment')).toBeNull();
  });

  it('names a design authored for a different report', () => {
    // The First-Home Buyer voice template, verbatim: a vocabulary the
    // Investment adapter publishes none of.
    const r = assessTemplateFit(['grants.fhog', 'steps.0', 'prep.checklist', 'org.name'], 'investment');
    expect(r.fit).toBe('foreign_vocabulary');
    expect(r.foreign.sort()).toEqual(['grants', 'prep', 'steps']);
    const caveat = templateFitCaveat(r, 'Investment')!;
    expect(caveat).toMatch(/authored for a different report/);
    expect(caveat).toMatch(/grants/);
    // It says what choosing it means, because that is what is being consented to.
    expect(caveat).toMatch(/drawn from another published design/);
  });

  it('names a letterhead around nothing', () => {
    const r = assessTemplateFit(['org.name', 'brand.logo', 'report.generatedDate'], 'investment');
    expect(r.fit).toBe('furniture_only');
    expect(templateFitCaveat(r, 'Investment')).toMatch(/only page furniture/);
  });

  it('says nothing where it cannot be sure', () => {
    // Rule 1: a false caveat on a good design teaches people to dismiss the
    // warning, so every uncertain case is offered exactly as before.
    for (const [bindings, format] of [
      [[], 'investment'],
      [null, 'investment'],
      [['property.address'], 'a_format_nobody_declared'],
      [['property.address'], null],
      [['{{  }}'], 'investment'],
    ] as Array<[string[] | null, string | null]>) {
      const r = assessTemplateFit(bindings, format);
      expect(r.fit, `${JSON.stringify(bindings)} / ${format}`).toBe('unknown');
      expect(templateFitCaveat(r, 'Investment')).toBeNull();
    }
  });

  it('reads a namespace off whatever shape the declaration is in', () => {
    expect(assessTemplateFit(['{{ financials.annualRent | currency }}'], 'investment').fit).toBe('carries');
    expect(assessTemplateFit(['clientDetails.applicants.0.name'], 'client_details').fit).toBe('carries');
    expect(assessTemplateFit(['brief.summary'], 'client_details').fit).toBe('foreign_vocabulary');
  });
});
