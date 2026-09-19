/**
 * Turn a rendered review artefact into a PDF on the production print contract.
 *
 * These are not client documents — they carry no logo and make no brand claim
 * (`.claude/skills/npc-services-design/reports/REPORT_RULES.md` §5). What they
 * do borrow is everything that decides whether a long technical document can
 * actually be READ on paper: ivory rather than white, graphite rather than
 * black, the contrast floors by size, the installed display faces, and no
 * shadow, gradient or glass — none of which survives WeasyPrint anyway.
 *
 * The Markdown goes through `_shared/reports/markdown.pure.ts`, the
 * programme's only Markdown implementation, so a review document and a client
 * document are typeset by the same escape-first renderer.
 *
 *     npx tsx scripts/reports/reviewDocument.mts <in.md> <out.html> "<title>" "<subtitle>"
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderMarkdown } from '../../supabase/functions/_shared/reports/markdown.pure.ts';

const [inPath, outPath, title, subtitle] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: reviewDocument.mts <in.md> <out.html> [title] [subtitle]');
  process.exit(1);
}

/*
 * The render scripts frame each block with a run of `█` and each rule block
 * with `--- NAME ---`. Both are terminal furniture: they carry the structure
 * and would print as literal noise. They become headings, so the PDF has a
 * real outline and the tagged structure tree has something to hold.
 */
function normalise(source: string): string {
  const out: string[] = [];
  const lines = source.split('\n');
  let banner: string[] = [];
  let rules: string[] | null = null;

  const flushBanner = () => {
    if (!banner.length) return;
    out.push('', `# ${banner[0]}`, '');
    if (banner.length > 1) out.push(`*${banner.slice(1).join(' · ')}*`, '');
    banner = [];
  };
  /*
   * A rule block is verbatim text a MODEL is handed, not prose a reader is
   * handed, and the difference is worth seeing on the page. It is also
   * numbered `1.`, `2.`, `3.`, `3a.` — which Markdown would read as an ordered
   * list and renumber, losing exactly the identifiers the rules are referred
   * to by. A fence keeps every character and every number.
   */
  const flushRules = () => {
    if (!rules) return;
    const body = rules.join('\n').trim();
    if (body) out.push('', '```', body, '```', '');
    rules = null;
  };

  /*
   * A banner is the block BETWEEN two full-width rules:
   *
   *     ████████████████    or    ################
   *     █ Title                   # Title
   *     █ meta                    # meta
   *     ████████████████          ################
   *
   * Tracked as a mode rather than matched per line, because `#` is also the
   * Markdown heading marker — and matching `^[█#]` per line swallowed every
   * `## Heading` in the document, turning it into a banner whose text still
   * carried a hash. It printed as "# SWOT Analysis" on page 2 of the first
   * render. The rule lines are unambiguous; the content lines are not.
   */
  let inBanner = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^█{10,}$/.test(trimmed) || /^#{10,}$/.test(trimmed)) {
      if (inBanner) flushBanner();
      inBanner = !inBanner;
      continue;
    }
    if (inBanner) {
      flushRules();
      const text = line.replace(/^[█#]\s?/, '').trim();
      if (text) banner.push(text);
      continue;
    }

    const divider = line.match(/^-{3,}\s*(.+?)\s*-{3,}$/);
    if (divider) {
      flushRules();
      const heading = divider[1].trim();
      out.push('', `## ${heading}`, '');
      if (/PINNED RULES/i.test(heading)) rules = [];
      continue;
    }

    if (rules) { rules.push(line); continue; }
    out.push(line);
  }
  flushBanner();
  flushRules();
  return out.join('\n');
}

const source = normalise(readFileSync(inPath, 'utf8'));
const rendered = renderMarkdown(source, {
  baseHeadingLevel: 2,
  dropEmptyHeadings: false,
  idPrefix: 'review',
  codeLabel: 'Supplied to the model verbatim',
});
if (rendered.degraded) {
  console.error('CONTENT LOST:', JSON.stringify(rendered.notices));
  process.exit(2);
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

/*
 * §1 paper and ink, §2 contrast floors, §4 typography — the brand's own print
 * values, stated here as literals because a review artefact has no tenant to
 * resolve a palette from. The gold is the DARKENED derivation §2 requires
 * (#8A6410, ≈5.6:1 on ivory) and never `--brand` at full saturation.
 */
const css = `
@page {
  size: A4;
  margin: 20mm 17mm 18mm 17mm;
  background: #FAF7F1;
  @top-left {
    content: "${esc(title ?? '')}";
    font-family: Inter, sans-serif; font-size: 7.5pt; letter-spacing: 0.08em;
    text-transform: uppercase; color: #6B6257; vertical-align: bottom; padding-bottom: 4mm;
  }
  @bottom-right {
    content: counter(page) " / " counter(pages);
    font-family: "IBM Plex Mono", monospace; font-size: 7.5pt; color: #6B6257;
    vertical-align: top; padding-top: 4mm;
  }
}
@page :first { @top-left { content: ""; } }

:root { }
html { background: #FAF7F1; }
body {
  background: #FAF7F1;
  color: #2B2823;
  font-family: Inter, "Liberation Sans", sans-serif;
  font-size: 9.5pt;
  line-height: 1.52;
  margin: 0;
  hyphens: none;
}

/* ── The cover ─────────────────────────────────────────────────────────── */
.cover { page-break-after: always; padding-top: 42mm; }
.cover .eyebrow {
  font-family: Inter, sans-serif; font-size: 8.5pt; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: #8A6410;
  margin: 0 0 6mm 0;
}
.cover h1 {
  font-family: Cinzel, "Playfair Display", serif; font-weight: 700;
  font-size: 30pt; line-height: 1.16; color: #1C1A16; margin: 0 0 5mm 0;
  letter-spacing: 0.01em;
  /* The body rule below breaks before every h1 — which on the cover pushed the
     title, the rule, the strapline and the whole note onto page 2 and left an
     eyebrow alone on page 1. A cover's h1 is not a chapter opener. */
  page-break-before: auto; border-top: 0; padding-top: 0;
}
.cover .sub {
  font-family: "Playfair Display", serif; font-size: 12.5pt; line-height: 1.5;
  color: #4A443B; margin: 0 0 12mm 0; max-width: 132mm;
}
.cover .rule { border: 0; border-top: 1.5pt solid #8A6410; width: 34mm; margin: 0 0 9mm 0; }
.cover dl { margin: 0; font-size: 9pt; }
.cover dt {
  font-family: Inter, sans-serif; font-size: 7.5pt; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase; color: #6B6257; margin-top: 5mm;
}
.cover dd { margin: 1mm 0 0 0; color: #2B2823; }
.cover .note {
  margin-top: 16mm; padding: 5mm 6mm; background: #F2ECDD;
  border-left: 2.5pt solid #8A6410; font-size: 8.5pt; line-height: 1.5; color: #3A352E;
}

/* ── Headings ──────────────────────────────────────────────────────────── */
/* The banner becomes the shallowest heading in the run, which the Markdown
   renderer maps to h2 — so the CHAPTER opener is h2, not h1, and the source's
   own two-hash sections land at h3 beneath it. */
h2 {
  font-family: Cinzel, "Playfair Display", serif; font-weight: 700;
  font-size: 15pt; line-height: 1.24; color: #1C1A16;
  margin: 0 0 1mm 0; padding-top: 4mm;
  border-top: 2pt solid #1C1A16;
  page-break-before: always; page-break-after: avoid;
}
h2 + p { margin: 0 0 8mm 0; }
h2 + p em {
  color: #6B6257; font-style: normal; font-size: 8pt;
  font-family: "IBM Plex Mono", monospace; letter-spacing: 0.01em;
}
h3 {
  font-family: "Playfair Display", serif; font-weight: 600;
  font-size: 12.5pt; line-height: 1.3; color: #1C1A16;
  margin: 8mm 0 2.5mm 0; padding-bottom: 1.5mm;
  border-bottom: 0.6pt solid #CFC6B4;
  page-break-after: avoid;
}
h4 {
  font-family: Inter, sans-serif; font-weight: 600; font-size: 9pt;
  letter-spacing: 0.1em; text-transform: uppercase; color: #8A6410;
  margin: 6mm 0 2mm 0; page-break-after: avoid;
}
h5, h6 {
  font-family: Inter, sans-serif; font-weight: 600; font-size: 9.5pt;
  color: #1C1A16; margin: 5mm 0 1.5mm 0; page-break-after: avoid;
}

/* ── Body ──────────────────────────────────────────────────────────────── */
p { margin: 0 0 3mm 0; orphans: 2; widows: 2; }
strong { font-weight: 600; color: #1C1A16; }
em { font-style: italic; }
a { color: #6B4A08; text-decoration: none; }

ul, ol { margin: 0 0 3.5mm 0; padding-left: 5.5mm; }
li { margin: 0 0 2mm 0; orphans: 2; widows: 2; }
li::marker { color: #8A6410; }

/* ── Tables ────────────────────────────────────────────────────────────── */
table {
  width: 100%; border-collapse: collapse; margin: 3mm 0 5mm 0;
  font-size: 8.2pt; line-height: 1.42;
  font-variant-numeric: tabular-nums;
}
thead { display: table-header-group; }
th {
  text-align: left; vertical-align: bottom;
  font-family: Inter, sans-serif; font-weight: 600; font-size: 7.4pt;
  letter-spacing: 0.07em; text-transform: uppercase; color: #4A443B;
  background: #F2ECDD; padding: 2mm 2.4mm;
  border-bottom: 1pt solid #9C927F;
}
td { padding: 2mm 2.4mm; vertical-align: top; border-bottom: 0.4pt solid #DFD7C6; }
tbody th {
  vertical-align: top; text-transform: none; letter-spacing: 0.01em;
  font-size: 8.2pt; color: #1C1A16; background: #F2ECDD;
  border-bottom: 0.4pt solid #DFD7C6; width: 17%;
}
tbody tr:nth-child(even) td { background: #F6F1E6; }

/* ── The pinned-rule blocks ────────────────────────────────────────────── */
/* Verbatim text a MODEL is handed, set apart from prose a READER is handed by
   ground and face rather than by colour, at the 7:1 floor section 2 sets for
   anything under 10pt. The Markdown renderer wraps a fence as
   div.callout > span.callout-label + p > code, so that is what is styled. */
.callout {
  background: #F2ECDD; border-left: 2.5pt solid #9C927F;
  padding: 3.5mm 4.5mm 4mm 4.5mm; margin: 3mm 0 5mm 0;
  /* A block that does not fit moves whole to the next page rather than
     leaving its label over an empty panel — which is what page 3 of the first
     S5-F render printed under "Pinned rules: subject price". A block taller
     than a page still breaks, having first been given a fresh one. */
  break-inside: avoid; page-break-inside: avoid;
}
.callout-label {
  display: block;
  font-family: Inter, sans-serif; font-size: 7.2pt; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase; color: #6B6257;
  margin: 0 0 2.5mm 0;
  break-after: avoid; page-break-after: avoid;
}
.callout p { margin: 0; }
.callout code {
  display: block; background: none; padding: 0;
  font-family: "IBM Plex Mono", monospace; font-size: 7.6pt; line-height: 1.52;
  color: #3A352E; white-space: pre-wrap;
}

blockquote {
  margin: 3mm 0 4mm 0; padding: 3mm 4mm; background: #F2ECDD;
  border-left: 2.5pt solid #8A6410; font-size: 9pt; color: #3A352E;
}
blockquote p:last-child { margin-bottom: 0; }

code, pre {
  font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: #3A352E;
}
code { background: #F2ECDD; padding: 0.4mm 1mm; }
pre {
  background: #F2ECDD; border-left: 2.5pt solid #9C927F;
  padding: 3mm 4mm; margin: 3mm 0 4mm 0; line-height: 1.45;
  white-space: pre-wrap; overflow-wrap: break-word;
}
pre code { background: none; padding: 0; }

hr { border: 0; border-top: 0.6pt solid #CFC6B4; margin: 6mm 0; }
`;

const html = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<title>${esc(title ?? 'Review document')}</title>
<style>${css}</style>
</head>
<body>
<section class="cover">
  <p class="eyebrow">NPC Property Dashboard · Review artefact</p>
  <h1>${esc(title ?? 'Review document')}</h1>
  <hr class="rule">
  <p class="sub">${esc(subtitle ?? '')}</p>
  <dl>
    <dt>Produced</dt><dd>18 September 2026</dd>
    <dt>Branch</dt><dd>claude/adoring-hopper-g02tdt</dd>
    <dt>Engine</dt><dd>WeasyPrint 69.0, PDF/UA-1, tagged — the production print contract</dd>
  </dl>
  <p class="note"><strong>What this is.</strong> The production modules run against
  production data read on 18 September 2026 by SELECT-only queries. Every figure
  below is read from <code>investment_reports</code> and <code>market_sales_medians</code>
  on project <code>dduzbchuswwbefdunfct</code>; none is a sample, a fixture written by
  hand, or a value this document invented.
  <br><br><strong>What it is not.</strong> No report has been generated with this code.
  The interaction between these composed sections and the model-authored prose around
  them is unverified, as is the page flow through the template renderer.</p>
</section>
${rendered.html}
</body>
</html>`;

writeFileSync(outPath, html, 'utf8');
console.log(`${outPath}: ${html.length} bytes, ${rendered.headings.length} headings, ${rendered.blocks.length} blocks`);
