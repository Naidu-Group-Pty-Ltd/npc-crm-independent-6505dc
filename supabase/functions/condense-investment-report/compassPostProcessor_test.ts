/**
 * Deno-side tests for the Compass post-processor and QA validator.
 *
 * These run under the same runtime the Edge Functions do, which is the point:
 * the modules must parse and behave identically there and in vitest. The
 * behavioural depth for the editorial strip lives in
 * `src/lib/reports/__tests__/compassEditorialStrip.spec.ts`.
 *
 * Every heading below is a real v3.0 section name. The previous version of this
 * file used the pre-v2.0 set — `## Property Snapshot — Non-Financial`,
 * `## Future Infrastructure & Growth Pipeline`, `## Suburb Character & Lifestyle` —
 * none of which `findDefinition` could resolve, so its "protected section" test
 * was asserting against a section the registry never matched.
 */
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { postProcessReportMarkdown, countWords, estimatePages, findEditorialLabels } from '../_shared/compassPostProcessor.ts';
import { runQAValidation } from '../_shared/compassQAValidator.ts';
import { COMPASS_WORD_CAPS } from '../_shared/compassSectionRegistry.ts';

// ─── Phase 5 — word-cap enforcement ─────────────────────────────────────────

Deno.test('postProcessor: caps the executive verdict to its registry cap', () => {
  // The id was `compass.executiveSummary` here and in the module, and that id
  // has not existed since v2.0 renamed the section — so this cap never fired.
  const longBody = Array(800).fill('word').join(' ');
  const md = `## Executive Verdict\n${longBody}\n\n## Appendix, Source Notes & Disclaimer\nShort.`;
  const { markdown, report } = postProcessReportMarkdown(md, 'compass-40');
  const execBody = markdown.split('## Appendix')[0];
  const cap = COMPASS_WORD_CAPS.executiveSummaryTotal.max;
  const w = countWords(execBody);
  assert(w <= cap + 20, `Executive Verdict should be ≤${cap} words, got ${w}`);
  assert(report.sectionsTrimmed.some((t) => t.sectionId === 'compass.executiveVerdict'));
});

Deno.test('postProcessor: strips every editorial block, in all three forms', () => {
  const md = `## Property & Locality Snapshot

A property summary.

### What this means
A heading-form commentary block.

**NPC view**
A bold-form commentary block.

What to watch
A bare-line commentary block.`;
  const { markdown, report } = postProcessReportMarkdown(md, 'compass-40');
  assertEquals(findEditorialLabels(markdown).length, 0);
  assert(!/what this means/i.test(markdown));
  assert(!/npc view/i.test(markdown));
  assert(!/what to watch/i.test(markdown));
  assertEquals(report.editorialBlocksRemoved, 3);
  assert(report.editorialWordsRemoved > 0);
});

Deno.test('postProcessor: keeps figures and tables the blocks sat beside', () => {
  const md = `## Demand Drivers

{{bars: Yield 7.4, Growth 8.1 | title=Pillars | max=10}}

**What This Means:**
Restatement of the bars above.

| Metric | Value |
| --- | --- |
| Median | $1.17M |`;
  const { markdown } = postProcessReportMarkdown(md, 'compass-40');
  assert(markdown.includes('{{bars: Yield 7.4, Growth 8.1 | title=Pillars | max=10}}'));
  assert(markdown.includes('| Median | $1.17M |'));
  assert(!/restatement/i.test(markdown));
});

// ─── Phase 6 — page-pressure trimming ───────────────────────────────────────

Deno.test('postProcessor: caps bullet lists to top 5 under page pressure', () => {
  const bullets = Array(20).fill(0).map((_, i) => `- bullet ${i}`).join('\n');
  // Inflate the page estimate from a protected section so the ladder fires on
  // the non-protected one.
  const tableRows = Array(2000).fill(0).map((_, i) => `| item${i} | val${i} |`).join('\n');
  const md = `## Why This Location Matters
| Project | Status |
|---|---|
${tableRows}

## Amenity & Access
${bullets}`;
  const { markdown } = postProcessReportMarkdown(md, 'compass-40');
  const amenitySlice = markdown.split('## Amenity & Access')[1] ?? '';
  const bulletCount = (amenitySlice.match(/^- bullet/gm) ?? []).length;
  assert(bulletCount <= 5, `bullets should be capped to 5, got ${bulletCount}`);
});

Deno.test('postProcessor: never trims protected sections', () => {
  const padding = Array(15000).fill('w').join(' ');
  const protectedBody = '- transitions\n- routes\n- schools\n- ports\n- roads\n- rail\n- bus\n- ferry\n- airports\n- bridges';
  const md = `## Amenity & Access\n${padding}\n\n## Why This Location Matters\n${protectedBody}`;
  const { markdown } = postProcessReportMarkdown(md, 'compass-40');
  const protectedSlice = markdown.split('## Why This Location Matters')[1] ?? '';
  const bullets = (protectedSlice.match(/^- /gm) ?? []).length;
  assertEquals(bullets, 10, 'protected section bullets must remain intact');
});

// ─── Phase 7 — QA validator ─────────────────────────────────────────────────

Deno.test('QA validator: flags financial content in Compass', () => {
  const md = `## Executive Verdict
Property shows gross yield of 4.5% and LVR of 80%.

## Why This Location Matters
Schools planned.`;
  const { findings } = runQAValidation(md, 'compass-40');
  assert(findings.some((f) => f.rule === 'financial-exclusion'));
});

Deno.test('QA validator: flags a surviving editorial label as an error', () => {
  const md = `## Executive Verdict\nProceed with caution.\n\n**What This Means**\nCommentary.`;
  const { findings, passed } = runQAValidation(md, 'compass-40');
  const hit = findings.find((f) => f.rule === 'editorial-label');
  assert(hit, 'editorial-label finding expected');
  assertEquals(hit?.severity, 'error');
  assertEquals(passed, false);
});

Deno.test('QA validator: flags duplicate H2 headings', () => {
  const md = `## Executive Verdict\nA.\n\n## Executive Verdict\nB.`;
  const { findings } = runQAValidation(md, 'compass-40');
  assert(findings.some((f) => f.rule === 'duplicate-h2'));
});

Deno.test('QA validator: flags missing protected section', () => {
  const md = `## Executive Verdict\nShort body.`;
  const { findings } = runQAValidation(md, 'compass-40');
  assert(findings.some((f) => f.rule === 'missing-protected-section'));
});

Deno.test('QA validator: flags an over-structured section', () => {
  const md = ['## Amenity & Access', ...Array.from({ length: 9 }, (_, i) => `### Sub ${i}\n\nText.`)].join('\n\n');
  const { findings } = runQAValidation(md, 'compass-40');
  assert(findings.some((f) => f.rule === 'subheading-density'));
});

Deno.test('estimatePages: rough sanity for empty and full content', () => {
  assertEquals(estimatePages(''), 0);
  const big = Array(3200).fill('word').join(' ');
  assert(estimatePages(big) >= 9 && estimatePages(big) <= 12);
});
