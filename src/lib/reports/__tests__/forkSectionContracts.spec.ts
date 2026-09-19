/**
 * QA-27, QA-31, QA-32 — what a forked section may hold, read from its body.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyRiskEntry,
  riskDashboardContract,
  SEIFA_UNAVAILABLE_LINE,
  socioeconomicContract,
  splitRiskRegister,
} from '@/lib/reports/investment/forkSectionContracts.pure';

const REGISTER = `The overall investment risk for 291 Stone Mason Drive is best described as moderate.

### Consolidated Risk Register

This risk register summarises the main non-financial risks for the property.

Crime Risk - Level: Moderate - Confidence: Medium
- Why it matters: Crime levels influence tenant appeal and insurance costs.
- Required check: Obtain a recent crime statistics summary from BOCSAR.

Environmental Risk (Bushfire & Flood) - Level: Moderate - Confidence: High
- Why it matters: Kellyville sits within a bushfire region.
- Required check: Use the NSW RFS tools and council flood mapping.

Interest Rate & Serviceability Risk - Level: High - Confidence: Medium
- Why it matters: A 1% rise adds to the annual shortfall.
- Required check: Confirm capacity at a stressed rate with a broker.

Vacancy & Rent Risk - Level: Moderate - Confidence: Medium
- Why it matters: Two vacant weeks a year are assumed.

Estate Covenant Risk - Level: Low - Confidence: Medium
- Why it matters: Covenants may restrict extensions.
`;

describe('QA-31 — the risk register is split by what each entry is about', () => {
  it('gives the Financial variant only the money entries', () => {
    const fin = splitRiskRegister(REGISTER, 'financial');
    expect(fin.recognised).toBe(true);
    expect(fin.kept).toEqual(['Interest Rate & Serviceability Risk', 'Vacancy & Rent Risk']);
    expect(fin.dropped).toEqual(expect.arrayContaining(['Crime Risk', 'Environmental Risk (Bushfire & Flood)', 'Estate Covenant Risk']));
    expect(fin.body).not.toContain('non-financial risks');
    expect(fin.body).toContain('Interest Rate & Serviceability Risk - Level: High');
    expect(fin.body).toContain('- Required check: Confirm capacity at a stressed rate with a broker.');
    expect(fin.body).not.toContain('Crime');
  });

  it('gives the Due Diligence variant the property entries and the register\'s own preamble', () => {
    const dd = splitRiskRegister(REGISTER, 'due_diligence');
    expect(dd.kept).toEqual(['Crime Risk', 'Environmental Risk (Bushfire & Flood)', 'Estate Covenant Risk']);
    expect(dd.body).toContain('summarises the main non-financial risks');
    // The section's own lead sentence opens the Due Diligence register.
    expect(dd.body.startsWith('The overall investment risk for 291 Stone Mason Drive is best described as moderate.')).toBe(true);
    expect(splitRiskRegister(REGISTER, 'financial').body).not.toContain('best described as moderate');
    expect(dd.body).not.toContain('Vacancy & Rent Risk');
  });

  it('sends an entry nobody can classify to both variants, never to neither', () => {
    expect(classifyRiskEntry('Execution Risk')).toBe('both');
    const md = 'Execution Risk - Level: Low - Confidence: Low\n- Why it matters: timing.\n';
    expect(splitRiskRegister(md, 'financial').unclassified).toEqual(['Execution Risk']);
    expect(splitRiskRegister(md, 'due_diligence').kept).toEqual(['Execution Risk']);
  });

  it('splits a table register row by row and keeps the header for both', () => {
    const md = '| Risk | Level | Why it matters | Required check |\n| --- | --- | --- | --- |\n| Flood | Moderate | overland flow | AFRIP map |\n| Cashflow shortfall | High | negative | broker |\n';
    const fin = splitRiskRegister(md, 'financial');
    expect(fin.body).toContain('| Risk | Level | Why it matters | Required check |');
    expect(fin.body).toContain('| Cashflow shortfall |');
    expect(fin.body).not.toContain('| Flood |');
    expect(splitRiskRegister(md, 'due_diligence').body).toContain('| Flood |');
  });

  it('reports a body with no entries as unrecognised and leaves the caller to decide', () => {
    const r = splitRiskRegister('Just a paragraph of prose.\n', 'financial');
    expect(r.recognised).toBe(false);
    expect(r.body).toBe('');
  });
});

describe('QA-27 — a SEIFA heading needs a SEIFA index', () => {
  it('drops the promise and states the absence when no index is held', () => {
    const c = socioeconomicContract('Kellyville attracts professional households.', 'Socioeconomic Profile & SEIFA Interpretation');
    expect(c.heading).toBe('Socioeconomic Profile');
    expect(c.lead).toBe(SEIFA_UNAVAILABLE_LINE);
  });
  it('keeps the heading when an index with a figure is present', () => {
    const c = socioeconomicContract('| IRSAD | 1,087 | 9/10 |', 'Socioeconomic Profile & SEIFA Interpretation');
    expect(c.heading).toBe('Socioeconomic Profile & SEIFA Interpretation');
    expect(c.lead).toBeNull();
  });
});

describe('QA-32 — a checklist is named as one, with its status', () => {
  const checklist = `Legal, Title & Planning\n\n- Obtain a current title search.\n- Request a Section 10.7 Planning Certificate.\n- Review all easements with your solicitor.\n- Ask your solicitor to review the Contract for Sale.\n\nBuilding & Pest\n\n- Commission a combined building and pest inspection.\n`;
  it('renames a body of things to do and counts them', () => {
    const c = riskDashboardContract(checklist, 'Property & Location Risk Dashboard', 'Property & Location Due Diligence Checklist');
    expect(c.isChecklist).toBe(true);
    expect(c.heading).toBe('Property & Location Due Diligence Checklist');
    expect(c.checks).toBe(5);
    expect(c.status).toContain('5 checks listed, none recorded as completed');
  });
  it('keeps the dashboard heading for rated entries', () => {
    const c = riskDashboardContract(REGISTER, 'Property & Location Risk Dashboard', 'Property & Location Due Diligence Checklist');
    expect(c.isChecklist).toBe(false);
    expect(c.heading).toBe('Property & Location Risk Dashboard');
  });
});
