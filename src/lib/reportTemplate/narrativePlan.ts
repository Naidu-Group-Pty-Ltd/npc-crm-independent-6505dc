/**
 * The narrative pre-pass: one geometry and one page count per narrative run,
 * derived from the template before its first page is evaluated.
 *
 * ## Why a pre-pass and not the block
 *
 * A master carries the same source on forty conditional pages, each holding
 * one bucket at a different `pageIndex`. The bucket boundaries depend on the
 * first page's box AND the continuation pages' box, and no single instance
 * can see both — so every instance is handed the SAME geometry, computed here
 * from the template as a whole (`narrativeGeometry.pure.ts` says why a
 * boundary that differs between two instances prints a line twice or not at
 * all).
 *
 * ## Why the page count is the renderer's and not the projection's
 *
 * The projection publishes `narrative.pages` without a template in hand —
 * it cannot know whether the document will be set in Noto Serif over 459pt
 * or Inter over 509pt — and the masters gate their continuation pages on
 * that number. With the geometry known, the true count is known, and the
 * renderer overrides the estimate before the conditionals are evaluated: a
 * page the geometry needs is drawn, a page it does not need is not, and the
 * "Not the whole report" notice fires on the count that is actually true.
 * Nothing about this is stored; the projection's estimate still serves
 * every surface that has no template.
 *
 * The pre-pass memoises through `narrativeBuckets`, so the render it makes
 * to count is the render every instance then draws from.
 */
import type { ReportTemplate } from './templateSchema';
import { evalConditional, resolveBindable, type ResolveContext } from './bindingResolver';
import { geometryAwareFormat, resolveNarrativeProfile } from '../../../supabase/functions/_shared/reports/markdownPaging.pure';
import {
  narrativeGeometry, type NarrativeBox, type NarrativeGeometry, type PageSize,
} from '../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { stripBakedCover } from '../../../supabase/functions/_shared/reports/investment/narrativeClean.pure';
import {
  NARRATIVE_GEOMETRY_KEY, NARRATIVE_NOTES_KEY, continuationNotice, narrativeBindingKey, narrativeBuckets,
  narrativeChartContext, type ContinuationNote,
} from './blocks/markdownBlockContent';
import { runningChapters } from '@/lib/reports/runningChapters.pure';
import { shouldRenderBlock } from './renderVisibility';
import { pagesForDocument } from '../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';
import { placeFlowColumn } from './flowLayout';
import { flowBlockContext, flowFactsFor } from './flowFacts';

export interface NarrativePlan {
  /** Geometry per source binding, as the blocks are written (`{{narrative.source}}`). */
  geometry: Record<string, NarrativeGeometry>;
  /** True bucket counts by data path (`narrative.pages`, `marketIntel.layers.0.pages`, `qa.answerPages`). */
  pages: Record<string, number>;
  /** Notes folded onto a run's last allowed page, by source binding. */
  notes: Record<string, ContinuationNote>;
  /**
   * Every value the render proceeds with, by data path: the true counts, and
   * `undefined` for a note the master gave a page of its own, so that page's
   * conditional is false and the note is drawn folded instead.
   */
  writes: Record<string, unknown>;
}

/** A `{{x.y.source}}` binding names the namespace whose `pages` the masters gate on. */
const SOURCE_BINDING = /^\{\{\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\.source\s*\}\}$/;
/**
 * `marketIntel.layers[0].pages > 1`, `qa.answerPages > 3`, `narrative.pages > 7`
 * — matched after `dotPath`, so an index is a plain numeric segment.
 */
const COMPARISON = /([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*>\s*(\d+)/g;

/** `a.b[0].c` → `a.b.0.c`: a conditional is JavaScript, a binding is a path. */
const dotPath = (expr: string): string => expr.replace(/\[(\d+)\]/g, '.$1');
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readPath(data: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = data;
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * The body face a markdown block sets, resolved to a family list. A
 * `token:body` prop is the template's own `fonts.body`; a literal is itself;
 * nothing at all inherits the body token, exactly as the rendered container
 * does through `--font-body`.
 */
function bodyFace(prop: unknown, tokens: ResolveContext['tokens']): string | null {
  const fonts = (tokens as { fonts?: Record<string, unknown> } | undefined)?.fonts ?? {};
  const raw = String(prop ?? '').trim();
  if (raw.startsWith('token:')) {
    const key = raw.slice(6).replace(/[^a-zA-Z0-9_-]/g, '');
    const face = fonts[key];
    return typeof face === 'string' ? face : null;
  }
  if (raw) return raw;
  return typeof fonts.body === 'string' ? fonts.body : null;
}

interface Instance {
  box: NarrativeBox;
  page: PageSize;
  index: number;
  /** The template page's own conditional — where the pages path is written. */
  conditional: string;
  /** Whether this instance is the one the document draws (index 0 only). */
  drawn: boolean;
}

/**
 * The data path a run's continuation pages gate on, read off the template.
 *
 * A continuation at `pageIndex` n sits on a page conditional on `<path> > n`;
 * the path is whatever the master wrote — `narrative.pages`,
 * `marketIntel.layers[0].pages`, `qa.answerPages`, `marketIntel.prose.strategyPages`.
 * Reading it off the conditional is what lets one pre-pass serve every
 * format's key shape rather than the one it was first written for.
 */
function pagesPathFor(instances: readonly Instance[], key: string): string | null {
  for (const inst of instances) {
    if (inst.index < 1) continue;
    for (const m of dotPath(inst.conditional).matchAll(COMPARISON)) {
      if (Number(m[2]) === inst.index) return m[1];
    }
  }
  const namespace = SOURCE_BINDING.exec(key)?.[1];
  return namespace ? `${namespace}.pages` : null;
}

/**
 * The master's page for the run's omission note, if it drew one: a page with
 * no markdown block at all, gated on a key beside the pages path, with a
 * block that binds that same key. Returns the key and the block's label.
 */
function notePageFor(
  template: ReportTemplate, nsPath: string, pagesKey: string,
): { key: string; label: string } | null {
  const keyRe = new RegExp(`${escapeRe(nsPath)}\\.([A-Za-z_$][\\w$]*)`, 'g');
  for (const page of template.pages) {
    if (!page.conditional) continue;
    if (page.blocks.some((b) => b.type === 'markdown-block')) continue;
    const keys = [...dotPath(page.conditional).matchAll(keyRe)].map((m) => m[1]).filter((k) => k !== pagesKey);
    for (const key of keys) {
      const bound = page.blocks.find((b) => JSON.stringify(b.props ?? {}).includes(`{{${nsPath}.${key}}}`));
      if (!bound) continue;
      const props = (bound.props ?? {}) as Record<string, unknown>;
      const label = String(props.title ?? props.label ?? props.heading ?? 'Continues').trim() || 'Continues';
      return { key, label };
    }
  }
  return null;
}

/**
 * The note's sentence with the renderer's counts in it. The projection wrote
 * it from a template-blind estimate ("continues for 9 further pages", "runs
 * to 26 pages"); the estimate and the pages it hid are swapped for the true
 * count and the pages that are actually not drawn, in one pass so a swapped
 * number is never swapped again, and "page"/"pages" follows its number.
 */
export function rewriteNoteCounts(
  text: string, counts: { estimate: number; count: number; allowance: number },
): string {
  const hiddenEst = counts.estimate - counts.allowance;
  const hiddenTrue = Math.max(0, counts.count - counts.allowance);
  const swapped = text.replace(/\d+/g, (raw) => {
    const n = Number(raw);
    if (hiddenEst > 0 && n === hiddenEst) return String(hiddenTrue);
    if (counts.estimate > 0 && n === counts.estimate) return String(counts.count);
    return raw;
  });
  return swapped.replace(/\b(\d+)(\s+)((?:further\s+)?)pages?\b/g, (_m, n: string, gap: string, further: string) =>
    `${n}${gap}${further}${Number(n) === 1 ? 'page' : 'pages'}`);
}

export function planNarrative(template: ReportTemplate, ctxBase: ResolveContext): NarrativePlan | null {
  const data = (ctxBase.data ?? {}) as Record<string, unknown>;
  const reportType = String((data.report as { type?: unknown } | undefined)?.type ?? '');
  const profile = resolveNarrativeProfile(reportType);
  if (!(profile?.geometryAware || geometryAwareFormat(reportType))) return null;

  /*
   * Which page carries the run's FIRST bucket is a question about this
   * document, not about the template.
   *
   * A master may offer the body's opening in more than one place — on the
   * summary page, in the room the summary leaves, for the tiers whose front
   * matter flows into the report; on a page of its own for the rest — each
   * gated on a conditional that is not about the page count. The first
   * instance is the one this document will actually draw: its page survives
   * its conditional and the tier's page rule, and the block its own. Where
   * none does (no narrative at all), the first in template order stands, as
   * it always did.
   */
  const drawnPageIds = new Set(
    pagesForDocument(
      template.pages.filter((pg) => evalConditional(pg.conditional, ctxBase)),
      data as Parameters<typeof pagesForDocument>[1],
    ).map((pg) => pg.id),
  );
  const pageList = template.pages.map((pg) => ({ id: pg.id, name: pg.name, tocContinues: pg.tocContinues === true }));

  const runs = new Map<string, { first?: Instance; cont?: Instance; instances: Instance[] }>();
  for (const page of template.pages) {
    for (const block of page.blocks) {
      if (block.type !== 'markdown-block') continue;
      const p = block.props as Record<string, unknown>;
      const key = narrativeBindingKey(p);
      if (!key) continue;
      const index = Math.max(0, Number(p.pageIndex ?? 0) || 0);
      const box: NarrativeBox = {
        x: Number(p.x ?? 0) || 0,
        y: Number(p.y ?? 0) || 0,
        width: Number(p.width ?? page.size.width) || page.size.width,
        bodyPt: Number(p.bodySize ?? 9.5) || 9.5,
        lineHeight: Number(p.lineHeight ?? 1.5) || 1.5,
        face: bodyFace(p.bodyFont, ctxBase.tokens),
      };
      const drawn = index === 0 && drawnPageIds.has(page.id) && shouldRenderBlock(block, ctxBase);
      /*
       * On a flowing page the box starts where the column above it ENDS for
       * this record, not where the master declared it — the summary above the
       * body closes up around what the record holds, and the body's first box
       * is the room that leaves. Placed with the same facts the renderer uses,
       * so the box packed here is the box drawn there.
       */
      if (drawn && (page as { flow?: boolean }).flow === true) {
        const placed = placeFlowColumn(page.blocks, flowFactsFor(
          ctxBase,
          flowBlockContext(ctxBase, page, pageList, template.slots ?? {}),
        ));
        const at = placed.y.get(block.id);
        if (at !== undefined) box.y = at;
      }
      const instance: Instance = {
        box, page: { width: page.size.width, height: page.size.height }, index, conditional: page.conditional ?? '', drawn,
      };
      const run = runs.get(key) ?? { instances: [] };
      if (index === 0) {
        if (!run.first || (drawn && !run.first.drawn)) run.first = instance;
      } else if (!run.cont || index < run.cont.index) run.cont = instance;
      run.instances.push(instance);
      runs.set(key, run);
    }
  }
  if (!runs.size) return null;

  const geometry: Record<string, NarrativeGeometry> = {};
  const pages: Record<string, number> = {};
  const notes: Record<string, ContinuationNote> = {};
  const writes: Record<string, unknown> = {};
  for (const [key, run] of runs) {
    const first = run.first ?? run.cont;
    if (!first) continue;
    const g = narrativeGeometry(first.box, run.cont?.box ?? null, first.page);
    geometry[key] = g;
    const pagesPath = pagesPathFor(run.instances, key);
    if (!pagesPath) continue;
    const source = resolveBindable(key, ctxBase);
    if (!source || !String(source).trim()) continue;
    // The same strip the block applies: a calibrated format's source may open
    // with a baked cover; a format with no profile is taken as written.
    const clean = profile ? stripBakedCover(String(source)).text : String(source);
    if (!clean.trim()) continue;
    const chart = narrativeChartContext(ctxBase, g);
    let count = narrativeBuckets(clean, g, chart).length;

    // The pages the master allows this run, and the note it wrote for the rest.
    const allowance = Math.max(...run.instances.map((i) => i.index)) + 1;
    const segments = pagesPath.split('.');
    const nsPath = segments.slice(0, -1).join('.');
    const note = nsPath ? notePageFor(template, nsPath, segments[segments.length - 1]) : null;
    if (note) {
      const noteText = String(readPath(data, `${nsPath}.${note.key}`) ?? '').trim();
      if (count > allowance && noteText) {
        const estimate = Number(readPath(data, pagesPath)) || 0;
        const notice = continuationNotice(g, note.label, noteText);
        count = narrativeBuckets(clean, g, chart, { pageIndex: allowance - 1, lines: notice.lines }).length;
        notes[key] = { allowance, label: note.label, text: rewriteNoteCounts(noteText, { estimate, count, allowance }) };
      }
      // Either way the page of its own never draws: the run fits, or the note
      // is on the last page the run is allowed.
      writes[`${nsPath}.${note.key}`] = undefined;
    }
    pages[pagesPath] = count;
    writes[pagesPath] = count;
    // The running head's chapter per page, measured at the SAME geometry that
    // decided the breaks. Written beside the count rather than derived
    // downstream, because a head computed against a different packing names
    // the chapter the page would have been in under another template — which
    // is this pre-pass's whole reason for existing, applied to a second
    // property of one packing.
    if (nsPath) {
      const finalPages = notes[key]
        ? narrativeBuckets(clean, g, chart, {
          pageIndex: notes[key].allowance - 1,
          lines: continuationNotice(g, notes[key].label, notes[key].text).lines,
        })
        : narrativeBuckets(clean, g, chart);
      // Padded to the allowance this run's own master declares, which the
      // pre-pass knows and the projection can only assume.
      writes[`${nsPath}.chapters`] = runningChapters(finalPages, '', allowance);
    }
  }
  return { geometry, pages, notes, writes };
}

/**
 * The context the render proceeds with: the geometry and the folded notes
 * filed for the blocks, and each run's true page count written over the
 * projection's estimate at its own path. The caller's data is copied along
 * each path — an array stays an array, so `layers[0]` still answers — and is
 * never mutated.
 */
export function applyNarrativePlan(ctxBase: ResolveContext, plan: NarrativePlan | null): ResolveContext {
  if (!plan) return ctxBase;
  const data = { ...((ctxBase.data ?? {}) as Record<string, unknown>) };
  for (const [path, value] of Object.entries(plan.writes)) {
    const parts = path.split('.');
    let cursor: Record<string, unknown> = data;
    for (const part of parts.slice(0, -1)) {
      const existing = cursor[part];
      const next = Array.isArray(existing)
        ? [...existing] as unknown as Record<string, unknown>
        : { ...((existing && typeof existing === 'object' ? existing : {}) as Record<string, unknown>) };
      cursor[part] = next;
      cursor = next;
    }
    const last = parts[parts.length - 1];
    if (value === undefined) delete cursor[last];
    else cursor[last] = value;
  }
  const out = { ...ctxBase, data } as ResolveContext & Record<string, unknown>;
  out[NARRATIVE_GEOMETRY_KEY] = plan.geometry;
  out[NARRATIVE_NOTES_KEY] = plan.notes;
  return out;
}
