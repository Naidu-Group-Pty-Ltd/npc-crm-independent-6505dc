#!/usr/bin/env node
/**
 * The five-format ownership matrix, emitted from the registry.
 *
 * §6 of the standard asks for one topic per row: its authoritative producer,
 * which format owns the FULL detail, where a summary of it is permitted, and
 * what evidence the document renders for it. Written by hand, that table is
 * wrong the first time a producer changes and nothing says so — the same
 * reason `sectionRegistry.pure.ts` exists at all.
 *
 * So it is generated. Run `npx tsx scripts/verify/section-ownership-matrix.mjs`
 * to rewrite `docs/reports/SECTION_OWNERSHIP_MATRIX.md`; a spec asserts the
 * committed file matches what this emits.
 */
import { writeFileSync } from 'node:fs';

const { SECTION_REGISTRY } = await import(
  '../../supabase/functions/_shared/reports/investment/sectionRegistry.pure.ts'
);

const TIERS = ['compass', 'financial', 'strategic', 'briefing', 'snapshot'];
const TIER_LABEL = {
  compass: 'Compass',
  financial: 'Financial Analysis',
  strategic: 'Strategic / Due Diligence',
  briefing: 'Executive Briefing',
  snapshot: 'Snapshot',
};

/**
 * The one format that carries a topic in full, if any does.
 *
 * A SPINE section is deliberately carried by every format — the cover, the key
 * figures, the verdict — so it has no single owner and saying it does would
 * invite somebody to remove it from four documents. Those return `spine`.
 */
function fullDetailOwner(section) {
  const carried = TIERS.filter((t) => {
    const p = section.tiers[t];
    return p && (p.depth === 'required' || p.depth === 'spine');
  });
  if (!carried.length) return null;
  if (carried.every((t) => section.tiers[t].depth === 'spine')) return 'spine';
  const required = carried.filter((t) => section.tiers[t].depth === 'required');
  // Where more than one carries it in full, the longest-form tier owns the
  // detail — that is what the tier framework means by a tier being a PURPOSE.
  const order = ['strategic', 'financial', 'compass', 'briefing', 'snapshot'];
  return (required.length ? required : carried).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
}

function producerOf(p) {
  if (!p || !p.producer) return '—';
  const pr = p.producer;
  if (typeof pr === 'string') return pr;
  return [pr.kind, pr.ref].filter(Boolean).join(' · ') || JSON.stringify(pr);
}

function placement(p) {
  if (!p) return '—';
  if (p.depth === 'merged') return `summary (in ${p.mergedInto})`;
  return p.depth;
}

const rows = SECTION_REGISTRY.map((s) => {
  const owner = fullDetailOwner(s);
  const summaries = TIERS.filter((t) => {
    const p = s.tiers[t];
    return p && (p.depth === 'merged' || (t !== owner && (p.depth === 'required' || p.depth === 'spine')));
  });
  const producers = [...new Set(TIERS.map((t) => producerOf(s.tiers[t])).filter((x) => x !== '—'))];
  return {
    topic: s.canonicalLabel,
    id: s.id,
    provenance: s.provenance,
    owner: owner === 'spine'
      ? 'every format (spine)'
      : owner ? TIER_LABEL[owner] : 'not carried in full by any format',
    summaries: owner === 'spine' ? [] : summaries.map((t) => TIER_LABEL[t]),
    producers,
    placements: TIERS.map((t) => placement(s.tiers[t])),
  };
});

const lines = [];
lines.push('# The five-format ownership matrix');
lines.push('');
lines.push('**Generated — do not hand-edit.** `npx tsx scripts/verify/section-ownership-matrix.mjs`');
lines.push('rewrites this from `sectionRegistry.pure.ts`, and a spec fails when the two');
lines.push('disagree. A matrix written by hand is wrong the first time a producer changes');
lines.push('and nothing says so.');
lines.push('');
lines.push('One row per topic. **Full detail** is the single format that carries it whole;');
lines.push('**summarised in** are the formats permitted to state a shortened version, and');
lines.push('nowhere else may. **Producer** is what actually makes the content — a projection');
lines.push('path, a model call, or a composition. `—` in a column means the format does not');
lines.push('carry the topic at all, which is a decision rather than an omission.');
lines.push('');
lines.push(`Sections: ${rows.length}. Formats: ${TIERS.map((t) => TIER_LABEL[t]).join(', ')}.`);
lines.push('');
lines.push(`| Topic | Provenance | Full detail | Summarised in | Producer(s) | ${TIERS.map((t) => TIER_LABEL[t]).join(' | ')} |`);
lines.push(`|---|---|---|---|---|${TIERS.map(() => '---').join('|')}|`);
for (const r of rows) {
  lines.push(
    `| ${r.topic} | ${r.provenance} | ${r.owner} | ${r.summaries.join('; ') || '—'} | `
    + `${r.producers.join('; ') || 'nothing yet'} | ${r.placements.join(' | ')} |`,
  );
}
lines.push('');

const gaps = rows.filter((r) => !r.producers.length);
lines.push('## Topics with no producer at all');
lines.push('');
if (!gaps.length) {
  lines.push('None. Every topic in the registry has something that makes it.');
} else {
  lines.push('A declared topic nothing produces. Each is an honest gap rather than a bug,');
  lines.push('and `PRODUCER_GAPS` in the registry records why; a NEW one fails CI.');
  lines.push('');
  for (const g of gaps) lines.push(`- **${g.topic}** (\`${g.id}\`)`);
}
lines.push('');

writeFileSync('docs/reports/SECTION_OWNERSHIP_MATRIX.md', lines.join('\n'));
console.log(`Wrote docs/reports/SECTION_OWNERSHIP_MATRIX.md — ${rows.length} topics, ${gaps.length} with no producer.`);
