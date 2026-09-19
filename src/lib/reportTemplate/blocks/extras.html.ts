/**
 * Phase 3 — Block Library Expansion
 * 20 new HTML block renderers. Each follows the same conventions as the
 * existing `*.html.ts` blocks (absolute positioning, pt units, bindings).
 */
import type { Block } from '../templateSchema';
import { evalConditional, resolveBindable, resolveBindableColor } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';
import { imgTag, esc, type HtmlBlockContext } from './_shared.html';
import { LONE_SURVIVOR_FLOOR, resolveDataPath } from './_data';

type R = Record<string, unknown>;

/**
 * Neutral roles for this block family.
 *
 * These twenty renderers previously hard-coded a slate palette (`${ink(ctx)}`,
 * `${muted(ctx)}`, `${line(ctx)}`) and `Helvetica`, so a template's voice stopped at the
 * block boundary: a definition list printed navy Helvetica inside a report set
 * in graphite and Playfair. Each fallback below is the literal it replaced, so
 * a template that declares none of these tokens renders exactly as before.
 */
const ink = (ctx: HtmlBlockContext) => resolveBindableColor('token:ink', ctx, '${ink(ctx)}');
const muted = (ctx: HtmlBlockContext) => resolveBindableColor('token:muted', ctx, '${muted(ctx)}');
const line = (ctx: HtmlBlockContext) => resolveBindableColor('token:line', ctx, '${line(ctx)}');
/** Body and heading faces, falling back to the engine default. */
const BODY = 'var(--font-body, Helvetica)';
const HEAD = 'var(--font-heading, Helvetica)';

function box(p: R, ctx: HtmlBlockContext, defH?: number): string {
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const h = p.height != null ? `height:${Number(p.height)}pt;` : defH ? `height:${defH}pt;` : '';
  return `position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;${h}`;
}

function title(t: unknown, ctx: HtmlBlockContext, color?: string): string {
  const s = String(t ?? '').trim();
  if (!s) return '';
  return `<div style="font:700 14pt/1.2 ${HEAD};color:${color ?? ink(ctx)};margin-bottom:10pt;letter-spacing:0.2pt;">${esc(s)}</div>`;
}

// ── 1. Timeline (horizontal milestones) ──────────────────────────────────────
export function renderTimelineHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const cols = items
    .map(
      (it) => `<div style="flex:1;position:relative;text-align:center;">
        <div style="width:14pt;height:14pt;border-radius:50%;background:${accent};margin:0 auto 6pt;border:2pt solid #fff;box-shadow:0 0 0 1pt ${accent};"></div>
        <div style="font:700 9.5pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.label, ctx))}</div>
        <div style="font:400 8pt ${BODY};color:${muted(ctx)};margin-top:2pt;">${esc(resolveBindable(it.date, ctx))}</div>
        ${it.note ? `<div style="font:400 8pt ${BODY};color:${muted(ctx)};margin-top:4pt;line-height:1.3;">${esc(resolveBindable(it.note, ctx))}</div>` : ''}
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">
    ${title(resolveBindable(p.title, ctx), ctx)}
    <div style="position:relative;padding-top:6pt;">
      <div style="position:absolute;left:6%;right:6%;top:13pt;height:2pt;background:${accent};opacity:0.35;"></div>
      <div style="display:flex;gap:8pt;position:relative;">${cols}</div>
    </div>
  </div>`;
}

// ── 2. SWOT 2×2 ──────────────────────────────────────────────────────────────
export function renderSwotHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const quads: Array<[string, string, string, unknown]> = [
    ['Strengths', '#ECFDF3', '#16A34A', p.strengths],
    ['Weaknesses', '#FEF2F2', '#DC2626', p.weaknesses],
    ['Opportunities', '#EEF4FB', '#2563EB', p.opportunities],
    ['Threats', '#FFF7ED', '#D97706', p.threats],
  ];
  const cell = quads
    .map(([label, bg, accent, list]) => {
      const items = Array.isArray(list) ? (list as unknown[]) : [];
      return `<div style="background:${bg};border-top:3pt solid ${accent};border-radius:4pt;padding:10pt 12pt;">
        <div style="font:700 10pt ${BODY};color:${accent};margin-bottom:6pt;text-transform:uppercase;letter-spacing:0.5pt;">${label}</div>
        <ul style="margin:0;padding-left:14pt;font:400 9pt/1.4 ${BODY};color:${ink(ctx)};">
          ${items.map((i) => `<li>${esc(resolveBindable(i, ctx))}</li>`).join('')}
        </ul>
      </div>`;
    })
    .join('');
  return `<div style="${box(p, ctx)}">
    ${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10pt;">${cell}</div>
  </div>`;
}

// ── 3. Mini Gantt ────────────────────────────────────────────────────────────
export function renderGanttHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const min = Number(p.startMonth ?? 1);
  const max = Number(p.endMonth ?? 12);
  const span = Math.max(1, max - min + 1);
  const months = Array.from({ length: span }, (_, i) => min + i);
  const head = months.map((m) => `<div style="flex:1;text-align:center;font:600 7.5pt ${BODY};color:${muted(ctx)};">M${m}</div>`).join('');
  const rows = items
    .map((it) => {
      const s = Math.max(min, Number(it.start ?? min));
      const e = Math.min(max, Number(it.end ?? min));
      const leftPct = ((s - min) / span) * 100;
      const widthPct = ((e - s + 1) / span) * 100;
      return `<div style="display:flex;align-items:center;gap:8pt;margin-top:6pt;">
        <div style="width:120pt;font:500 9pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.label, ctx))}</div>
        <div style="flex:1;position:relative;height:14pt;background:${line(ctx)};border-radius:3pt;">
          <div style="position:absolute;left:${leftPct}%;width:${widthPct}%;top:0;bottom:0;background:${accent};border-radius:3pt;"></div>
        </div>
      </div>`;
    })
    .join('');
  return `<div style="${box(p, ctx)}">
    ${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:flex;align-items:center;gap:8pt;"><div style="width:120pt;"></div><div style="flex:1;display:flex;">${head}</div></div>
    ${rows}
  </div>`;
}

// ── 4. Comparison table (this vs that) ───────────────────────────────────────
export function renderComparisonHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const columns = Array.isArray(p.columns) ? (p.columns as R[]) : [];
  const rows = Array.isArray(p.rows) ? (p.rows as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const head = `<tr>
    <th style="text-align:left;padding:8pt 10pt;font:600 9pt ${BODY};color:${muted(ctx)};border-bottom:1pt solid ${line(ctx)};"></th>
    ${columns.map((c, i) => `<th style="text-align:center;padding:8pt 10pt;font:700 10pt ${BODY};color:${i === 0 ? accent : '${ink(ctx)}'};border-bottom:1pt solid ${line(ctx)};background:${i === 0 ? '#FAF7EE' : 'transparent'};">${esc(resolveBindable(c.label, ctx))}</th>`).join('')}
  </tr>`;
  const body = rows
    .map(
      (r) => `<tr>
        <td style="padding:8pt 10pt;font:500 9pt ${BODY};color:${ink(ctx)};border-bottom:1pt solid ${line(ctx)};">${esc(resolveBindable(r.label, ctx))}</td>
        ${columns.map((_c, i) => `<td style="text-align:center;padding:8pt 10pt;font:400 9pt ${BODY};color:${ink(ctx)};border-bottom:1pt solid ${line(ctx)};background:${i === 0 ? '#FCFAF3' : 'transparent'};">${esc(resolveBindable((r.values as unknown[])?.[i], ctx))}</td>`).join('')}
      </tr>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">
    ${title(resolveBindable(p.title, ctx), ctx)}
    <table style="width:100%;border-collapse:collapse;border-radius:4pt;overflow:hidden;">${head}${body}</table>
  </div>`;
}

// ── 5. Stat callout (big number) ─────────────────────────────────────────────
export function renderStatCalloutHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const value = resolveBindable(p.value, ctx) || '0';
  const label = resolveBindable(p.label, ctx);
  const delta = resolveBindable(p.delta, ctx);
  const dir = String(p.deltaDir ?? 'up');
  const deltaColor = dir === 'down' ? '#DC2626' : '#16A34A';
  return `<div style="${box(p, ctx)}background:linear-gradient(135deg,${accent}22,transparent);border-left:4pt solid ${accent};padding:18pt 22pt;border-radius:4pt;">
    <div style="font:300 ${Number(p.valueSize ?? 42)}pt/1 ${BODY};color:${accent};letter-spacing:-1pt;">${esc(value)}</div>
    ${label ? `<div style="font:500 10pt ${BODY};color:${muted(ctx)};margin-top:6pt;text-transform:uppercase;letter-spacing:0.5pt;">${esc(label)}</div>` : ''}
    ${delta ? `<div style="font:600 9pt ${BODY};color:${deltaColor};margin-top:4pt;">${dir === 'down' ? '▼' : '▲'} ${esc(delta)}</div>` : ''}
  </div>`;
}

// ── 6. Pull-quote ────────────────────────────────────────────────────────────
export function renderPullQuoteHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  return `<div style="${box(p, ctx)}padding:20pt 28pt;border-left:6pt solid ${accent};background:#FAFAF7;">
    <div style="font:300 22pt/1.3 Georgia,serif;color:${ink(ctx)};font-style:italic;">“${esc(resolveBindable(p.quote, ctx))}”</div>
    <div style="margin-top:10pt;display:flex;align-items:center;gap:10pt;">
      ${p.avatarUrl ? imgTag(resolveBindable(p.avatarUrl, ctx), {
        alt: `Portrait of ${resolveBindable(p.attribution, ctx) || 'the person quoted'}`,
        style: 'width:28pt;height:28pt;border-radius:50%;object-fit:cover;',
      }) : ''}
      <div>
        <div style="font:600 10pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(p.attribution, ctx))}</div>
        ${p.role ? `<div style="font:400 9pt ${BODY};color:${muted(ctx)};">${esc(resolveBindable(p.role, ctx))}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// ── 7. FAQ list ──────────────────────────────────────────────────────────────
export function renderFaqHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const rows = items
    .map(
      (it) => `<div style="border-bottom:1pt solid ${line(ctx)};padding:10pt 0;">
        <div style="font:700 10pt ${BODY};color:${ink(ctx)};margin-bottom:4pt;">Q. ${esc(resolveBindable(it.q, ctx))}</div>
        <div style="font:400 9.5pt/1.5 ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.a, ctx))}</div>
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}${rows}</div>`;
}

// ── 8. Pricing card ──────────────────────────────────────────────────────────
export function renderPricingCardHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const features = Array.isArray(p.features) ? (p.features as unknown[]) : [];
  return `<div style="${box(p, ctx)}border:1.5pt solid ${accent};border-radius:8pt;padding:20pt;background:#fff;">
    ${p.badge ? `<div style="display:inline-block;background:${accent};color:#fff;font:700 8pt ${BODY};padding:3pt 8pt;border-radius:3pt;text-transform:uppercase;letter-spacing:0.5pt;margin-bottom:8pt;">${esc(resolveBindable(p.badge, ctx))}</div>` : ''}
    <div style="font:700 14pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(p.tier, ctx))}</div>
    <div style="margin-top:6pt;">
      <span style="font:300 32pt ${BODY};color:${accent};letter-spacing:-1pt;">${esc(resolveBindable(p.price, ctx))}</span>
      <span style="font:400 10pt ${BODY};color:${muted(ctx)};">${esc(resolveBindable(p.period, ctx))}</span>
    </div>
    ${p.description ? `<div style="font:400 9.5pt ${BODY};color:${muted(ctx)};margin:8pt 0 12pt;">${esc(resolveBindable(p.description, ctx))}</div>` : ''}
    <ul style="margin:0;padding:0;list-style:none;">
      ${features.map((f) => `<li style="font:400 9.5pt ${BODY};color:${ink(ctx)};padding:4pt 0;border-top:1pt solid ${line(ctx)};"><span style="color:${accent};font-weight:700;margin-right:6pt;">✓</span>${esc(resolveBindable(f, ctx))}</li>`).join('')}
    </ul>
  </div>`;
}

// ── 9. Feature list (icons) ──────────────────────────────────────────────────
export function renderFeatureListHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const cols = Math.max(1, Number(p.columns ?? 2));
  const grid = items
    .map(
      (it) => `<div style="display:flex;gap:10pt;align-items:flex-start;">
        <div style="flex-shrink:0;width:24pt;height:24pt;border-radius:6pt;background:${accent}22;color:${accent};font:700 12pt ${BODY};display:flex;align-items:center;justify-content:center;">${esc(it.icon ?? '★')}</div>
        <div>
          <div style="font:700 10pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.title, ctx))}</div>
          <div style="font:400 9pt/1.4 ${BODY};color:${muted(ctx)};margin-top:2pt;">${esc(resolveBindable(it.body, ctx))}</div>
        </div>
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:14pt 18pt;">${grid}</div>
  </div>`;
}

// ── 10. Process steps (numbered) ─────────────────────────────────────────────
export function renderProcessStepsHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const steps = items
    .map(
      (it, i) => `<div style="display:flex;gap:12pt;padding:10pt 0;">
        <div style="flex-shrink:0;width:28pt;height:28pt;border-radius:50%;background:${accent};color:#fff;font:700 12pt ${BODY};display:flex;align-items:center;justify-content:center;">${i + 1}</div>
        <div style="flex:1;">
          <div style="font:700 10.5pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.title, ctx))}</div>
          <div style="font:400 9pt/1.5 ${BODY};color:${muted(ctx)};margin-top:3pt;">${esc(resolveBindable(it.body, ctx))}</div>
        </div>
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}${steps}</div>`;
}

// ── 11. Progress bars (multi) ────────────────────────────────────────────────
export function renderProgressBarsHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const bars = items
    .map((it) => {
      const v = Math.max(0, Math.min(100, Number(it.value ?? 0)));
      return `<div style="margin-top:10pt;">
        <div style="display:flex;justify-content:space-between;font:500 9pt ${BODY};color:${ink(ctx)};margin-bottom:4pt;">
          <span>${esc(resolveBindable(it.label, ctx))}</span><span style="color:${muted(ctx)};">${v}%</span>
        </div>
        <div style="height:8pt;background:${line(ctx)};border-radius:4pt;overflow:hidden;">
          <div style="width:${v}%;height:100%;background:${accent};"></div>
        </div>
      </div>`;
    })
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}${bars}</div>`;
}

// ── 12. Map placeholder ──────────────────────────────────────────────────────
export function renderMapHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const src = resolveBindable(p.staticMapUrl, ctx);
  const caption = resolveBindable(p.caption, ctx);
  return `<div style="${box(p, ctx, 240)}border-radius:6pt;overflow:hidden;background:${line(ctx)};">
    ${src ? imgTag(src, {
      alt: resolveBindable(p.alt, ctx) || caption || 'Map of the location',
      style: 'width:100%;height:100%;object-fit:cover;display:block;',
    }) : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font:500 11pt ${BODY};color:${muted(ctx)};background:repeating-linear-gradient(45deg,${line(ctx)},${line(ctx)} 8pt,${line(ctx)} 8pt,${line(ctx)} 16pt);">Map preview</div>`}
    ${caption ? `<div style="position:absolute;left:0;right:0;bottom:0;background:rgba(15,23,42,0.75);color:#fff;font:500 9pt ${BODY};padding:6pt 10pt;">${esc(caption)}</div>` : ''}
  </div>`;
}

// ── 13. Icon grid ────────────────────────────────────────────────────────────
export function renderIconGridHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const cols = Math.max(1, Number(p.columns ?? 4));
  const grid = items
    .map(
      (it) => `<div style="text-align:center;padding:10pt;">
        <div style="width:44pt;height:44pt;border-radius:50%;background:${accent}1f;color:${accent};font:700 20pt ${BODY};display:flex;align-items:center;justify-content:center;margin:0 auto 6pt;">${esc(it.icon ?? '◆')}</div>
        <div style="font:600 9.5pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.label, ctx))}</div>
        ${it.sub ? `<div style="font:400 8pt ${BODY};color:${muted(ctx)};margin-top:2pt;">${esc(resolveBindable(it.sub, ctx))}</div>` : ''}
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:8pt;">${grid}</div>
  </div>`;
}

// ── 14. Testimonials ─────────────────────────────────────────────────────────
export function renderTestimonialsHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const cols = Math.max(1, Number(p.columns ?? 2));
  const cards = items
    .map(
      (it) => `<div style="background:#FAFAF7;border-radius:6pt;padding:14pt 16pt;">
        <div style="color:#BF9B50;font:600 12pt ${BODY};letter-spacing:2pt;">★★★★★</div>
        <div style="font:400 9.5pt/1.5 ${BODY};color:${ink(ctx)};margin:6pt 0 10pt;font-style:italic;">“${esc(resolveBindable(it.body, ctx))}”</div>
        <div style="font:700 9pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.name, ctx))}</div>
        ${it.role ? `<div style="font:400 8pt ${BODY};color:${muted(ctx)};">${esc(resolveBindable(it.role, ctx))}</div>` : ''}
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:12pt;">${cards}</div>
  </div>`;
}

// ── 15. Ribbon banner ────────────────────────────────────────────────────────
export function renderRibbonHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  return `<div style="${box(p, ctx)}background:${accent};color:#fff;padding:12pt 24pt;display:flex;align-items:center;justify-content:space-between;clip-path:polygon(0 0,calc(100% - 16pt) 0,100% 50%,calc(100% - 16pt) 100%,0 100%,16pt 50%);">
    <div style="font:700 12pt ${BODY};letter-spacing:1pt;text-transform:uppercase;">${esc(resolveBindable(p.label, ctx))}</div>
    <div style="font:400 10pt ${BODY};opacity:0.9;">${esc(resolveBindable(p.sub, ctx))}</div>
  </div>`;
}

// ── 16. Metric with delta arrow ──────────────────────────────────────────────
export function renderMetricDeltaHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const items = Array.isArray(p.items) ? (p.items as R[]) : [];
  const cols = Math.max(1, Number(p.columns ?? 3));
  const cards = items
    .map((it) => {
      const dir = String(it.dir ?? 'up');
      const dColor = dir === 'down' ? '#DC2626' : '#16A34A';
      return `<div style="border:1pt solid ${line(ctx)};border-radius:6pt;padding:12pt 14pt;background:#fff;">
        <div style="font:500 9pt ${BODY};color:${muted(ctx)};text-transform:uppercase;letter-spacing:0.5pt;">${esc(resolveBindable(it.label, ctx))}</div>
        <div style="font:600 22pt ${BODY};color:${ink(ctx)};margin-top:4pt;letter-spacing:-0.5pt;">${esc(resolveBindable(it.value, ctx))}</div>
        <div style="font:600 9pt ${BODY};color:${dColor};margin-top:2pt;">${dir === 'down' ? '▼' : '▲'} ${esc(resolveBindable(it.delta, ctx))}</div>
      </div>`;
    })
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10pt;">${cards}</div>
  </div>`;
}

// ── 17. Definition list ──────────────────────────────────────────────────────
export function renderDefinitionListHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  // A term is a promise that a definition follows it, so an item may carry a
  // `when` — the same per-row conditional `data-table` rows have. Fixed-slot
  // masters bind items that half the records do not hold, and an unresolved
  // pair drew as an empty ruled stripe (a real comparison carried one under
  // its single money axis). Dropping items only shortens the list, which is
  // the safe direction: the declared height was sized for every slot.
  const authored = Array.isArray(p.items) ? (p.items as R[]) : [];
  const items = authored.filter((it) => {
    if (typeof it.when === 'string' && String(it.when).trim() !== ''
      && !evalConditional(String(it.when), ctx)) return false;
    // And an item whose definition is bound but received nothing is dropped
    // for the same reason the `when` items are — a term with no definition is
    // a promise unkept. The jsPDF twin asks the same function, because two
    // presentations deciding presence differently is how one record comes to
    // say two things. See `boundValuePresence`.
    const definitionSource = [it.definition, it.value, it.description]
      .find((c) => c !== undefined && c !== null);
    return definitionSource === undefined || boundValueResolved(definitionSource, ctx);
  });
  if (authored.length > 0 && items.length === 0) return '';
  // A list built for several terms that kept ONE is a lone line, not the list
  // — the same floor the data table applies (`LONE_SURVIVOR_FLOOR`).
  const boundAuthored = authored.filter((it) => [it.definition, it.value, it.description]
    .some((c) => typeof c === 'string' && c.includes('{{'))).length;
  if (boundAuthored >= LONE_SURVIVOR_FLOOR && items.length === 1) return '';
  const rows = items
    .map(
      (it) => `<div style="display:grid;grid-template-columns:160pt 1fr;gap:14pt;padding:8pt 0;border-bottom:1pt solid ${line(ctx)};">
        <div style="font:600 9.5pt ${BODY};color:${ink(ctx)};">${esc(resolveBindable(it.term, ctx))}</div>
        <div style="font:400 9.5pt/1.45 ${BODY};color:${muted(ctx)};">${esc(resolveBindable(it.definition, ctx))}</div>
      </div>`,
    )
    .join('');
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}${rows}</div>`;
}

// ── 18. Sparkline (SVG) ──────────────────────────────────────────────────────

/**
 * The series a sparkline draws.
 *
 * `values` — a literal array of numbers — was the only input this block
 * accepted, and it is the one input a *template* cannot supply: a template is
 * authored before the report exists, so its series has to arrive as a
 * `dataPath` resolved at render time, exactly as `chart-line`, `chart-bar` and
 * every other chart in `charts.html.ts` accepts one.
 *
 * The consequence was silent. `scenarioChart` in the template library emits
 * `dataPath`/`data`/`valueKey` for whichever chart block a family's
 * `chart_style` resolves to, and three of the catalogue's chart styles resolve
 * to `sparkline` — so those masters asked for a series, this function read
 * `p.values`, found nothing, and drew an empty frame. An empty chart looks like
 * a chart, which is why nothing caught it.
 *
 * `values` still wins where it is given, so every existing sparkline renders
 * exactly as before.
 */
function sparklineSeries(p: R, ctx: HtmlBlockContext): number[] {
  const literal = Array.isArray(p.values) ? (p.values as unknown[]) : null;
  if (literal) return literal.map((v) => Number(v) || 0);

  const source = p.dataPath
    ? resolveDataPath(p.dataPath, ctx)
    : (Array.isArray(p.data) ? p.data : null);
  if (!Array.isArray(source)) return [];

  const valueKey = String(p.valueKey ?? 'value');
  return source.map((it: unknown) => {
    if (typeof it === 'number') return it;
    if (it && typeof it === 'object') return Number((it as R)[valueKey] ?? (it as R).y ?? 0) || 0;
    return Number(it) || 0;
  });
}

export function renderSparklineHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const raw = sparklineSeries(p, ctx);
  // No series, no figure — an empty frame looks like a chart, which is why
  // the masters that bound `dataPath` went unnoticed for so long.
  if (!raw.length) return '';
  const w = Number(p.width ?? 240);
  const h = Number(p.height ?? 60);
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const max = Math.max(...raw, 1);
  const min = Math.min(...raw, 0);
  const range = max - min || 1;
  const pts = raw
    .map((v, i) => {
      const x = (i / Math.max(1, raw.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `M0,${h} L${pts.replace(/ /g, ' L')} L${w},${h} Z`;
  return `<div style="${box(p, ctx)}">${title(resolveBindable(p.title, ctx), ctx)}
    <div style="font:700 22pt ${BODY};color:${ink(ctx)};letter-spacing:-0.5pt;">${esc(resolveBindable(p.value, ctx))}</div>
    <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;margin-top:6pt;">
      <path d="${area}" fill="${accent}22" />
      <polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    ${p.caption ? `<div style="font:400 8.5pt ${BODY};color:${muted(ctx)};margin-top:4pt;">${esc(resolveBindable(p.caption, ctx))}</div>` : ''}
  </div>`;
}

// ── 19. Before / After split ─────────────────────────────────────────────────
export function renderBeforeAfterHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const before = resolveBindable(p.beforeUrl, ctx);
  const after = resolveBindable(p.afterUrl, ctx);
  return `<div style="${box(p, ctx, 220)}display:flex;gap:8pt;">
    <div style="flex:1;position:relative;border-radius:4pt;overflow:hidden;background:${line(ctx)};">
      ${before ? imgTag(before, {
        alt: resolveBindable(p.beforeAlt, ctx) || 'The subject before',
        style: 'width:100%;height:100%;object-fit:cover;',
      }) : ''}
      <div style="position:absolute;top:8pt;left:8pt;background:rgba(15,23,42,0.8);color:#fff;font:700 8pt ${BODY};padding:3pt 8pt;border-radius:3pt;text-transform:uppercase;letter-spacing:0.5pt;">Before</div>
    </div>
    <div style="flex:1;position:relative;border-radius:4pt;overflow:hidden;background:${line(ctx)};">
      ${after ? imgTag(after, {
        alt: resolveBindable(p.afterAlt, ctx) || 'The subject after',
        style: 'width:100%;height:100%;object-fit:cover;',
      }) : ''}
      <div style="position:absolute;top:8pt;left:8pt;background:#BF9B50;color:#fff;font:700 8pt ${BODY};padding:3pt 8pt;border-radius:3pt;text-transform:uppercase;letter-spacing:0.5pt;">After</div>
    </div>
  </div>`;
}

// ── 20. Image + text (side by side) ──────────────────────────────────────────
export function renderImageTextHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const src = resolveBindable(p.imageUrl, ctx);
  const side = String(p.imageSide ?? 'left');
  const img = `<div style="flex:1;border-radius:4pt;overflow:hidden;background:${line(ctx)};min-height:160pt;">
    ${src ? imgTag(src, {
      alt: resolveBindable(p.alt, ctx) || resolveBindable(p.heading, ctx),
      style: 'width:100%;height:100%;object-fit:cover;display:block;',
    }) : ''}
  </div>`;
  const text = `<div style="flex:1;">
    ${title(resolveBindable(p.heading, ctx), ctx)}
    <div style="font:400 10pt/1.55 ${BODY};color:${ink(ctx)};white-space:pre-wrap;">${esc(resolveBindable(p.body, ctx))}</div>
  </div>`;
  return `<div style="${box(p, ctx)}display:flex;gap:18pt;align-items:stretch;">${side === 'right' ? text + img : img + text}</div>`;
}
