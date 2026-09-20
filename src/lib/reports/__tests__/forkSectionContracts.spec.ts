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

/**
 * The Financial Analysis says, in a sentence this repository composes, that
 * "Property and locality risks (crime, environmental, planning, condition) are
 * assessed in the Property & Location Due Diligence Report and are not
 * restated here." Measured on the delivered PDF of 8b0c7c8d, page 14 then
 * opened its Consolidated Risk Register with an offence-mix row and page 15
 * carried seven planning, flood, bushfire and title actions.
 *
 * Both reached it through `both` — the deliberate default for an entry nobody
 * can classify — and both are classifiable. Measured over every risk register
 * in the stored Compass corpus (3 documents, 24 distinct entry names), these
 * two were the whole of it; `Supply and market concentration` and `Data gaps
 * and monitoring needs` are genuinely unclassifiable and still go to both.
 */
describe('a crime row and a checklist are not financial risks', () => {
  it('reads the offence vocabulary a register actually writes', async () => {
    const { classifyRiskEntry } = await import('@/lib/reports/investment/forkSectionContracts.pure');
    // The register does not write "crime" when it breaks crime down.
    expect(classifyRiskEntry('Offence mix (theft, assault, property damage)')).toBe('property');
    expect(classifyRiskEntry('Drug-related offences')).toBe('property');
    expect(classifyRiskEntry('Break-in and property damage')).toBe('property');
    // A name that trips BOTH vocabularies is still `both`, by design and not
    // by omission — "rate" is the word that does it most often, and nothing
    // here narrows that. `Burglary rates` is the shape: unclassifiable.
    expect(classifyRiskEntry('Burglary rates')).toBe('both');
    // And still answers the money side, and the genuinely ambiguous.
    expect(classifyRiskEntry('Interest rate sensitivity')).toBe('financial');
    expect(classifyRiskEntry('Supply and market concentration')).toBe('both');
    expect(classifyRiskEntry('Data gaps and monitoring needs')).toBe('both');
  });

  it('sends an unclassifiable checklist to due diligence and not to the money report', async () => {
    const { splitRiskRegister } = await import('@/lib/reports/investment/forkSectionContracts.pure');
    const body = [
      '### Due Diligence Actions',
      '',
      '- Order a current Section 10.7 planning certificate and check zoning and overlays.',
      '- Confirm whether the lot is mapped as bushfire-prone and obtain a BAL assessment.',
      '- Review flood mapping and obtain written insurance confirmation.',
      '- Inspect the dwelling for water ingress and ageing services.',
      '',
    ].join('\n');

    const fin = splitRiskRegister(body, 'financial');
    expect(fin.recognised).toBe(true);
    expect(fin.kept).toEqual([]);
    expect(fin.dropped).toContain('Due Diligence Actions');
    expect(fin.body).toBe('');

    const dd = splitRiskRegister(body, 'due_diligence');
    expect(dd.kept).toContain('Due Diligence Actions');
    expect(dd.body).toContain('Section 10.7');
  });

  it('keeps an unclassifiable entry that is NOT a checklist on both sides', async () => {
    const { splitRiskRegister } = await import('@/lib/reports/investment/forkSectionContracts.pure');
    const body = [
      '### Data gaps and monitoring needs',
      '',
      'Level: Moderate. Dwelling configuration is not recorded, so several readings below rest on the listing alone.',
      '',
    ].join('\n');
    for (const variant of ['financial', 'due_diligence'] as const) {
      const split = splitRiskRegister(body, variant);
      expect(split.kept, variant).toContain('Data gaps and monitoring needs');
    }
  });

  it('leaves a financial checklist on the financial side', async () => {
    const { splitRiskRegister } = await import('@/lib/reports/investment/forkSectionContracts.pure');
    // Classified by its name before the checklist rule is reached, so a
    // checklist about the money is not exiled to the other document.
    const body = [
      '### Loan and repayment checks',
      '',
      '- Confirm the rate and the interest-only term against the loan offer.',
      '- Review the lender’s serviceability assessment.',
      '- Check the break costs on the fixed portion.',
      '',
    ].join('\n');
    expect(splitRiskRegister(body, 'financial').kept).toContain('Loan and repayment checks');
    expect(splitRiskRegister(body, 'due_diligence').kept).toEqual([]);
  });
});
