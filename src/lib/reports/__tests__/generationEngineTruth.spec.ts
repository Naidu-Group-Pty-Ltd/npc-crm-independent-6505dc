/**
 * The generation engine is STATED where it cannot be chosen, RESOLVED by one
 * rule, and RECORDED as the one that ran.
 *
 * The Investment Analysis page carried a two-option "Generation Engine"
 * dropdown that defaulted to "Legacy Compass — Stable". That selection could
 * never take effect. The page sends no `reportTier`, so the generator defaults
 * the tier to `compass`; `isCompassTier` then resolves the engine to Compass
 * every time — deliberately, because the tier is the data-minimisation
 * boundary and an engine preference must not be able to pull financial content
 * into a non-financial report, nor strip it out of a financial one.
 *
 * So every report from that page has always been produced by the Compass
 * engine, whatever the dropdown said — and because `generation_engine` was
 * written only by the browser, the row then recorded the *unused selection*.
 * 1,124 compass-tier rows read "legacy" about documents this engine made.
 *
 * Three rules follow, and this file pins them. **A dead control is worse than
 * no control** — the rule this repository already applies to the AUSTRAC path
 * card — and this one was worse than dead, because it defaulted to the option
 * that never ran and called it "battle-tested". **A record of what was
 * requested is not a record of what happened**: the column now states the
 * engine that actually ran. And **the tier decides**, in one module that
 * mirrors the server's own expression, so a surface can say which engine will
 * run without re-deriving the rule and drifting from it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_LABEL,
  engineIsFixedByTier,
  resolveGenerationEngine,
} from '../generationEngine.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
/** Source with comments stripped: a rule must be pinned by what the file DOES, never by what it says about itself. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GENERATOR_PAGE = 'src/components/reports/InvestmentReportGenerator.tsx';
const REGENERATE = 'src/components/reports/RegenerateReportButton.tsx';
const HOOK = 'src/hooks/useChunkedRegeneration.ts';
const PURE = 'src/lib/reports/generationEngine.pure.ts';
const EDGE = 'supabase/functions/generate-investment-report/index.ts';

describe('the tier decides, and one module says so', () => {
  it('a Compass tier fixes the engine whatever is stored against the report', () => {
    expect(engineIsFixedByTier('compass')).toBe(true);
    expect(engineIsFixedByTier('compass-40')).toBe(true);
    expect(resolveGenerationEngine({ reportTier: 'compass', storedEngine: 'legacy' })).toBe('compass-40');
    expect(resolveGenerationEngine({ reportTier: 'compass-40', storedEngine: null })).toBe('compass-40');
  });

  /**
   * The server compares `rawTier` with `===`. A kinder comparison here would
   * report an engine the server would not choose, which is the one way a
   * module whose whole job is to say what will happen can lie.
   */
  it('compares exactly, because the server does', () => {
    expect(engineIsFixedByTier('Compass')).toBe(false);
    expect(engineIsFixedByTier(' compass ')).toBe(false);
  });

  /**
   * The server's `rawTier` is `propertyDetails?.reportTier || 'compass'`, which
   * is the whole reason the generator page's dropdown could never take effect.
   */
  it('an absent tier is Compass, exactly as the server reads it', () => {
    expect(resolveGenerationEngine({})).toBe('compass-40');
    expect(resolveGenerationEngine({ reportTier: null, storedEngine: 'legacy' })).toBe('compass-40');
    expect(resolveGenerationEngine({ reportTier: '', storedEngine: 'legacy' })).toBe('compass-40');
    expect(engineIsFixedByTier(undefined)).toBe(true);
  });

  /**
   * 56 production rows are `snapshot`, `briefing` or `strategic`. None of them
   * is a Compass report, and regenerating one must not turn it into one.
   */
  it('every other tier leaves the question to the record, and defaults to legacy', () => {
    for (const reportTier of ['snapshot', 'briefing', 'strategic', 'financial', 'financial-analysis']) {
      expect(engineIsFixedByTier(reportTier), reportTier).toBe(false);
      expect(resolveGenerationEngine({ reportTier, storedEngine: 'legacy' }), reportTier).toBe('legacy');
      expect(resolveGenerationEngine({ reportTier }), reportTier).toBe('legacy');
      expect(resolveGenerationEngine({ reportTier, storedEngine: 'compass-40' }), reportTier).toBe('compass-40');
    }
  });

  it('names each engine once, and calls the primary one Primary', () => {
    expect(ENGINE_LABEL['compass-40']).toBe('Compass — Primary');
    expect(ENGINE_LABEL.legacy).toBe('Legacy Compass');
  });

  /**
   * The mirror guard: `llmUsageBinding.pure.ts` carries the same one against
   * the router. If the server's expression is edited, this fails rather than
   * letting a surface quietly say the wrong thing.
   */
  it('mirrors the server expression it claims to mirror', () => {
    const edge = code(EDGE);
    expect(edge).toContain("const rawTier = propertyDetails?.reportTier || 'compass';");
    expect(edge).toContain("const isCompassTier = rawTier === 'compass' || rawTier === 'compass-40';");
    expect(edge).toMatch(/const generationEngine = isCompassTier \|\| requestedEngine === 'compass-40'\s*\n?\s*\? 'compass-40'\s*\n?\s*: 'legacy';/);
    // The pure module spells the same two tiers and nothing else.
    expect(code(PURE)).toContain("['compass', 'compass-40']");
  });
});

describe('the page states the engine rather than offering a choice it cannot honour', () => {
  const page = code(GENERATOR_PAGE);

  it('no longer renders an engine dropdown', () => {
    expect(page).not.toContain("onValueChange={(value: 'legacy' | 'compass-40')");
    expect(page).not.toContain('setGenerationEngine');
    // The two labels that made the dead control look like a real decision.
    expect(page).not.toContain('Legacy Compass — Stable');
    expect(page).not.toContain('battle-tested');
  });

  it('names the engine that actually runs, from the one module that names it', () => {
    expect(page).toContain("import { ENGINE_LABEL } from '@/lib/reports/generationEngine.pure';");
    expect(page).toContain("{ENGINE_LABEL['compass-40']}");
  });

  it('sends and stores the engine that will run, not a preference', () => {
    expect(page).toContain("const generationEngine: 'legacy' | 'compass-40' = 'compass-40';");
  });

  /**
   * The premise the whole change rests on: this page sends no tier, which is
   * what makes the server's resolution unconditional. If a tier is ever sent
   * from here, the statement above stops being true and must be revisited.
   */
  it('still sends no reportTier — the reason the resolution is unconditional', () => {
    expect(page).not.toContain('reportTier');
  });
});

describe('the server resolves the engine and records the one it ran', () => {
  const edge = code(EDGE);

  it('writes generation_engine from what ran, on the completion update', () => {
    expect(edge).toContain("generation_engine: compass40OverlayActive ? 'compass-40' : 'legacy',");
    const update = /const updateData: any = \{[\s\S]*?\n {6}\};/.exec(edge)?.[0] ?? '';
    expect(update, 'completion update payload not found').not.toBe('');
    expect(update).toContain('generation_engine:');
    expect(update).toContain("status: 'completed'");
  });

  /**
   * Every quality gate this programme built for the Compass document — the
   * canonical section registry, the editorial post-processor and the QA
   * validator — runs only under the overlay. That is what makes this engine
   * the primary one rather than merely the newer one.
   */
  it('the editorial and QA gates run under the primary engine', () => {
    expect(edge).toContain('if (compass40OverlayActive) {');
    expect(edge).toContain("postProcessReportMarkdown(reportContent, 'compass-40')");
    // The QA run now also carries the recorded scores (QA-18), so the call
    // opens a context object rather than closing on the tier.
    expect(edge).toContain("runQAValidation(reportContent, 'compass-40', {");
  });
});

describe('the regenerate dialog states the same thing the same way', () => {
  const regen = code(REGENERATE);

  it('has no engine radio group left to pick a dead option from', () => {
    expect(regen).not.toContain('RadioGroup');
    expect(regen).not.toContain('setEngine');
    expect(regen).not.toContain('Compass-40 (Trimmed Legacy)');
    expect(regen).not.toMatch(/Battle-tested output/i);
  });

  it('resolves what will run through the shared rule and states it', () => {
    expect(regen).toContain("from '@/lib/reports/generationEngine.pure'");
    expect(regen).toContain('resolveGenerationEngine({');
    expect(regen).toContain("ENGINE_LABEL['compass-40']");
    expect(regen).toContain('ENGINE_LABEL.legacy');
  });

  /**
   * The dialog reports; the hook decides. Passing an engine here would be a
   * second answer to a question the record already settles.
   */
  it('passes no engine to the regeneration — the record decides', () => {
    const call = /await regenerate\(\{[\s\S]*?\n {4}\}\);/.exec(regen)?.[0] ?? '';
    expect(call, 'regenerate() call not found').not.toBe('');
    // The nested `metadata.generationEngine` on the activity log is the record
    // of what ran; what must not be there is the option that would override it.
    expect(call).not.toMatch(/\n {6}generationEngine:/);
  });

  it('reads the cheap projection rather than the whole report body', () => {
    expect(regen).toContain("projection: 'generationProgress'");
    expect(regen).not.toContain("select: 'generation_engine'");
  });
});

describe('regenerating a report never changes what kind of report it is', () => {
  const hook = code(HOOK);

  /**
   * `normaliseReportTier` collapses snapshot / briefing / strategic into
   * `compass-40`, which is right for counting chunks and wrong for the tier
   * sent to the server — it is the data-minimisation boundary, and sending the
   * normalised value regenerated 56 production reports as Compass documents.
   */
  it('sends the report\'s own tier, never the normalised one', () => {
    expect(hook).toContain('reportTier: report?.report_tier ?? undefined,');
    expect(hook).not.toContain('reportTier: tier,');
  });

  it('resolves the engine through the shared rule', () => {
    expect(hook).toContain("import { resolveGenerationEngine, type GenerationEngine } from '@/lib/reports/generationEngine.pure';");
    expect(hook).toContain('generationEngine ?? resolveGenerationEngine({');
    expect(hook).not.toMatch(/tier === 'compass-40' \? 'compass-40' : \(report\?\.generation_engine/);
  });
});
