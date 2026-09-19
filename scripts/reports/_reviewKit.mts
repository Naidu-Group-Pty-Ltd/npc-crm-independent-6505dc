/**
 * The review harness: measure on the real engine, stack, then prove the
 * content survived.
 *
 * One implementation, because two would disagree. `s1Pages.mts` and
 * `s3FiveReports.mts` both draw pages through the production block registry
 * and the production print contract, and both need the same three things:
 *
 *   1. **Measure before laying out.** Every block here is absolutely
 *      positioned, so a block that draws one line taller than its author
 *      assumed does not overflow the page — it prints over the block beneath
 *      it. Pass one renders each flowed block alone, on its own page, on its
 *      own ground, through the pinned engine; `measureInk.py` rasterises that
 *      probe document and reports the lowest row that differs from the page's
 *      own background.
 *
 *   2. **Render on the production options.** `renderWeasy.py` mirrors
 *      `weasyprint-service/app.py`'s call — `pdf/ua-1`, tagged,
 *      `optimize_images`, `output_intent: srgb` — because the engine OPTIONS
 *      are part of the print contract and not just the version.
 *
 *   3. **Prove the content survived, not merely that it fitted.** Every
 *      authored string is looked for in the rendered text, read in CONTENT
 *      order (`-raw`); layout mode re-flows a table into visual columns and
 *      reports false losses.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileTemplateHtmlForPdf } from '../../src/lib/reportTemplate/compileTemplateForPdf';

export const REPO = resolve(import.meta.dirname, '../..');

/** A page: furniture at fixed coordinates, and a column that flows. */
export interface Sheet {
  name: string;
  background?: unknown;
  /** Where the flow starts. */
  top: number;
  /** `[gapBefore, block]`, stacked from measured heights. */
  flow: Array<[number, any]>;
  /** Blocks whose `y` the author fixed — running feet, cover marks. */
  pinned: any[];
}

export interface RenderOptions {
  /** Nothing flowed may reach this. The running foot's rule, less a margin. */
  readonly floor: number;
  /** A page with no foot (a cover) may run to here instead. */
  readonly coverFloor?: number;
  /** Pages whose last block may run to `coverFloor`. */
  readonly coverNames?: readonly string[];
  readonly showHeights?: boolean;
}

const PROBE_TOP = 40;

export async function measureAndRender(
  sheets: Sheet[],
  tokens: unknown,
  data: Record<string, unknown>,
  outName: string,
  options: RenderOptions,
): Promise<{ pdfPath: string; overruns: number; lost: number }> {
  mkdirSync(resolve(REPO, 'reports/html'), { recursive: true });
  mkdirSync(resolve(REPO, 'reports/pdf'), { recursive: true });

  // ── pass one: measure every flowed block on the engine that will draw it ──
  const probes = sheets.flatMap((s, si) => s.flow.map(([, b], bi) => ({ si, bi, sheet: s, block: b })));
  const probeSchema = {
    name: `${outName} probe`,
    tokens,
    pages: probes.map((p, i) => ({
      id: `probe-${i}`,
      name: `probe-${i}`,
      size: { width: 595, height: 842 },
      ...(p.sheet.background ? { background: p.sheet.background } : {}),
      blocks: [{ ...p.block, props: { ...p.block.props, y: PROBE_TOP } }],
    })),
  };
  const probeHtml = resolve(REPO, `reports/html/${outName}-probe.html`);
  const probePdf = resolve(REPO, `reports/pdf/${outName}-probe.pdf`);
  writeFileSync(probeHtml, (await compileTemplateHtmlForPdf(probeSchema as never, { data })).html);
  weasy(probeHtml, probePdf);

  const ink = execFileSync('python3', [resolve(REPO, 'scripts/reports/measureInk.py'), probePdf], { encoding: 'utf8' })
    .trim().split('\n').map((l) => Number(l.split('\t')[1]));
  if (ink.length !== probes.length) {
    throw new Error(`probe pages ${ink.length} ≠ blocks ${probes.length}`);
  }
  const heights = new Map<string, number>();
  probes.forEach((p, i) => heights.set(`${p.si}:${p.bi}`, Math.max(0, ink[i] - PROBE_TOP)));

  // ── pass two: stack from the measurements, and check the foot ────────────
  let overruns = 0;
  let n = 0;
  const pages = sheets.map((s, si) => {
    let y = s.top;
    const blocks = s.flow.map(([gap, b], bi) => {
      y += gap;
      const placed = { ...b, props: { ...b.props, y: Math.round(y * 10) / 10 } };
      const h = heights.get(`${si}:${bi}`) ?? 0;
      if (options.showHeights) {
        const what = String((b.props as any).body ?? (b.props as any).heading ?? b.type).slice(0, 44);
        console.log(`      ${String(bi).padStart(2)} ${b.type.padEnd(16)} +${String(gap).padStart(3)}  h=${h.toFixed(1).padStart(6)}  y=${y.toFixed(1).padStart(6)}  ${what.replace(/\n/g, ' ')}`);
      }
      y += h;
      return placed;
    });
    const clear = options.coverNames?.includes(s.name) ? (options.coverFloor ?? options.floor) : options.floor;
    const ok = y <= clear;
    if (!ok) overruns += 1;
    console.log(`${String(si + 1).padStart(3)} ${s.name.padEnd(34)} ends ${y.toFixed(1).padStart(6)}pt of ${clear}  ${ok ? 'ok' : `OVERRUN ${(y - clear).toFixed(1)}pt`}`);
    return {
      id: `page-${++n}`, name: s.name, size: { width: 595, height: 842 },
      ...(s.background ? { background: s.background } : {}),
      blocks: [...blocks, ...s.pinned],
    };
  });

  const compiled = await compileTemplateHtmlForPdf({ name: outName, tokens, pages } as never, { data });
  const htmlPath = resolve(REPO, `reports/html/${outName}.html`);
  const pdfPath = resolve(REPO, `reports/pdf/${outName}.pdf`);
  writeFileSync(htmlPath, compiled.html);
  const warnings = weasy(htmlPath, pdfPath);

  // ── pass three: prove the content SURVIVED, not merely that it fitted ────
  const lost = conserved(sheets, pdfPath);
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  console.log(`\npages=${info.match(/^Pages:\s+(\d+)/m)?.[1]}  size=${info.match(/^Page size:\s+(.+)$/m)?.[1]}  tagged=${info.match(/^Tagged:\s+(\S+)/m)?.[1]}`);
  if (warnings.length) {
    console.log(`engine warnings (${warnings.length}) — each is a declaration the engine dropped:`);
    for (const w of warnings) console.log(`  · ${w}`);
  }
  if (compiled.droppedAssets.length) console.log('dropped:', compiled.droppedAssets.map((d) => d.where).join(', '));
  console.log(pdfPath);
  return { pdfPath, overruns, lost };
}

/** Render on the production print contract, and report the engine's warnings. */
export function weasy(html: string, pdf: string): string[] {
  const out = execFileSync('python3', [resolve(REPO, 'scripts/reports/renderWeasy.py'), html, pdf], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  return out.trim().split('\n').filter((l) => l.startsWith('warning\t')).map((l) => l.slice(8));
}

/**
 * Every authored string, looked for in the rendered text.
 *
 * Fitting on the page is not conservation — a `decision-box` that stops at
 * word 61 and prints an ellipsis clears the running foot perfectly. Comparison
 * is on letters and digits alone: the extractor re-flows lines, turns a
 * non-breaking space into a space and can split a ligature, so anything that
 * normalises away is presentation and anything that does not is content.
 */
export function conserved(sheets: Sheet[], pdfPath: string): number {
  const printable = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  // `-raw`, never `-layout`: layout mode re-flows the page into visual columns
  // and interleaves a table's cells, which reads as lost content.
  const rendered = printable(execFileSync('pdftotext', ['-raw', pdfPath, '-'], { encoding: 'utf8' }));
  const authored: Array<{ where: string; text: string }> = [];
  sheets.forEach((sheet) => {
    const visit = (value: unknown, path: string) => {
      if (typeof value === 'string') {
        // Bindings, colours, fonts and enum-ish props are not prose. An
        // unresolved binding is caught by the binding coverage check, not here.
        if (value.length < 12 || value.startsWith('token:') || value.startsWith('#')
          || value.startsWith('data:') || value.includes('{{')) return;
        authored.push({ where: `${sheet.name} · ${path}`, text: value });
        return;
      }
      if (Array.isArray(value)) {
        // A table row whose cells include a binding is CONDITIONAL: the
        // renderer drops the whole row when the bound value resolves to
        // nothing (`rowsWithSomethingToSay`), and that takes the row's
        // authored label with it. Dropping a row a tier declines to publish
        // is the content policy working; counting its label as lost content
        // would make this check fire on every correct tier separation. A row
        // with no binding in it has no such excuse and is still judged.
        const bound = value.some((cell) => typeof cell === 'string' && cell.includes('{{'));
        if (bound) return;
        value.forEach((v, i) => visit(v, `${path}[${i}]`));
        return;
      }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (k === 'src' || k === 'id' || k === 'type') continue;
          visit(v, `${path}.${k}`);
        }
      }
    };
    [...sheet.flow.map(([, b]) => b), ...sheet.pinned].forEach((b) => visit(b.props, b.type));
  });
  const lost = authored.filter(({ text }) => !rendered.includes(printable(text)));
  console.log(`content conservation: ${authored.length - lost.length} of ${authored.length} authored strings present`);
  for (const { where, text } of lost) console.log(`  LOST  ${where}: ${JSON.stringify(text.slice(0, 90))}…`);
  return lost.length;
}
