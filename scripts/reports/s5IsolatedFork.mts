/**
 * The fork, run for real against an isolated database.
 *
 * ## What this is, precisely
 *
 * `scripts/reports/s5ForkReports.mts` composes the fork's two documents from
 * FIXTURES and renders them. It proves the composition. It does not prove
 * PERSISTENCE, which is half of what the delivery instruction asks for:
 * "'Not assessed' rows surviving parsing, persistence and rendering", and
 * "Annabelle's accepted override and the other protected fixture inputs must
 * survive generation, fork, condensation, editing, saving and export".
 *
 * So this reads a parent row OUT of a real Postgres carrying the real
 * `investment_reports` schema, runs the production modules the edge function
 * runs, writes the child rows BACK with the same field set the edge function
 * writes, and then re-reads them to check what survived.
 *
 * ## What is exercised, and what is not
 *
 * EXERCISED — the same modules, unmodified, in the same order as
 * `fork-investment-report/index.ts`:
 *   `readPropertyFacts` → `scoreFinancial` / `scorePropertyFundamentals` →
 *   `variantScoreUnderPolicy` → `composeForkDocuments`, then the insert with
 *   the handler's own `sharedFields` shape against the real 41-column table.
 *
 * NOT EXERCISED — the HTTP wrapper: `Deno.serve`, `verifyAuth`,
 * `createCorsHeaders`, `enforceCsrf`, `requireModulePermission`, and the
 * `loadSplitRegistry` DB overlay (the in-code default registry is used, which
 * is the documented fallback). The sandbox's egress gateway answers 403 to
 * CONNECT for `esm.sh` and `deno.land`, so
 * `https://esm.sh/@supabase/supabase-js@2` cannot resolve and the handler
 * cannot be loaded verbatim. That is stated rather than worked around,
 * because an auth wrapper nobody exercised is not an auth wrapper anybody
 * proved.
 *
 * The database is air-gapped: loopback-only on port 55432, and neither
 * `pg_net` nor `http` nor `pg_cron` is installed OR available, so it has no
 * mechanism to make an outbound request or run a schedule.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { composeForkDocuments, countCompositeSections }
  from '../../supabase/functions/_shared/reports/investment/forkSplit.pure.ts';
import { scoreFinancial, scorePropertyFundamentals }
  from '../../supabase/functions/_shared/investmentScoreEngine.ts';
import { variantScoreUnderPolicy }
  from '../../supabase/functions/_shared/reports/market/variantScorePolicy.pure.ts';
import { readPropertyFacts }
  from '../../supabase/functions/_shared/reports/investment/propertyRecord.pure.ts';
import { loadSplitRegistry } from '../../supabase/functions/_shared/reportSplitRegistry.ts';

/** A client that answers nothing, so `loadSplitRegistry` takes its documented
 *  code-default branch — the same one `s5ForkReports.mts` uses and the same
 *  one production takes when `report_engine_config` carries no overlay. */
const NO_OVERLAY = { from: () => ({ select: () => ({ in: async () => ({ data: null }) }) }) } as never;
const registry = await loadSplitRegistry(NO_OVERLAY);

const PG = ['-h', '127.0.0.1', '-p', '55432', '-U', 's5', '-d', 's5'];
const psql = (sql: string): string =>
  execFileSync('psql', [...PG, '-Atc', sql], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const psqlFile = (sql: string): string => {
  const p = `/tmp/s5_${Math.random().toString(36).slice(2)}.sql`;
  writeFileSync(p, sql);
  return execFileSync('psql', [...PG, '-q', '-f', p], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
};
const lit = (s: string) => { const t = 'q' + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const jlit = (v: unknown) => (v === null || v === undefined ? 'null' : `${lit(JSON.stringify(v))}::jsonb`);

/** The columns the handler selects from the parent. */
const PARENT_COLS = ['id', 'property_address', 'property_listing_id', 'client_property_id',
  'canonical_property_key', 'generated_by', 'report_content', 'financial_calculations',
  'demographics_data', 'economic_data', 'location_intelligence', 'property_specs',
  'manual_overrides', 'status', 'report_variant', 'report_tier', 'sources_content',
  'investment_score', 'generation_engine', 'report_scope'];

function readParent(id: string): any {
  const json = psql(`select row_to_json(t) from (select ${PARENT_COLS.join(',')} `
    + `from public.investment_reports where id = '${id}') t`);
  return JSON.parse(json);
}

/** `resolveVariantScore`, as the handler defines it. */
function resolveVariantScore(variant: 'financial' | 'due_diligence', scoreInputRaw: any, parent: any) {
  const variantScore = variant === 'financial'
    ? scoreFinancial(scoreInputRaw)
    : scorePropertyFundamentals(scoreInputRaw);
  const parentScore = parent.investment_score && typeof parent.investment_score === 'object'
    ? parent.investment_score : null;
  return variantScoreUnderPolicy({ variantScore, parentScore, now: new Date() });
}

const SUBJECTS = [
  { key: 'annabelle', id: '9bd41c05-7f9b-41e8-819a-a029f4121369' },
  { key: 'pallas', id: '3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753' },
];

mkdirSync('reports/s5-isolated', { recursive: true });
const summary: any[] = [];

for (const subject of SUBJECTS) {
  const parent = readParent(subject.id);
  const sections = countCompositeSections(parent.report_content || '');
  if (sections === 0) throw new Error(`${subject.key}: composite has no H2 sections to fork`);

  // The handler's own derivation, line for line.
  const fin = parent.financial_calculations || {};
  const overrides = parent.manual_overrides || {};
  const scoreInputRaw = {
    property: {
      price: Number(overrides.purchasePrice)
        || Number(fin.initialCosts?.propertyValue) || Number(fin.purchasePrice) || 0,
      weeklyRent: Number(overrides.weeklyRent)
        || Number(fin.income?.weeklyRent) || Number(fin.weeklyRent) || 0,
      propertyType: readPropertyFacts(parent.property_specs, overrides).normalisedType
        ?? parent.property_specs?.property_type ?? 'house',
    },
    demographics: parent.demographics_data || {},
    locationIntelligence: parent.location_intelligence || {},
    financials: fin,
    state: parent.demographics_data?.state,
  };

  const financialScore = resolveVariantScore('financial', scoreInputRaw, parent);
  const strategicScore = resolveVariantScore('due_diligence', scoreInputRaw, parent);

  const docs = composeForkDocuments({
    registry,
    parentContent: parent.report_content || '',
    propertyAddress: parent.property_address,
    financialCalculations: parent.financial_calculations,
    financialScore,
    composeFinancial: true,
    generatedOn: new Date().toISOString(),
  });

  for (const [variant, persisted, markdown, score] of [
    ['financial', 'financial', docs.financial.markdown, financialScore],
    ['due_diligence', 'strategic', docs.dueDiligence.markdown, strategicScore],
  ] as const) {
    // The handler's `sharedFields`, verbatim in shape.
    const shared: Record<string, string> = {
      report_content: lit(markdown),
      sources_content: parent.sources_content ? lit(parent.sources_content) : 'null',
      investment_score: jlit(score),
      financial_calculations: jlit(parent.financial_calculations),
      demographics_data: jlit(parent.demographics_data),
      economic_data: jlit(parent.economic_data),
      location_intelligence: jlit(parent.location_intelligence),
      property_specs: jlit(parent.property_specs),
      manual_overrides: jlit(parent.manual_overrides),
      variant_generated_at: lit(new Date().toISOString()) + '::timestamptz',
      report_tier: lit(persisted),
      generation_engine: lit(parent.generation_engine ?? 'legacy'),
      status: lit('completed'),
      property_address: lit(parent.property_address),
      report_variant: lit(persisted),
      derived_from_report_id: lit(parent.id) + '::uuid',
      parent_report_id: lit(parent.id) + '::uuid',
      report_scope: lit(parent.report_scope ?? 'address'),
    };
    const cols = Object.keys(shared);
    psqlFile(`insert into public.investment_reports (${cols.join(',')}) `
      + `values (${cols.map((c) => shared[c]).join(',')});`);
    writeFileSync(`reports/s5-isolated/${subject.key}-${persisted}.md`, markdown);
    summary.push({ subject: subject.key, variant: persisted, chars: markdown.length,
      grade: score?.grade ?? null, authority: score?.policy?.authority ?? score?.authority ?? null });
  }
  console.log(`${subject.key}: parent had ${sections} H2 sections → `
    + `financial ${docs.financial.markdown.length} chars, strategic ${docs.dueDiligence.markdown.length} chars`);
}

console.table(summary);
console.log(`\nrows now in the isolated table: ${psql('select count(*) from public.investment_reports')}`);
