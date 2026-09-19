/**
 * RF-7.1 — golden-master parity, against real production rows.
 *
 * The question this answers is NOT "is the contract internally correct?" —
 * `reportFactContract.spec.ts` asks that, on fixtures, in CI, forever. This
 * asks the only question that can retire the preservation risk:
 *
 *   **does the contract say what the platform already says?**
 *
 * A new canonical layer that disagrees with the shipped one is not a truth
 * layer, it is a second opinion. So for every material fact this walks the
 * CURRENT path — the canonical owner exactly as production calls it today —
 * and the CONTRACT path, and requires them to agree or to be an explained
 * exception recorded in `REPORT_FACT_CONTRACT_V1.md`.
 *
 * ## Why the corpus is not in the repository
 *
 * These rows are real clients' finances. The corpus lives in the operator's
 * scratchpad and the harness is skipped without it — the same arrangement
 * `corpusReplayV2.spec.ts` uses, for the same reason. What ships is the
 * aggregate: counts, match rates and the explained exceptions, with no
 * client's figures in them.
 *
 *   RF71_PARITY_CORPUS=/path/rows.json npx vitest run reportFactContractParity
 *
 * The corpus is a JSON array of `investment_reports` rows, each carrying its
 * matching `report_geography` row as `geography`. `RF71_PARITY_OUT` writes the
 * ledger.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildReportFactContract,
  factLeaves,
  REPORT_FACT_CONTRACT_VERSION,
} from '@/lib/reports/contract/reportFactContract.pure';
import { reconcileStoredFinancials } from '@/lib/reports/investment/financialEngine.pure';
import { readPropertyFacts } from '@/lib/reports/investment/propertyRecord.pure';
import {
  grossYield,
  netYield,
  originationLvr,
} from '../../../../supabase/functions/_shared/reports/metrics/propertyMetrics.pure';

const CORPUS = process.env.RF71_PARITY_CORPUS ?? '';
const OUT = process.env.RF71_PARITY_OUT ?? '';
const present = CORPUS.length > 0 && existsSync(CORPUS);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const at = (root: unknown, path: readonly string[]): unknown => {
  let cur: unknown = root;
  for (const k of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/**
 * The CURRENT path for each material fact — the canonical owner called the way
 * production calls it today.
 *
 * Written against the owners rather than re-derived here: if this file did its
 * own arithmetic the ledger would compare the contract against a third
 * implementation, which proves nothing about what a client is shown.
 */
function currentPath(row: Record<string, unknown>): Record<string, unknown> {
  const { fin } = reconcileStoredFinancials(row.financial_calculations);
  const ovr = isRecord(row.manual_overrides) ? row.manual_overrides : {};
  const geo = isRecord(row.geography) ? row.geography : null;

  // `historicalFactAuthority`'s measured precedence: the override is the
  // calculator's stated INPUT, the finance block its derivative.
  const purchasePrice = num(ovr.purchasePrice) ?? num(at(fin, ['initialCosts', 'propertyValue']));
  const weeklyRent = num(ovr.weeklyRent) ?? num(at(fin, ['income', 'weeklyRent']));
  const lvr = num(ovr.loanToValueRatio) ?? num(at(fin, ['keyMetrics', 'lvr']));
  const weeklyCashFlow = num(at(fin, ['keyMetrics', 'weeklyNet']));
  const annualOutgoings = num(at(fin, ['annualCosts', 'totalAnnualExcludingLandTax']))
    ?? num(at(fin, ['annualCosts', 'total']));
  const deposit = num(at(fin, ['initialCosts', 'deposit']));
  const loanAmount = num(at(fin, ['loanDetails', 'loanAmount']))
    ?? num(at(fin, ['initialCosts', 'loanAmount']));
  const stampDuty = num(at(fin, ['initialCosts', 'stampDuty']));
  const totalUpfront = num(at(fin, ['initialCosts', 'totalUpfront']));

  const facts = readPropertyFacts(row.property_specs, row.manual_overrides);
  const annualRent = weeklyRent === null ? null : weeklyRent * 52;

  const gross = annualRent === null || purchasePrice === null
    ? null
    : grossYield({ annualRent, basisAmount: purchasePrice, basis: 'purchase' });
  const net = annualRent === null || purchasePrice === null || annualOutgoings === null
    ? null
    : netYield({
      annualRent,
      annualOperatingCosts: annualOutgoings,
      basisAmount: purchasePrice,
      basis: 'purchase',
    });
  const origination = loanAmount === null || purchasePrice === null
    ? null
    : originationLvr({ loanAtSettlement: loanAmount, purchasePrice });

  const score = isRecord(row.investment_score) ? row.investment_score : null;
  const policy = score !== null && isRecord(score.policy) ? score.policy : null;
  const gradeIssued = score === null
    ? false
    : policy === null
      ? num(score.totalScore) !== null && str(score.grade) !== null
      : policy.gradeIssued === true;

  return {
    'finance.purchasePrice': purchasePrice,
    'finance.weeklyRent': weeklyRent,
    'finance.lvr': lvr,
    'finance.weeklyCashFlow': weeklyCashFlow,
    'finance.annualOutgoings': annualOutgoings,
    'finance.deposit': deposit,
    'finance.loanAmount': loanAmount,
    'finance.stampDuty': stampDuty,
    'finance.totalUpfront': totalUpfront,
    'property.propertyType': facts.propertyType,
    'property.bedrooms': facts.beds,
    'property.bathrooms': facts.baths,
    'property.carSpaces': facts.carSpaces,
    'property.landSize': facts.landSizeSqm,
    'property.buildingSize': facts.buildSizeSqm,
    'property.yearBuilt': facts.yearBuilt,
    'derived.grossYield': gross === null ? null : gross.value,
    'derived.netYield': net === null ? null : net.value,
    'derived.originationLvr': origination,
    'geography.suburb': geo === null ? null : str(geo.suburb),
    'geography.postcode': geo === null ? null : str(geo.postcode),
    'geography.state': geo === null ? null : str(geo.state),
    'geography.latitude': geo === null ? null : num(geo.latitude),
    'geography.longitude': geo === null ? null : num(geo.longitude),
    'record.variant': str(row.report_variant),
    'record.tier': str(row.report_tier),
    'record.currentVersion': num(row.current_version),
    'scoring.gradeIssued': gradeIssued,
  };
}

describe.skipIf(!present)('RF-7.1 parity — contract vs the current path, on real rows', () => {
  // `describe.skipIf` still EVALUATES this body to collect the tests, so the
  // read has to be guarded rather than relied on to be skipped.
  const rows: Array<Record<string, unknown>> = present
    ? (JSON.parse(readFileSync(CORPUS, 'utf8')) as Array<Record<string, unknown>>)
    : [];
  const observedAt = new Date('2026-09-11T00:00:00.000Z');

  const ledger: Array<Record<string, unknown>> = [];
  const mismatches: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const contract = buildReportFactContract({ report: row, geography: row.geography, observedAt });
    const current = currentPath(row);
    const leaves = new Map(factLeaves(contract).map((l) => [l.name, l.fact]));

    for (const [name, currentValue] of Object.entries(current)) {
      if (name === 'scoring.gradeIssued') {
        const match = contract.scoring.gradeIssued === currentValue;
        ledger.push({ id: row.id, fact: name, current: currentValue, contract: contract.scoring.gradeIssued, match });
        if (!match) mismatches.push({ id: row.id, fact: name, current: currentValue, contract: contract.scoring.gradeIssued });
        continue;
      }
      const fact = leaves.get(name);
      const contractValue = fact === undefined ? undefined : fact.value;
      const match = Object.is(contractValue ?? null, currentValue ?? null);
      ledger.push({
        id: row.id,
        fact: name,
        current: currentValue,
        contract: contractValue ?? null,
        status: fact?.status ?? 'missing_leaf',
        match,
      });
      if (!match) {
        mismatches.push({
          id: row.id,
          fact: name,
          current: currentValue,
          contract: contractValue ?? null,
          absence: fact?.absence?.reason ?? null,
        });
      }
    }
  }

  it('walks every row in the cohort', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it('reproduces the current path on every material fact', () => {
    if (OUT) {
      writeFileSync(OUT, JSON.stringify({
        contractVersion: REPORT_FACT_CONTRACT_VERSION,
        rows: rows.length,
        comparisons: ledger.length,
        matched: ledger.filter((l) => l.match).length,
        mismatches,
        ledger,
      }, null, 1));
    }
    expect(mismatches, JSON.stringify(mismatches.slice(0, 12), null, 1)).toEqual([]);
  });

  it('is deterministic — the same row builds a byte-identical contract', () => {
    for (const row of rows) {
      const a = buildReportFactContract({ report: row, geography: row.geography, observedAt });
      const b = buildReportFactContract({ report: row, geography: row.geography, observedAt });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('never converts an absent fact to zero, an empty string or false', () => {
    for (const row of rows) {
      const contract = buildReportFactContract({ report: row, geography: row.geography, observedAt });
      for (const { name, fact } of factLeaves(contract)) {
        if (fact.status !== 'absent') continue;
        expect(fact.value, `${name} on ${String(row.id)}`).toBeNull();
        expect(fact.absence?.reason.length ?? 0, `${name} must explain its absence`).toBeGreaterThan(0);
      }
    }
  });

  it('tolerates every historical shape without throwing', () => {
    for (const row of rows) {
      expect(() => buildReportFactContract({ report: row, geography: row.geography, observedAt })).not.toThrow();
    }
  });

  it('modifies no input row', () => {
    for (const row of rows) {
      const before = JSON.stringify(row);
      buildReportFactContract({ report: row, geography: row.geography, observedAt });
      expect(JSON.stringify(row)).toBe(before);
    }
  });
});
