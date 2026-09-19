/**
 * Phase 6 — data-driven tables: `data-grid` and `pivot-table`.
 *
 * Both blocks accept a `dataPath` that resolves to an array within the report
 * data, plus a column registry. Columns auto-infer from the first row if absent
 * so designers can drop these blocks onto a bound report and immediately see
 * rendered output without configuration.
 */
import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { absBoxStyle, esc, type HtmlBlockContext } from './_shared.html';
import { resolveDataPath, toArray, formatCell, readColumn, autoColumns, type ColumnDef } from './_data';

function buildColumns(p: Record<string, unknown>, rows: any[]): ColumnDef[] {
  const cols = Array.isArray(p.columns) ? (p.columns as ColumnDef[]) : [];
  if (cols.length) return cols;
  return autoColumns(rows);
}

export function renderDataGridHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const raw = resolveDataPath(p.dataPath, ctx);
  const rows = toArray(raw);
  const cols = buildColumns(p, rows);
  const max = Math.max(0, Number(p.maxRows ?? rows.length));
  const showRows = rows.slice(0, max);
  const headerBg = resolveBindableColor(p.headerBg ?? 'token:primary', ctx, '#BF9B50');
  const headerFg = resolveBindableColor(p.headerFg ?? '#FFFFFF', ctx, '#FFFFFF');
  const stripe = resolveBindableColor(p.stripeBg ?? '#F4F0E6', ctx, '#F4F0E6');
  const cellFg = resolveBindableColor(p.cellFg ?? '#1A1A1A', ctx, '#1A1A1A');
  const borderColor = resolveBindableColor(p.borderColor ?? '#E1DCCC', ctx, '#E1DCCC');
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48 });

  if (!rows.length) {
    return `<div style="${style};border:1pt dashed ${borderColor};color:#9b8d6a;font-size:9pt;padding:8pt;font-family:Helvetica;">No data at <code>${esc(String(p.dataPath ?? ''))}</code></div>`;
  }

  const widths = cols.every((c) => c.width != null)
    ? cols.map((c) => c.width as number)
    : cols.map(() => 1 / cols.length);
  const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${(w * 100).toFixed(3)}%;"/>`).join('')}</colgroup>`;
  const thead = `<thead><tr style="background:${headerBg};color:${headerFg};">
    ${cols.map((c) => `<th style="padding:6pt 8pt;text-align:${c.align ?? 'left'};font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${esc(c.label ?? c.key)}</th>`).join('')}
  </tr></thead>`;
  const tbody = `<tbody>${showRows.map((row, i) => `
    <tr style="background:${i % 2 ? stripe : 'transparent'};color:${cellFg};">
      ${cols.map((c) => {
        const v = readColumn(row, c, ctx);
        const txt = formatCell(v, c.format ?? 'auto');
        const color = c.color ? `color:${resolveBindableColor(c.color, ctx, cellFg)};` : '';
        return `<td style="padding:6pt 8pt;font-size:9pt;text-align:${c.align ?? 'left'};${color}">${esc(txt)}</td>`;
      }).join('')}
    </tr>`).join('')}</tbody>`;

  const note = rows.length > showRows.length
    ? `<div style="font-size:8pt;color:#9b8d6a;text-align:right;padding:4pt 8pt;font-style:italic;">${rows.length - showRows.length} more row${rows.length - showRows.length === 1 ? '' : 's'} hidden</div>`
    : '';

  return `<div style="${style}"><table style="width:100%;border-collapse:collapse;border:0.5pt solid ${borderColor};">${colgroup}${thead}${tbody}</table>${note}</div>`;
}

/**
 * `pivot-table` — group rows by `groupBy` column and aggregate `metric` values.
 * Aggregations: sum (default), avg, count, min, max.
 */
export function renderPivotTableHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const raw = resolveDataPath(p.dataPath, ctx);
  const rows = toArray(raw);
  const groupKey = String(p.groupBy ?? '');
  const metric = String(p.metric ?? '');
  const agg = String(p.aggregation ?? 'sum');
  const headerBg = resolveBindableColor(p.headerBg ?? 'token:primary', ctx, '#BF9B50');
  const headerFg = resolveBindableColor(p.headerFg ?? '#FFFFFF', ctx, '#FFFFFF');
  const format = (p.format as any) ?? 'auto';
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48 });

  if (!groupKey) {
    return `<div style="${style};border:1pt dashed #e2c97a;color:#9b8d6a;font-size:9pt;padding:8pt;">Set <strong>groupBy</strong> to a row property.</div>`;
  }

  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const k = String((row as any)[groupKey] ?? '—');
    const v = Number((row as any)[metric]);
    if (!groups.has(k)) groups.set(k, []);
    if (Number.isFinite(v)) groups.get(k)!.push(v);
  }

  const agged: Array<[string, number]> = [...groups.entries()].map(([k, arr]): [string, number] => {
    if (agg === 'count') return [k, arr.length];
    if (!arr.length) return [k, 0];
    if (agg === 'avg') return [k, arr.reduce((a, b) => a + b, 0) / arr.length];
    if (agg === 'min') return [k, Math.min(...arr)];
    if (agg === 'max') return [k, Math.max(...arr)];
    return [k, arr.reduce((a, b) => a + b, 0)];
  }).sort((a, b) => b[1] - a[1]);

  const total = agged.reduce((a, [, v]) => a + v, 0);

  const thead = `<thead><tr style="background:${headerBg};color:${headerFg};">
    <th style="padding:6pt 8pt;text-align:left;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${esc(p.groupLabel as string ?? groupKey)}</th>
    <th style="padding:6pt 8pt;text-align:right;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${esc(p.metricLabel as string ?? `${agg}(${metric})`)}</th>
    ${p.showShare ? `<th style="padding:6pt 8pt;text-align:right;font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Share</th>` : ''}
  </tr></thead>`;
  const tbody = `<tbody>${agged.map(([k, v], i) => `
    <tr style="background:${i % 2 ? '#F4F0E6' : 'transparent'};">
      <td style="padding:6pt 8pt;font-size:9pt;">${esc(k)}</td>
      <td style="padding:6pt 8pt;font-size:9pt;text-align:right;font-variant-numeric:tabular-nums;">${esc(formatCell(v, format))}</td>
      ${p.showShare ? `<td style="padding:6pt 8pt;font-size:9pt;text-align:right;color:#9b8d6a;">${total ? ((v / total) * 100).toFixed(1) : '0'}%</td>` : ''}
    </tr>`).join('')}</tbody>`;

  return `<div style="${style}"><table style="width:100%;border-collapse:collapse;border:0.5pt solid #E1DCCC;">${thead}${tbody}</table></div>`;
}
