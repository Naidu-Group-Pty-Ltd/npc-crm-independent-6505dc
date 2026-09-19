/**
 * The one stand-in in the S5 condense run — and what it is allowed to be.
 *
 * `condense-investment-report` makes exactly ONE model call per document: the
 * condensed prose. Everything after it is `composeCondensedDocument`, which is
 * deterministic and is what this run exists to verify. A model call cannot be
 * made from here (no vendor key is held in this sandbox, and buying one would
 * spend a forwarded credential for a verification run), so the prose is stood
 * in for — and the substitution is NAMED on every run and in the document
 * trail rather than being quietly indistinguishable from a real answer.
 *
 * ## What makes it a fair stand-in
 *
 * It **copies the parent's own blocks whole**. Every sentence, every table row
 * and every figure in what it returns was written by the model that wrote the
 * parent report, about this property, and is already in the record. It
 * composes nothing, rewrites nothing and rounds nothing.
 *
 * That is narrower than a real condensation — a model would rewrite, not
 * excerpt — and it is deliberately narrower in the one direction that matters:
 * **it cannot invent a figure.** The single failure mode that would make the
 * rendered document lie is off the table, so a number that appears in the
 * output and not in the parent is the COMPOSITION's, which is the thing under
 * test. A stand-in that could also invent would make every finding ambiguous.
 *
 * ## What it refuses to do
 *
 * The tier guides' hard rules bind it exactly as they bind the model:
 *
 *  - It writes **no financial table** (costs, yield, loan, cashflow,
 *    sensitivity, projections, LVR) and **no score or SWOT section**. Those
 *    are attached by the composition from the recorded calculation, and
 *    anything written here would duplicate or contradict them.
 *  - It writes **only the headings the tier declares**. A section it has
 *    nothing to copy for is **omitted**, never filled with "N/A" — which is
 *    the guides' own instruction, and is what makes the composition's
 *    `dropEmptySections` and registry trim do real work on this run.
 *
 * ## Why the sections are found by shape
 *
 * The two subjects do not agree on their own headings — Annabelle calls its
 * risk table `## Risk Dashboard` and Pallas calls the same thing
 * `## Consolidated Risk Register`. So a mapping is a list of CANDIDATE
 * headings plus, where it matters, the shape of the block wanted (a table
 * whose first column is the risk). Pinning one spelling would have produced a
 * document for one property and a hole for the other, and the hole would have
 * read as a composition defect.
 */

/** Where each declared heading's material came from, for the run log. */
export interface StandInTrace {
  heading: string;
  from: string[];
  chars: number;
}

export interface StandInResult {
  markdown: string;
  trace: StandInTrace[];
  /** Declared headings the parent gave nothing for. Omitted, never filled. */
  omitted: string[];
}

interface Section { heading: string; level: number; body: string; }

/** Every `##`/`###` section of a stored report, in order. */
function sections(markdown: string): Section[] {
  const out: Section[] = [];
  const re = /^(#{2,3})\s+(.+?)\s*$/gm;
  const marks = [...markdown.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : markdown.length;
    out.push({ heading: m[2], level: m[1].length, body: markdown.slice(start, end).trim() });
  }
  return out;
}

/** The first section whose heading matches any candidate, case-insensitively. */
function find(secs: Section[], candidates: readonly string[]): Section | null {
  for (const want of candidates) {
    const hit = secs.find((s) => s.heading.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  for (const want of candidates) {
    const hit = secs.find((s) => s.heading.toLowerCase().includes(want.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

/**
 * A section's own body plus every `###` under it — the whole of what the
 * parent said on the topic, which is what "condense the parent's X sections"
 * means.
 */
function withChildren(secs: Section[], s: Section): string {
  const at = secs.indexOf(s);
  const parts = [s.body];
  for (let i = at + 1; i < secs.length && secs[i].level > s.level; i++) {
    parts.push(`**${secs[i].heading}.** ${secs[i].body}`);
  }
  return parts.join('\n\n').trim();
}

/** Paragraphs of prose: no directive, no table, no bullet list, no heading. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p
      && !p.startsWith('{{')
      && !p.startsWith('|')
      && !p.startsWith('#')
      && !/^[-*]\s/.test(p)
      && !/^\d+\.\s/.test(p));
}

/** Whole paragraphs, up to a word budget — never a cut sentence. */
function upTo(body: string, words: number): string {
  const kept: string[] = [];
  let spent = 0;
  for (const p of paragraphs(body)) {
    const n = p.split(/\s+/).length;
    if (kept.length && spent + n > words) break;
    kept.push(p);
    spent += n;
    if (spent >= words) break;
  }
  return kept.join('\n\n');
}

/** The first markdown table in a body, header and all rows, whole. */
function firstTable(body: string): string | null {
  const lines = body.split('\n');
  const at = lines.findIndex((l, i) => l.trim().startsWith('|') && /^\s*\|[\s|:-]+\|\s*$/.test(lines[i + 1] ?? ''));
  if (at === -1) return null;
  const rows: string[] = [];
  for (let i = at; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(lines[i].trim());
  return rows.length > 2 ? rows.join('\n') : null;
}

/** The table anywhere in the report whose first column names a risk. */
function riskTable(secs: Section[]): { table: string; from: string } | null {
  for (const s of secs) {
    const t = firstTable(s.body);
    if (!t) continue;
    const head = t.split('\n')[0].toLowerCase();
    if (/\|\s*risk[\s\w]*\|/.test(head) && head.includes('level')) return { table: t, from: s.heading };
  }
  return null;
}

/** Items of a `{{glance: …}}` directive carrying one of these marks. */
function glance(body: string, marks: readonly string[]): string[] {
  const m = body.match(/\{\{\s*glance:\s*([\s\S]*?)\}\}/);
  if (!m) return [];
  return m[1].split('|')
    .map((s) => s.trim())
    .filter((s) => marks.some((mark) => s.startsWith(mark)))
    .map((s) => s.slice(1).trim())
    .filter(Boolean);
}

/** Bullet items of a body, in order. */
function bullets(body: string, n: number): string[] {
  return body.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+\S/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, ''))
    .slice(0, n);
}

/**
 * Three opportunities and three risks, from what the parent already carries.
 *
 * Opportunities come from the parent's own positive glance marks (`✓`, `◆`,
 * `★`) — the report's own summary of what is in this property's favour. Risks
 * come from the risk table's first three rows, condensed to the risk and why
 * it matters, because that table is the parent's ranked view and its first
 * column is already a one-line statement of each.
 */
function topThree(secs: Section[], kind: 'opportunity' | 'risk'): { items: string[]; from: string } | null {
  if (kind === 'opportunity') {
    for (const s of secs) {
      const items = glance(s.body, ['✓', '◆', '★']);
      if (items.length >= 2) return { items: items.slice(0, 3), from: s.heading };
    }
    const rec = find(secs, ['Final Recommendation', 'Recommendation']);
    if (rec) {
      const items = bullets(rec.body, 3);
      if (items.length) return { items, from: rec.heading };
    }
    return null;
  }
  const risks = riskTable(secs);
  if (!risks) return null;
  const rows = risks.table.split('\n').slice(2, 5).map((r) => {
    const cells = r.split('|').map((c) => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
    const name = cells[0] ?? '';
    const level = cells[1] ?? '';
    const why = (cells[2] ?? '').split(/(?<=[.!?])\s/)[0] ?? '';
    return `**${name}** (${level}) — ${why}`;
  }).filter((r) => r.length > 12);
  return rows.length ? { items: rows, from: risks.from } : null;
}

/** One declared heading of a condensed tier, and where its material comes from. */
interface Mapping {
  heading: string;
  build: (secs: Section[]) => { body: string; from: string[] } | null;
}

/**
 * A section's prose — and WHERE a parent keeps it varies.
 *
 * `sections()` splits on every heading, so a `##` whose first line is a `###`
 * has a body of only what sits above that sub-heading. On Annabelle that is
 * three paragraphs of Executive Verdict; on Pallas it is a lone
 * `{{glance: …}}` directive, because every word of its verdict is under
 * `### Overall Investment Verdict`. The first run produced a Briefing with no
 * Executive Summary for Pallas and a full one for Annabelle, from one mapping.
 *
 * So the children are the fallback, always: take the section's own prose, and
 * where it has none, take the section WITH its sub-headings. `children: true`
 * asks for both together, for a topic the parent splits deliberately.
 */
const fromSection = (
  heading: string,
  candidates: readonly string[],
  words: number,
  opts: { children?: boolean } = {},
): Mapping => ({
  heading,
  build: (secs) => {
    const hit = find(secs, candidates);
    if (!hit) return null;
    const body = opts.children
      ? upTo(withChildren(secs, hit), words)
      : (upTo(hit.body, words) || upTo(withChildren(secs, hit), words));
    return body ? { body, from: [hit.heading] } : null;
  },
});

const listMapping = (heading: string, kind: 'opportunity' | 'risk'): Mapping => ({
  heading,
  build: (secs) => {
    const got = topThree(secs, kind);
    if (!got) return null;
    return { body: got.items.map((i) => `- ${i}`).join('\n'), from: [got.from] };
  },
});

const BRIEFING: Mapping[] = [
  fromSection('Executive Summary', ['Executive Verdict', 'Executive Summary'], 180),
  { // The parent's location case and its demand case are one section here.
    heading: 'Location & Demand',
    build: (secs) => {
      const parts: string[] = [];
      const from: string[] = [];
      for (const [cands, words] of [
        [['Why This Location Matters', 'Location Overview'], 320],
        [['Demand Drivers', 'Demand'], 260],
      ] as const) {
        const hit = find(secs, cands);
        if (!hit) continue;
        const body = upTo(withChildren(secs, hit), words);
        if (body) { parts.push(body); from.push(hit.heading); }
      }
      return parts.length ? { body: parts.join('\n\n'), from } : null;
    },
  },
  {
    heading: 'Amenity & Access',
    build: (secs) => {
      const parts: string[] = [];
      const from: string[] = [];
      for (const [cands, words] of [
        [['Amenity & Access', 'Amenity and Access'], 300],
        [['Transport & Connectivity', 'Transport'], 180],
      ] as const) {
        const hit = find(secs, cands);
        if (!hit) continue;
        const body = upTo(withChildren(secs, hit), words);
        if (body) { parts.push(body); from.push(hit.heading); }
      }
      return parts.length ? { body: parts.join('\n\n'), from } : null;
    },
  },
  fromSection('Market Position', ['Market Positioning', 'Market Position'], 280, { children: true }),
  fromSection('Property Fit', ['Property Fit Within the Suburb', 'Property Fit'], 260, { children: true }),
  { // The guide asks for the risk TABLE, kept as a table, with its columns.
    heading: 'Risk Overview',
    build: (secs) => {
      const risks = riskTable(secs);
      if (!risks) return null;
      return { body: risks.table, from: [risks.from] };
    },
  },
  listMapping('Top 3 Opportunities', 'opportunity'),
  listMapping('Top 3 Risks', 'risk'),
  fromSection('Recommendation', ['Final Recommendation', 'Recommendation'], 200),
  fromSection('Market Data Sources', ['Source notes', 'Appendix, Source Notes & Disclaimer', 'Sources'], 400),
];

const SNAPSHOT: Mapping[] = [
  fromSection('Property Summary', ['Property & Locality Snapshot', 'Property Summary'], 180),
  { // OBSERVED market statistics with their source, as a table, or nothing.
    // Neither subject's parent carries one; the guide's own rule is to omit
    // the section rather than write a placeholder, so it is omitted and the
    // run names it.
    heading: 'Key Market Stats',
    build: (secs) => {
      for (const s of secs) {
        const t = firstTable(s.body);
        if (!t) continue;
        const head = t.split('\n')[0].toLowerCase();
        if (/\|\s*metric\s*\|/.test(head) && head.includes('source')) return { body: t, from: [s.heading] };
      }
      return null;
    },
  },
  listMapping('Top 3 Opportunities', 'opportunity'),
  listMapping('Top 3 Risks', 'risk'),
  fromSection('Quick Recommendation', ['Final Recommendation', 'Recommendation'], 90),
  fromSection('Market Data Sources', ['Source notes', 'Appendix, Source Notes & Disclaimer', 'Sources'], 300),
];

export const STAND_IN_NOTE =
  'model prose stood in for by a whole-block excerpt of the parent report '
  + '(scripts/reports/_condenseStandIn.mts) — it copies and never composes, so it cannot invent a figure';

export function condenseStandIn(parentContent: string, tier: 'briefing' | 'snapshot'): StandInResult {
  const secs = sections(parentContent);
  const mappings = tier === 'briefing' ? BRIEFING : SNAPSHOT;
  const parts: string[] = [];
  const trace: StandInTrace[] = [];
  const omitted: string[] = [];
  for (const m of mappings) {
    const got = m.build(secs);
    if (!got || !got.body.trim()) { omitted.push(m.heading); continue; }
    parts.push(`## ${m.heading}\n\n${got.body.trim()}`);
    trace.push({ heading: m.heading, from: got.from, chars: got.body.length });
  }
  return { markdown: `${parts.join('\n\n')}\n`, trace, omitted };
}
