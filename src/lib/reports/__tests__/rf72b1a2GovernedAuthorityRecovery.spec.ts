import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  auditGovernedNarrativeAuthority,
  remediateGovernedNarrative,
  governedRemediatedFlag,
  governedFaultToFlag,
  governedAuthorityBlockFromFlags,
} from '../contract/governedNarrativeAuthority.pure';

/*
 * RF-7.2B.1A.2 — a report is REPAIRED, not withheld.
 *
 * The audit proved the more reliable control than the prompt. But "generated,
 * then blocked from the client" was never the product, so an unsupported
 * governed claim is now REMOVED and the document continues. The hard gate is
 * untouched: anything the remediator cannot clear still blocks.
 */

const absent = (name: string) => ({
  name, status: 'absent' as const, value: null, source: null, dataset: null,
  grain: null, geographyId: null, referencePeriod: null, asOf: null, ruling: 'withheld',
});
const present = (name: string, value: number) => ({
  ...absent(name), status: 'present' as const, value, source: 'abs_census_poa', ruling: 'trusted',
});
const snapshotOf = (facts: unknown[]) =>
  ({ capturedAt: '', assuranceVersion: '1', geography: { postcode: null }, facts }) as never;

const ALL_WITHHELD = snapshotOf([
  'market.demographics', 'market.population', 'market.medianAge',
  'market.medianHouseholdIncomeWeekly', 'market.medianRentWeekly',
  'market.medianMortgageMonthly', 'market.ownerOccupierRate',
  'abs.seifa.irsd', 'abs.seifa.irsad', 'abs.seifa.ier', 'abs.seifa.ieo',
  'abs.unemploymentRate', 'abs.labourForceParticipation', 'abs.labourForce',
  'abs.industryShare.mining',
].map(absent));

const CTX = { subjectPostcode: '2794' };
const audit = (t: string, s = ALL_WITHHELD) => auditGovernedNarrativeAuthority(t, s, CTX);
const fix = (t: string, s = ALL_WITHHELD) => remediateGovernedNarrative(t, s, CTX);

/** The whole lifecycle, exactly as both writers run it. */
function lifecycle(text: string, snap = ALL_WITHHELD) {
  let content = text;
  let faults = auditGovernedNarrativeAuthority(content, snap, CTX);
  const removed: unknown[] = [];
  if (faults.length > 0) {
    const p1 = remediateGovernedNarrative(content, snap, CTX);
    if (p1.changed) {
      content = p1.text; removed.push(...p1.removed);
      faults = auditGovernedNarrativeAuthority(content, snap, CTX);
    }
    if (faults.length > 0) {
      const p2 = remediateGovernedNarrative(content, snap, CTX, { disclose: false });
      if (p2.changed) {
        content = p2.text; removed.push(...p2.removed);
        faults = auditGovernedNarrativeAuthority(content, snap, CTX);
      }
    }
  }
  const flags = [
    ...removed.map((r) => governedRemediatedFlag(r as never)),
    ...faults.map(governedFaultToFlag),
  ];
  return { content, faults, removed, flags, block: governedAuthorityBlockFromFlags(flags) };
}

// ── 1-13: every unsupported form is removed, and the result is clean ─────────

describe('RF-7.2B.1A.2 — unsupported governed claims are removed, not delivered', () => {
  const cases: [string, string][] = [
    ['1 unsupported population figure', 'The area recorded 13,795 residents at the last count.'],
    ['2 unsupported median age', 'The median age of residents is 36 years.'],
    ['3 unsupported income', 'Median household income sits at $1,450 per week.'],
    ['4 unsupported unemployment', 'The unemployment rate is 4.2% across the postcode.'],
    ['5 unsupported participation', 'The labour-force participation rate is 61.3%.'],
    ['6 unsupported SEIFA', 'The SEIFA IRSD score for the area is 947.'],
    ['7 unsupported tenure percentage', 'Owner-occupiers make up 62% of dwellings in the area.'],
    ['8 fabricated demographic chart',
     '{{donut: Family households 50, Working couples 25, Older residents 25 | title=Occupant mix}}'],
    ['9 fabricated tenure/demand chart',
     '{{bars: Long‑term owner‑occupiers 8, Downsizers 4 | title=Indicative demand strength}}'],
    ['10 mixed valid + unsupported sentence',
     'The 988 m² block suits families, and the area has 13,795 residents.'],
    ['11 "public profiles" population language',
     'Public profiles describe Cowra as a town of around 10,000 residents with a predominance '
     + 'of detached houses, a meaningful share of owner-occupiers and a material rental sector.'],
    ['12 false ABS/Census attribution',
     'According to the Australian Bureau of Statistics 2021 Census, the area recorded 12,272 residents.'],
    ['13 cross-grain substitution',
     'At the wider SA2 level the median household income is $1,742 per week.'],
  ];

  for (const [label, text] of cases) {
    it(`${label} — blocked before, clean after, claim gone`, () => {
      expect(audit(text).length).toBeGreaterThan(0);
      const out = lifecycle(text);
      expect(out.faults).toHaveLength(0);
      expect(out.removed.length).toBeGreaterThan(0);
      expect(out.block.blocked).toBe(false);
    });
  }

  it('11 (production): the exact fabricated sentence does not survive', () => {
    const out = lifecycle(
      'Public profiles describe Cowra as a town of around 10,000 residents with a predominance '
      + 'of detached houses, a meaningful share of owner-occupiers and a material rental sector.',
    );
    expect(out.content).not.toContain('10,000 residents');
    expect(out.content).not.toContain('Public profiles describe');
  });

  it('10: a mixed sentence loses the WHOLE claim unit, not a salvaged half', () => {
    const out = lifecycle('The 988 m² block suits families, and the area has 13,795 residents.');
    expect(out.content).not.toContain('13,795');
    // The valid half is not preserved either — provenance could not be separated.
    expect(out.content).not.toContain('988 m² block suits families');
  });
});

// ── 14-17: legitimate content is untouched ──────────────────────────────────

describe('RF-7.2B.1A.2 — legitimate content is never touched', () => {
  const safe: [string, string][] = [
    ['14 legitimate subject-property figures',
     'The property was purchased for $555,000 on a 988 m² block and is leased at $445 per week.'],
    ['15 legitimate BOCSAR figures',
     "The postcode's recorded 1,144 criminal incidents in 2025 and a rate of 10,891 offences per "
     + '100,000 residents, compared with 7,598 per 100,000 across NSW, indicate a higher crime environment.'],
    ['16 legitimate qualitative commentary',
     'The home suits long-term family renters and owner-occupiers who value space and a quiet street.'],
    ['17 valid absence disclosure',
     'Population and demographic statistics for the specific 2794 postal area could not be '
     + 'established from authoritative sources, so no resident counts have been used in this report.'],
  ];
  for (const [label, text] of safe) {
    it(`${label} — never audited, never altered`, () => {
      expect(audit(text)).toHaveLength(0);
      const r = fix(text);
      expect(r.changed).toBe(false);
      expect(r.text).toBe(text);
    });
  }

  it('a clean document is returned byte-identical', () => {
    const doc = safe.map(([, t]) => t).join('\n\n');
    expect(fix(doc).text).toBe(doc);
  });

  it('remediation of one unit leaves every other unit byte-identical', () => {
    const doc = [
      '## 4. Local Market Context',
      'The property was purchased for $555,000 on a 988 m² block.',
      'Public profiles describe Cowra as a town of around 10,000 residents.',
      "The postcode's recorded 1,144 criminal incidents in 2025 indicate a higher crime environment.",
    ].join('\n\n');
    const out = lifecycle(doc);
    expect(out.content).toContain('## 4. Local Market Context');
    expect(out.content).toContain('purchased for $555,000 on a 988 m² block.');
    expect(out.content).toContain('1,144 criminal incidents in 2025');
    expect(out.content).not.toContain('10,000 residents');
    expect(out.faults).toHaveLength(0);
  });
});

// ── 18: the repair itself is clean and client-facing ────────────────────────

describe('RF-7.2B.1A.2 — post-remediation audit and client-facing wording', () => {
  it('18 post-remediation audit is clean and blocking is released', () => {
    const out = lifecycle('The area has 13,795 residents and a median age of 36.');
    expect(out.faults).toHaveLength(0);
    expect(out.block.blocked).toBe(false);
    expect(out.flags.every((f) => (f.value as Record<string, unknown>).blocking === false)).toBe(true);
  });

  it('the disclosure replaces the claim in place and states what the analysis rests on', () => {
    const out = lifecycle('The area has 13,795 residents.');
    expect(out.content).toMatch(/This analysis does not rely on postcode-level demographic statistics/);
    expect(out.content).not.toContain('13,795');
  });

  it('the disclosure never tells the client that data was unavailable', () => {
    // The owner's rule (14 Sep 2026): neither "N/A" nor "unavailable" reaches a
    // client document. Measured on the newest production reports (12 Sep
    // 2026), this sentence's previous wording — "was not available for this
    // analysis" — was the commonest "not available" a client saw.
    const out = lifecycle(
      'The area has 13,795 residents, a SEIFA score of 947 and an unemployment rate of 4.2%.',
    );
    expect(out.content).not.toMatch(/not available|unavailable|N\/A|not provided/i);
  });

  it('the disclosure carries no figure, so it can never be condemned itself', () => {
    const out = lifecycle('The area has 13,795 residents.');
    expect(out.content).not.toMatch(/\d/);
    expect(audit(out.content)).toHaveLength(0);
  });

  it('never leaks internal vocabulary to the client', () => {
    const out = lifecycle(
      'The area has 13,795 residents, a median age of 36, and a SEIFA score of 947. '
      + 'The unemployment rate is 4.2%.',
    );
    for (const leak of ['[REMOVED]', '[BLOCKED]', 'governed_authority', 'substituted_figure',
      'validation_flag', 'blocking', 'readiness', 'audit']) {
      expect(out.content).not.toContain(leak);
    }
  });

  it('one disclosure per category, never one per removed sentence', () => {
    const out = lifecycle([
      'The area has 13,795 residents.',
      'The median age of residents is 36 years.',
      'Median household income sits at $1,450 per week.',
    ].join(' '));
    const n = out.content.split('This analysis does not rely on postcode-level demographic statistics').length - 1;
    expect(n).toBe(1);
  });

  it('does not add a second copy of a disclosure the document already makes', () => {
    const already = 'This analysis does not rely on postcode-level demographic statistics; conclusions '
      + 'about the resident profile are drawn from the area\'s observed character and local '
      + 'market evidence.';
    const out = lifecycle(`${already}\n\nThe area has 13,795 residents.`);
    expect(out.content.split('This analysis does not rely on postcode-level demographic').length - 1).toBe(1);
  });

  it('a structural unit is deleted, and the disclosure finds a prose host', () => {
    const out = lifecycle(
      '{{donut: Family households 50, Older residents 25 | title=Mix}}\n\n'
      + 'The area has 13,795 residents.',
    );
    expect(out.content).not.toContain('{{donut');
    expect(out.content).toMatch(/This analysis does not rely on postcode-level demographic statistics/);
    expect(out.faults).toHaveLength(0);
  });

  it('a document of ONLY structural claims still discloses the gap', () => {
    const out = lifecycle('{{donut: Family households 50, Older residents 25 | title=Mix}}');
    expect(out.content).not.toContain('{{donut');
    expect(out.content).toMatch(/This analysis does not rely on postcode-level demographic statistics/);
    expect(out.faults).toHaveLength(0);
  });
});

// ── 19: remediation cannot introduce a prohibited figure ────────────────────

describe('RF-7.2B.1A.2 — the safety boundary is absolute', () => {
  it('19 a repair that still carried a prohibited figure would still block', () => {
    // The gate is read from the FLAGS, so a surviving fault still blocks even
    // when removals were recorded beside it.
    const flags = [
      governedRemediatedFlag({
        category: 'demographics', topic: 'population', kind: 'substituted_figure', excerpt: 'x',
      }),
      governedFaultToFlag({
        category: 'demographics', topic: 'medianAge', kind: 'substituted_figure',
        excerpt: 'the median age is 36', message: 'm',
      }),
    ];
    expect(governedAuthorityBlockFromFlags(flags).blocked).toBe(true);
  });

  it('a removal flag alone never blocks', () => {
    const flags = [governedRemediatedFlag({
      category: 'seifa', topic: 'seifaGeneral', kind: 'substituted_figure', excerpt: 'x',
    })];
    expect(governedAuthorityBlockFromFlags(flags).blocked).toBe(false);
  });

  it('the removal flag keeps the original claim for the audit trail', () => {
    const f = governedRemediatedFlag({
      category: 'demographics', topic: 'population', kind: 'substituted_figure',
      excerpt: 'the area has 13,795 residents',
    });
    const v = f.value as Record<string, unknown>;
    expect(v.excerpt).toBe('the area has 13,795 residents');
    expect(v.topic).toBe('population');
    expect(v.remediation).toBe('claim_removed');
    expect(v.readiness).toBe('remediated');
    expect(v.blocking).toBe(false);
  });

  it('remediation is a no-op when nothing is withheld', () => {
    const allPresent = snapshotOf([
      'market.demographics', 'market.population', 'market.medianAge',
      'market.medianHouseholdIncomeWeekly', 'market.medianRentWeekly',
      'market.medianMortgageMonthly', 'market.ownerOccupierRate',
      'abs.seifa.irsd', 'abs.seifa.irsad', 'abs.seifa.ier', 'abs.seifa.ieo',
      'abs.unemploymentRate', 'abs.labourForceParticipation', 'abs.labourForce',
      'abs.industryShare.mining',
    ].map((n) => present(n, 1)));
    const t = 'The area has 13,795 residents and a median age of 36.';
    const r = remediateGovernedNarrative(t, allPresent, CTX);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(t);
  });

  it('is bounded — two passes, and the second is deterministic removal only', () => {
    const src = readFileSync(resolve(__dirname,
      '../../../../supabase/functions/_shared/reports/contract/governedNarrativeAuthority.pure.ts'),
      'utf-8');
    // No model, no network, no loop inside the remediator.
    const fn = src.slice(src.indexOf('export function remediateGovernedNarrative'));
    expect(fn).not.toMatch(/\bfetch\b|\bawait\b|llmRouter|openai|perplexity/i);
    expect(fn).not.toMatch(/\bwhile\s*\(/);
  });
});

// ── the production call paths actually run it ───────────────────────────────

describe('RF-7.2B.1A.2 — both writers run the lifecycle, and store the repair', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '../../../../', p), 'utf-8');
  const gen = read('supabase/functions/generate-investment-report/index.ts');
  const regen = read('supabase/functions/regenerate-report-qualitative/index.ts');

  it('first generation remediates and re-audits', () => {
    expect(gen).toContain('remediateGovernedNarrative(');
    expect(gen).toContain('governedRemediatedFlag');
    expect(gen).toContain("{ disclose: false }");
  });

  it('first generation stores the REMEDIATED text', () => {
    const fixAt = gen.indexOf('reportContent = pass1.text');
    const writeAt = gen.indexOf('report_content: reportContent', fixAt);
    expect(fixAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(fixAt);
  });

  it('regeneration remediates and re-audits', () => {
    expect(regen).toContain('remediateGovernedNarrative(');
    expect(regen).toContain('governedRemediatedFlag');
    expect(regen).toContain("{ disclose: false }");
  });

  it('regeneration writes the repair back over the payload assigned earlier', () => {
    // `updatePayload.report_content` is set BEFORE the audit, so mutating
    // `combinedContent` alone would store the unrepaired document.
    expect(regen).toContain('updatePayload.report_content = combinedContent;');
    const assignAt = regen.indexOf('report_content: combinedContent');
    const rewriteAt = regen.indexOf('updatePayload.report_content = combinedContent;');
    expect(assignAt).toBeGreaterThan(-1);
    expect(rewriteAt).toBeGreaterThan(assignAt);
  });
});

// ── Production replay ────────────────────────────────────────────────────────
//
// Not a constructed case. This is the exact sentence a real production run
// wrote, taken byte-for-byte out of `investment_reports.validation_flags` on
// report 0ec278ea-9d35-4b27-a948-88572411241d (48 Redfern Street, Cowra NSW
// 2794), generated 2026-09-12 through the ordinary cron/resume worker AFTER
// the RF-7.2B.1A.1 precision fix had deployed.
//
// It is the whole arc in one document. A.1 took that report from ten governed
// flags, nine of them false, down to these TWO — and both are real: the model
// reached outside the governed sources for a population figure the snapshot
// does not hold, and attached a tenure claim to it. Under the code on `main`
// that is `blocking: true` and the client gets nothing. Under A.2 the claim
// comes out, the gap is disclosed, and the report is delivered.
//
// The U+2011 non-breaking hyphen in "owner‑occupiers" is verbatim: it is the
// character the model actually writes, and the recall hole A.1 closed.
describe('RF-7.2B.1A.2 — the real production fabrication, replayed', () => {
  const FABRICATION =
    'Public profiles describe Cowra as a town of around **10,000 residents** '
    + 'with a predominance of detached houses, a meaningful share of '
    + 'owner‑occupiers and a material rental sector.';

  const REPORT = [
    '## Demographic & Economic Profile',
    '',
    FABRICATION,
    '',
    'Population and demographic statistics for the specific 2794 postal area '
      + 'could not be established from authoritative sources, so no resident '
      + 'counts, age profiles, income medians or SEIFA scores have been used '
      + 'in this report.',
    '',
    'The property at 48 Redfern Street is a detached house on 988 m² of land, '
      + 'leased at $445 per week.',
    '',
    'BOCSAR records 1,144 offences per 100,000 residents for the Cowra local '
      + 'government area.',
  ].join('\n');

  it('blocks on `main` — two real faults, population and tenure', () => {
    const faults = audit(REPORT);
    expect(faults).toHaveLength(2);
    expect(faults.map((f) => f.topic).sort()).toEqual(['population', 'tenure']);
    expect(faults.every((f) => f.category === 'demographics')).toBe(true);
    expect(
      governedAuthorityBlockFromFlags(faults.map(governedFaultToFlag)).blocked,
    ).toBe(true);
  });

  it('delivers after remediation, with the fabrication gone', () => {
    const out = lifecycle(REPORT);
    expect(out.faults).toHaveLength(0);
    expect(out.removed).toHaveLength(2);
    expect(out.block.blocked).toBe(false);
    expect(out.content).not.toContain('10,000');
    expect(out.content).not.toContain('Public profiles describe Cowra');
  });

  it('replaces it with a disclosure and keeps every legitimate line', () => {
    const { content } = lifecycle(REPORT);
    expect(content).toContain('does not rely on postcode-level demographic statistics');
    // The model's own, correct absence disclosure is not touched.
    expect(content).toContain('could not be established from authoritative sources');
    // Subject-property measurements, its own tenancy, the crime evidence and
    // the heading all survive — these are the A.1 exemptions, still holding
    // once the remediator has run over the same document.
    expect(content).toContain('988 m²');
    expect(content).toContain('$445 per week');
    expect(content).toContain('1,144 offences');
    expect(content).toContain('## Demographic & Economic Profile');
  });

  it('leaks no internal vocabulary and no blank-line artefact', () => {
    const { content } = lifecycle(REPORT);
    expect(content).not.toMatch(
      /\[REMOVED\]|\[BLOCKED\]|governed_authority|substituted_figure|validation_flag|blocking/i,
    );
    expect(content).not.toMatch(/\n{3,}/);
  });
});
