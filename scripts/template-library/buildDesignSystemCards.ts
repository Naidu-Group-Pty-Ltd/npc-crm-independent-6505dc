/**
 * Emits the Design System pane cards for the report-template layer.
 *
 * The cards are GENERATED from `designSystem.ts` rather than hand-authored, so
 * the swatches in claude.ai/design cannot drift from the hexes the forty
 * templates actually compile with. Re-run after changing a voice:
 *
 *   npx tsx scripts/template-library/buildDesignSystemCards.ts
 *
 * Then push the output with the DesignSync tool. Output lands in
 * `.design-system/report-templates/` — build output, not source, and ignored
 * by git for the same reason `dist/` is.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCENTS, BRAND, CATEGORY_ACCENT, VOICES, type Voice,
} from './designSystem';
import { SEED_TEMPLATES } from './templates';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../.design-system/report-templates');

/** Shared chrome so every card matches the project's existing guideline cards. */
const CSS = `*{box-sizing:border-box}
body{margin:0;padding:16px;background:hsl(var(--background));color:hsl(var(--foreground));font-family:var(--font-sans);font-size:12px}
.tk{font-family:var(--font-mono);font-size:10px;color:hsl(var(--muted-foreground))}
.note{font-size:10.5px;color:hsl(var(--muted-foreground));margin:12px 0 0;line-height:1.45}
.eyebrow{margin:0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.18em}
.grid{display:grid;gap:10px}
.sw{height:44px;border-radius:8px;border:1px solid hsl(var(--border) / .7)}`;

function card(opts: {
  group: string; name: string; subtitle: string; viewport: string; body: string;
}): string {
  return `<!-- @dsCard group="${opts.group}" viewport="${opts.viewport}" name="${opts.name}" subtitle="${opts.subtitle}" -->
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${opts.name}</title>
<link rel="stylesheet" href="../styles.css">
<style>${CSS}</style>
</head><body>${opts.body}</body></html>`;
}

/** How many templates ship in each voice — the cards state real counts. */
function countByVoice(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of SEED_TEMPLATES) out[t.style] = (out[t.style] ?? 0) + 1;
  return out;
}

/**
 * One specimen per voice: the paper, the display face at its real cover size,
 * the section rule at its real weight and span, and the body face.
 */
function voiceSpecimen(v: Voice, count: number): string {
  const accent = ACCENTS.gold.primary;
  const ruleColor = v.ruleColor === 'accent' ? accent : v.line;
  return `<div style="border:1px solid hsl(var(--border) / .7);border-radius:10px;overflow:hidden">
    <div style="background:${v.field};color:${BRAND.ivory};padding:10px 12px">
      <p class="eyebrow" style="color:${accent}">${v.label}</p>
      <p style="margin:2px 0 0;font-family:'${v.display}',Georgia,serif;font-size:19px;line-height:1.15">${v.intent}</p>
    </div>
    <div style="background:${v.surface};padding:12px">
      <p class="eyebrow" style="color:${accent};font-size:8px">Executive summary</p>
      <p style="margin:3px 0 0;font-family:'${v.display}',Georgia,serif;font-size:${v.headingSize}px;color:${BRAND.ink};font-weight:600">The position</p>
      <div style="width:${Math.round(v.ruleSpan * 100)}%;border-top:${Math.max(v.ruleWeight, 1)}px ${v.ruleStyle} ${ruleColor};margin:7px 0"></div>
      <p style="margin:0;font-family:'${v.body}',system-ui,sans-serif;font-size:${v.bodySize}px;color:${BRAND.ink};line-height:1.45">
        Set in ${v.body} at ${v.bodySize}pt on ${v.surface === BRAND.white ? 'white' : 'warm'} stock.${v.mono ? ` Figures in ${v.mono}.` : ''}
      </p>
      <div style="display:flex;gap:6px;margin-top:9px">
        <div style="flex:1;background:${v.panel};border-radius:${v.radii.md}px;padding:6px 8px;border-left:3px solid ${accent}">
          <div style="font-size:14px;font-weight:700;color:${accent};font-variant-numeric:tabular-nums">$785,000</div>
          <div style="font-size:7px;text-transform:uppercase;letter-spacing:.14em;color:${BRAND.stone};margin-top:3px">Purchase price</div>
        </div>
      </div>
    </div>
    <div style="background:${v.surface};border-top:1px solid ${v.line};padding:5px 12px">
      <span class="tk">style: ${v.id} · ${count} template${count === 1 ? '' : 's'} · radii ${v.radii.sm}/${v.radii.md}pt</span>
    </div>
  </div>`;
}

function voicesCard(): string {
  const counts = countByVoice();
  const order: Voice['id'][] = ['corporate', 'editorial', 'minimal', 'luxury', 'technical'];
  return card({
    group: 'Report templates',
    name: 'The five report voices',
    subtitle: 'Chancery / Broadsheet / Slip / Marque / Cadastre',
    viewport: '1100x560',
    body: `<div class="grid" style="grid-template-columns:repeat(3,1fr)">
      ${order.map((k) => voiceSpecimen(VOICES[k], counts[k] ?? 0)).join('\n')}
    </div>
    <p class="note"><strong>Voice is the catalogue's <code>style</code> axis made structural.</strong>
    It used to be metadata with no visual consequence — every template rendered in Helvetica at
    17/9.5pt on white, so filtering the library to "editorial" returned documents identical to
    "technical". Each voice now fixes the paper, the display face, the type scale and the section
    rule. Accent colour is chosen separately, by subject, so forty documents stay coherent without
    becoming forty copies of one another.</p>`,
  });
}

function accentsCard(): string {
  const used = new Map<string, string[]>();
  for (const t of SEED_TEMPLATES) {
    const a = CATEGORY_ACCENT[t.category];
    if (a) used.set(a, [...(used.get(a) ?? []), t.category]);
  }
  const rows = (Object.keys(ACCENTS) as Array<keyof typeof ACCENTS>).map((key) => {
    const a = ACCENTS[key];
    const cats = [...new Set(used.get(key) ?? [])].join(', ') || '—';
    return `<div>
      <div class="sw" style="background:${a.primary}"></div>
      <p style="margin:6px 0 0;font-size:10.5px;font-weight:600">${key}</p>
      <p class="tk" style="margin:2px 0 0">${a.primary}</p>
      <p class="tk" style="margin:1px 0 0;opacity:.8">${cats}</p>
    </div>`;
  }).join('\n');
  return card({
    group: 'Report templates',
    name: 'Report accents by subject',
    subtitle: 'Six chromatic families, every one an existing NPC token',
    viewport: '820x260',
    body: `<div class="grid" style="grid-template-columns:repeat(6,1fr)">${rows}</div>
    <p class="note">Nothing here is invented for variety: gold is <code>--brand</code>, amethyst is
    <code>--primary</code>, info and evergreen are the semantic <code>--info</code> and
    <code>--success</code> (the latter darkened to 32% L, because the screen value is too bright to
    sit under 9pt type on paper), bronze is <code>--brand-950</code>. A report and the dashboard that
    produced it read as the same product.</p>`,
  });
}

function paperCard(): string {
  const stock: Array<[string, string, string]> = [
    ['ivory', BRAND.ivory, '--background · Broadsheet + Marque stock'],
    ['porcelain', BRAND.porcelain, '--card · Chancery + Cadastre stock'],
    ['champagne', BRAND.champagne, '--muted · tiles and table stripes'],
    ['beige', BRAND.beige, '--border · hairlines and footer rules'],
    ['stone', BRAND.stone, '--muted-foreground · labels, captions'],
    ['ink', BRAND.ink, '--foreground · body copy, never pure black'],
    ['obsidian', BRAND.obsidian, '--aurixa-obsidian · cover fields'],
  ];
  return card({
    group: 'Report templates',
    name: 'Paper and ink',
    subtitle: 'The neutral ramp every voice draws from',
    viewport: '900x250',
    body: `<div class="grid" style="grid-template-columns:repeat(7,1fr)">
      ${stock.map(([n, hex, src]) => `<div>
        <div class="sw" style="background:${hex}"></div>
        <p style="margin:6px 0 0;font-size:10.5px;font-weight:600">${n}</p>
        <p class="tk" style="margin:2px 0 0">${hex}</p>
        <p class="tk" style="margin:1px 0 0;opacity:.8">${src}</p>
      </div>`).join('\n')}
    </div>
    <p class="note">Reports print on warm stock, not clinical white, and set in graphite rather than
    black — the same warmth the light theme carries. The catalogue previously used
    <code>#FFFFFF</code> paper with a navy-and-gold palette that appeared nowhere else in the
    product.</p>`,
  });
}

function eyebrowCard(): string {
  const v = VOICES.corporate;
  return card({
    group: 'Report templates',
    name: 'The section eyebrow, on paper',
    subtitle: 'The brand signature carried onto every report page',
    viewport: '700x260',
    body: `<div style="background:${v.surface};border:1px solid ${v.line};border-radius:10px;padding:16px">
      <p class="eyebrow" style="color:${ACCENTS.gold.primary};font-size:8px">Financial analysis</p>
      <p style="margin:4px 0 0;font-family:'${v.display}',Georgia,serif;font-size:${v.headingSize}px;font-weight:600;color:${BRAND.ink}">Acquisition and first-year position</p>
      <div style="border-top:${v.ruleWeight}px solid ${ACCENTS.gold.primary};margin:9px 0 0"></div>
      <p style="margin:9px 0 0;font-family:'${v.body}',system-ui,sans-serif;font-size:${v.bodySize}px;color:${BRAND.ink};line-height:1.5">
        Acquisition costs, funding structure and the first-year position.
      </p>
    </div>
    <p class="note">The wide uppercase eyebrow is already the brand's strongest typographic
    signature (<code>--tracking-eyebrow</code>, 0.18em). In the report library it was used on covers
    only. Carrying it onto every section heading is structure that encodes something true: a reader
    eleven pages into a dossier always knows which section they are in.</p>`,
  });
}

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const files: Array<[string, string]> = [
    ['voices.card.html', voicesCard()],
    ['accents.card.html', accentsCard()],
    ['paper.card.html', paperCard()],
    ['eyebrow.card.html', eyebrowCard()],
  ];
  for (const [name, html] of files) writeFileSync(resolve(OUT, name), html);
  console.log(`✓ ${files.length} cards → ${OUT.replace(resolve(__dirname, '../..') + '/', '')}`);
  for (const [name] of files) console.log(`  ${name}`);
}

main();
