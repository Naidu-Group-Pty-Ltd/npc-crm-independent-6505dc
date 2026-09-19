/**
 * Fork a retained Compass into its Financial and Due Diligence children,
 * in-process, spending nothing.
 *
 * S5/S6 §5 asks for the five formats across two properties, read page by page.
 * The retained fixture set carries one Compass per property and four children
 * of a parent that was NOT retained, so nothing in it lets a Compass be
 * compared with the Financial and Strategic drawn from the SAME record — and
 * "consistent facts across the suite" is exactly a comparison within one
 * lineage.
 *
 * `fork-investment-report` makes **no model call**: it loads the parent, runs
 * `loadSplitRegistry`, `readStrategyRecord`, `resolveVariantScore` and
 * `composeForkDocuments`, and writes what they produce. Every one of those is
 * importable here, so this reproduces the function's composition exactly and
 * writes the two children as journey fixtures. No credential is spent, no
 * vendor is called and nothing is written to production.
 *
 * It is still a REPLAY. What it proves is what the deployed function would
 * compose from this row, not that the deployed function ran.
 *
 * Run: `FORK_REPLAY_PARENT=<fixture id> npx vitest run
 * src/lib/reports/__tests__/forkLineageReplay.spec.ts` (default parent: the
 * long Compass). It lives under `src/` so the repository's one vitest
 * include reaches it, and it SKIPS where `.verify/fixtures/` is absent —
 * those are real production rows and are gitignored, so CI has none and
 * must not fail for want of them.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadSplitRegistry } from '../../../../supabase/functions/_shared/reportSplitRegistry';
import { composeForkDocuments }
  from '../../../../supabase/functions/_shared/reports/investment/forkSplit.pure';
import { scoreFinancial, scorePropertyFundamentals }
  from '../../../../supabase/functions/_shared/investmentScoreEngine';
import { variantScoreUnderPolicy }
  from '../../../../supabase/functions/_shared/reports/market/variantScorePolicy.pure';
import { readPropertyFacts }
  from '../../../../supabase/functions/_shared/reports/investment/propertyRecord.pure';
import { readStrategyRecord }
  from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { ENRICHMENT_STAMP }
  from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure';
import { transportCountReading }
  from '../../../../supabase/functions/_shared/transportReading.pure';
import { buildMarketFacts }
  from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import { describeSubjectPrice }
  from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';

const PARENT = process.env.FORK_REPLAY_PARENT ?? '09f8569e-21ca-48b9-a3b9-57f4793d0836';

/**
 * `loadSplitRegistry` reads `report_engine_config` and falls back to the
 * module's own constants on any failure — which is what a deployment with no
 * rows in that table gets, and what the fixture set represents.
 */
const noConfig = {
  from: () => ({ select: () => ({ in: async () => ({ data: null, error: null }) }) }),
};

// `.verify/fixtures/` holds real production rows and is gitignored.
const haveFixture = existsSync(`.verify/fixtures/${PARENT}/report.json`);

describe.skipIf(!haveFixture)('fork replay', () => {
  it('composes the Financial and Due Diligence children from one retained Compass', async () => {
    const parent = JSON.parse(
      readFileSync(`.verify/fixtures/${PARENT}/report.json`, 'utf8'));
    expect(String(parent.report_tier ?? 'compass')).toBe('compass');

    const registry = await loadSplitRegistry(noConfig as never);

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
    const scoreFor = (v: 'financial' | 'due_diligence') => variantScoreUnderPolicy({
      variantScore: v === 'financial'
        ? scoreFinancial(scoreInputRaw as never)
        : scorePropertyFundamentals(scoreInputRaw as never),
      parentScore: parent.investment_score && typeof parent.investment_score === 'object'
        ? parent.investment_score : null,
      now: new Date(),
    });
    const financialScore = scoreFor('financial');
    const strategicScore = scoreFor('due_diligence');

    const strategy = readStrategyRecord(
      {
        propertyAddress: parent.property_address,
        propertySpecs: parent.property_specs,
        financialCalculations: parent.financial_calculations,
        investmentScore: parent.investment_score,
        dataSources: parent.data_sources,
        locationIntelligence: parent.location_intelligence,
      },
      {
        measuredAt: (parent.location_intelligence as any)?.[ENRICHMENT_STAMP]?.acquiredAt ?? null,
        market: buildMarketFacts({ marketEvidence: (parent.data_sources as any)?.marketEvidence }),
        price: describeSubjectPrice({
          overridePurchasePrice: (parent.manual_overrides as any)?.purchasePrice,
          listingPrice: (parent.property_specs as any)?.price,
        }),
        carriesModelling: true,
        transport: transportCountReading((parent.location_intelligence as any)?.transport),
      },
    );

    const docs = composeForkDocuments({
      registry,
      parentContent: parent.report_content || '',
      propertyAddress: parent.property_address,
      financialCalculations: parent.financial_calculations,
      financialScore,
      composeFinancial: true,
      strategy,
      generatedOn: new Date().toISOString(),
    });

    // `upsertFork`'s own insert shape, field for field.
    const child = (tier: 'financial' | 'strategic', markdown: string, score: unknown) => ({
      id: randomUUID(),
      property_address: parent.property_address,
      property_listing_id: parent.property_listing_id ?? null,
      // An isolated test record: no client, no author, no portal, no email.
      client_property_id: null,
      generated_by: null,
      canonical_property_key: parent.canonical_property_key ?? null,
      report_scope: parent.report_scope ?? null,
      report_variant: tier,
      derived_from_report_id: parent.id,
      parent_report_id: parent.id,
      report_content: markdown,
      sources_content: parent.sources_content ?? null,
      investment_score: score,
      financial_calculations: parent.financial_calculations,
      demographics_data: parent.demographics_data,
      economic_data: parent.economic_data,
      location_intelligence: parent.location_intelligence,
      property_specs: parent.property_specs,
      manual_overrides: parent.manual_overrides,
      data_sources: parent.data_sources,
      variant_generated_at: new Date().toISOString(),
      report_tier: tier,
      generation_engine: parent.generation_engine ?? 'legacy',
      status: 'completed',
      created_at: new Date().toISOString(),
    });

    const written: Record<string, string> = {};
    for (const [tier, md, score] of [
      ['financial', docs.financial.markdown, financialScore],
      ['strategic', docs.dueDiligence.markdown, strategicScore],
    ] as const) {
      const row = child(tier, md, score);
      mkdirSync(`.verify/fixtures/${row.id}`, { recursive: true });
      writeFileSync(`.verify/fixtures/${row.id}/report.json`, JSON.stringify(row, null, 2));
      written[tier] = row.id;
    }
    writeFileSync('.verify/fork-replay.json', JSON.stringify({
      parent: parent.id,
      parentAddress: parent.property_address,
      children: written,
      sections: {
        composite: docs.compositeSections,
        financial: docs.financial.sections,
        strategic: docs.dueDiligence.sections,
      },
      composedChapters: docs.composedChapters,
      routedSectionsReplacedByRecord: docs.replacedByComposedChapters,
      hygiene: {
        financial: {
          editorialBlocksRemoved: docs.financial.editorialBlocksRemoved,
          placeholderRowsRemoved: docs.financial.placeholderRowsRemoved,
        },
        strategic: {
          editorialBlocksRemoved: docs.dueDiligence.editorialBlocksRemoved,
          placeholderRowsRemoved: docs.dueDiligence.placeholderRowsRemoved,
        },
      },
      note: 'Replay: production modules run in-process. No credential spent, no vendor called, nothing written to production.',
    }, null, 2));

    expect(docs.financial.markdown.length).toBeGreaterThan(1000);
    expect(docs.dueDiligence.markdown.length).toBeGreaterThan(1000);
  });
});
