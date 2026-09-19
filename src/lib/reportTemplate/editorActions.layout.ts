/**
 * Pure editor actions for Layout & Structure / Selection & Editing
 * (Roadmap sections 1 + 2). All functions are immutable and side-effect free.
 *
 * Conventions match `editorActions.ts`:
 *   - `(value, …args) => newValue`
 *   - No-ops return the same reference where practical.
 */
import type { Page, ReportTemplate, Overlay, Block } from './templateSchema';

const defaultMakeId = (): string => crypto.randomUUID();

// ─── helpers ────────────────────────────────────────────────────────────────
function flatOverlays(page: Page): Array<{ overlay: Overlay; blockId: string }> {
  const out: Array<{ overlay: Overlay; blockId: string }> = [];
  for (const b of page.blocks) for (const o of b.overlays) out.push({ overlay: o, blockId: b.id });
  return out;
}

function mapOverlays(page: Page, fn: (o: Overlay) => Overlay): Page {
  return {
    ...page,
    blocks: page.blocks.map((b) => ({ ...b, overlays: b.overlays.map(fn) })),
  };
}

function getById(page: Page, ids: Set<string>): Overlay[] {
  return flatOverlays(page).map((x) => x.overlay).filter((o) => ids.has(o.id));
}

// ─── Lock / hide ────────────────────────────────────────────────────────────
export function setOverlayLocked(page: Page, id: string, locked: boolean): Page {
  return mapOverlays(page, (o) => (o.id === id ? ({ ...o, locked: locked || undefined } as Overlay) : o));
}
export function setOverlayHidden(page: Page, id: string, hidden: boolean): Page {
  return mapOverlays(page, (o) => (o.id === id ? ({ ...o, hidden: hidden || undefined } as Overlay) : o));
}
export function setOverlayName(page: Page, id: string, name: string): Page {
  return mapOverlays(page, (o) => (o.id === id ? ({ ...o, name: name || undefined } as Overlay) : o));
}

// ─── Z-order (within block) ────────────────────────────────────────────────
type ZOp = 'forward' | 'backward' | 'front' | 'back';
export function reorderOverlayZ(page: Page, id: string, op: ZOp): Page {
  return {
    ...page,
    blocks: page.blocks.map((b) => {
      const idx = b.overlays.findIndex((o) => o.id === id);
      if (idx < 0) return b;
      const list = [...b.overlays];
      const [moved] = list.splice(idx, 1);
      const target =
        op === 'front' ? list.length
        : op === 'back' ? 0
        : op === 'forward' ? Math.min(list.length, idx + 1)
        : Math.max(0, idx - 1);
      list.splice(target, 0, moved);
      return { ...b, overlays: list };
    }),
  };
}

// ─── Groups ────────────────────────────────────────────────────────────────
export function groupOverlays(page: Page, ids: string[], makeId: () => string = defaultMakeId): Page {
  if (ids.length < 2) return page;
  const set = new Set(ids);
  const gid = `g_${makeId().slice(0, 8)}`;
  return mapOverlays(page, (o) => (set.has(o.id) ? ({ ...o, groupId: gid } as Overlay) : o));
}
export function ungroupOverlays(page: Page, ids: string[]): Page {
  const set = new Set(ids);
  return mapOverlays(page, (o) => {
    if (!set.has(o.id) || !o.groupId) return o;
    const { groupId: _drop, ...rest } = o as any;
    return rest as Overlay;
  });
}
/** Expand selection to include every overlay sharing a groupId with one in `ids`. */
export function expandGroupSelection(page: Page, ids: string[]): string[] {
  const map = new Map<string, string>(); // overlayId → groupId
  for (const o of flatOverlays(page).map((x) => x.overlay)) if (o.groupId) map.set(o.id, o.groupId);
  const groupIds = new Set<string>();
  ids.forEach((id) => { const g = map.get(id); if (g) groupIds.add(g); });
  if (!groupIds.size) return ids;
  const result = new Set(ids);
  for (const [oid, g] of map) if (groupIds.has(g)) result.add(oid);
  return Array.from(result);
}

// ─── Align / distribute ─────────────────────────────────────────────────────
export type AlignOp =
  | 'align-left' | 'align-center-h' | 'align-right'
  | 'align-top'  | 'align-center-v' | 'align-bottom';

export function alignOverlays(page: Page, ids: string[], op: AlignOp): Page {
  if (ids.length < 2) return page;
  const sel = getById(page, new Set(ids));
  if (sel.length < 2) return page;
  const xs = sel.map((o) => o.x);
  const ys = sel.map((o) => o.y);
  const rights = sel.map((o) => o.x + o.width);
  const bottoms = sel.map((o) => o.y + o.height);
  const minX = Math.min(...xs), maxR = Math.max(...rights);
  const minY = Math.min(...ys), maxB = Math.max(...bottoms);
  const cX = (minX + maxR) / 2, cY = (minY + maxB) / 2;
  const idSet = new Set(ids);
  return mapOverlays(page, (o) => {
    if (!idSet.has(o.id)) return o;
    switch (op) {
      case 'align-left':     return { ...o, x: minX };
      case 'align-right':    return { ...o, x: maxR - o.width };
      case 'align-center-h': return { ...o, x: cX - o.width / 2 };
      case 'align-top':      return { ...o, y: minY };
      case 'align-bottom':   return { ...o, y: maxB - o.height };
      case 'align-center-v': return { ...o, y: cY - o.height / 2 };
    }
  });
}

export type DistributeOp = 'distribute-h' | 'distribute-v';

export function distributeSpacing(page: Page, ids: string[], op: DistributeOp): Page {
  if (ids.length < 3) return page;
  const sel = getById(page, new Set(ids));
  if (sel.length < 3) return page;
  const sorted = [...sel].sort((a, b) => (op === 'distribute-h' ? a.x - b.x : a.y - b.y));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const totalSpan = op === 'distribute-h'
    ? (last.x + last.width) - first.x
    : (last.y + last.height) - first.y;
  const sumSizes = sorted.reduce((s, o) => s + (op === 'distribute-h' ? o.width : o.height), 0);
  const gap = (totalSpan - sumSizes) / (sorted.length - 1);
  const placements = new Map<string, number>();
  let cursor = op === 'distribute-h' ? first.x : first.y;
  for (const o of sorted) {
    placements.set(o.id, cursor);
    cursor += (op === 'distribute-h' ? o.width : o.height) + gap;
  }
  return mapOverlays(page, (o) => {
    if (!placements.has(o.id)) return o;
    const v = placements.get(o.id)!;
    return op === 'distribute-h' ? { ...o, x: v } : { ...o, y: v };
  });
}

// ─── Page-level alignment ───────────────────────────────────────────────────
export type PageAlignOp =
  | 'page-left' | 'page-right' | 'page-center-h'
  | 'page-top'  | 'page-bottom' | 'page-center-v';

export function alignToPage(page: Page, ids: string[], op: PageAlignOp): Page {
  const w = page.size.width ?? 595, h = page.size.height ?? 842;
  const safe = page.safeArea ?? 0;
  const idSet = new Set(ids);
  return mapOverlays(page, (o) => {
    if (!idSet.has(o.id)) return o;
    switch (op) {
      case 'page-left':     return { ...o, x: safe };
      case 'page-right':    return { ...o, x: w - safe - o.width };
      case 'page-center-h': return { ...o, x: (w - o.width) / 2 };
      case 'page-top':      return { ...o, y: safe };
      case 'page-bottom':   return { ...o, y: h - safe - o.height };
      case 'page-center-v': return { ...o, y: (h - o.height) / 2 };
    }
  });
}

// ─── Master pages ───────────────────────────────────────────────────────────
export function applyMasterToPage(template: ReportTemplate, pageId: string, masterId: string | null): ReportTemplate {
  return {
    ...template,
    pages: template.pages.map((p) =>
      p.id === pageId ? ({ ...p, pageMasterId: masterId ?? undefined }) : p,
    ),
  };
}
export function applyMasterToAll(template: ReportTemplate, masterId: string | null): ReportTemplate {
  return {
    ...template,
    pages: template.pages.map((p) => ({ ...p, pageMasterId: masterId ?? undefined })),
  };
}

// ─── Find & replace (text overlays only) ────────────────────────────────────
export interface FindReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}
export interface FindHit {
  pageId: string;
  pageName: string;
  blockId: string;
  overlayId: string;
  preview: string;
  count: number;
}

function buildMatcher(query: string, opts: FindReplaceOptions): RegExp | null {
  if (!query) return null;
  let pat = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) pat = `\\b${pat}\\b`;
  try { return new RegExp(pat, opts.caseSensitive ? 'g' : 'gi'); }
  catch { return null; }
}

export function findText(template: ReportTemplate, query: string, opts: FindReplaceOptions = {}): FindHit[] {
  const re = buildMatcher(query, opts);
  if (!re) return [];
  const hits: FindHit[] = [];
  for (const page of template.pages) {
    for (const b of page.blocks) {
      for (const o of b.overlays) {
        if (o.type !== 'text') continue;
        const txt = String((o as any).content ?? '');
        const matches = txt.match(re);
        if (!matches?.length) continue;
        const idx = txt.search(re);
        const start = Math.max(0, idx - 24), end = Math.min(txt.length, idx + 36);
        hits.push({
          pageId: page.id,
          pageName: page.name,
          blockId: b.id,
          overlayId: o.id,
          preview: (start > 0 ? '…' : '') + txt.slice(start, end) + (end < txt.length ? '…' : ''),
          count: matches.length,
        });
      }
    }
  }
  return hits;
}

export function replaceText(
  template: ReportTemplate,
  query: string,
  replacement: string,
  opts: FindReplaceOptions = {},
  scopeOverlayIds?: string[],
): { template: ReportTemplate; replaced: number } {
  const re = buildMatcher(query, opts);
  if (!re) return { template, replaced: 0 };
  const allow = scopeOverlayIds ? new Set(scopeOverlayIds) : null;
  let replaced = 0;
  const next: ReportTemplate = {
    ...template,
    pages: template.pages.map((p) => ({
      ...p,
      blocks: p.blocks.map((b) => ({
        ...b,
        overlays: b.overlays.map((o) => {
          if (o.type !== 'text') return o;
          if (allow && !allow.has(o.id)) return o;
          const before = String((o as any).content ?? '');
          const matches = before.match(re);
          if (!matches?.length) return o;
          replaced += matches.length;
          return { ...o, content: before.replace(re, replacement) } as Overlay;
        }),
      })),
    })),
  };
  return { template: next, replaced };
}

// ─── Constraints helper (apply on paper-size change) ────────────────────────
/**
 * Re-flow overlay coordinates for a single page when its size changes. Honors
 * `overlay.constraints` pinning. Centerings + side pins take precedence over
 * scale; width/height='scale' rescales proportional to the dimension change.
 */
export function reflowPageForResize(
  page: Page,
  prev: { width: number; height: number },
  next: { width: number; height: number },
): Page {
  const dw = next.width - prev.width;
  const dh = next.height - prev.height;
  const sx = prev.width ? next.width / prev.width : 1;
  const sy = prev.height ? next.height / prev.height : 1;
  return mapOverlays(page, (o) => {
    const c = o.constraints;
    if (!c) {
      // default: keep top-left fixed, no scale
      return o;
    }
    let { x, y, width, height } = o;
    // width / height
    if (c.width === 'scale') width = Math.max(4, Math.round(width * sx));
    if (c.height === 'scale') height = Math.max(4, Math.round(height * sy));
    // horizontal positioning
    if (c.centerH) {
      x = Math.round((next.width - width) / 2);
    } else if (c.left && c.right) {
      width = Math.max(4, width + dw);
    } else if (c.right) {
      const rightInset = prev.width - (o.x + o.width);
      x = next.width - rightInset - width;
    }
    // vertical positioning
    if (c.centerV) {
      y = Math.round((next.height - height) / 2);
    } else if (c.top && c.bottom) {
      height = Math.max(4, height + dh);
    } else if (c.bottom) {
      const bottomInset = prev.height - (o.y + o.height);
      y = next.height - bottomInset - height;
    }
    return { ...o, x, y, width, height };
  });
}

// ─── Marquee (rectangle) overlay selection ──────────────────────────────────
export function selectInMarquee(page: Page, rect: { x: number; y: number; w: number; h: number }): string[] {
  const result: string[] = [];
  for (const o of flatOverlays(page).map((x) => x.overlay)) {
    if (o.hidden) continue;
    const intersects =
      o.x < rect.x + rect.w &&
      o.x + o.width > rect.x &&
      o.y < rect.y + rect.h &&
      o.y + o.height > rect.y;
    if (intersects) result.push(o.id);
  }
  return result;
}

// ─── Smart guides (snap candidates) ─────────────────────────────────────────
export interface SnapCandidates {
  vertical: number[];   // page-x lines (left/center/right of other overlays + page edges)
  horizontal: number[]; // page-y lines
}
export function snapCandidates(page: Page, excludeIds: Set<string>): SnapCandidates {
  const vertical = new Set<number>();
  const horizontal = new Set<number>();
  const w = page.size.width ?? 595, h = page.size.height ?? 842;
  const safe = page.safeArea ?? 0;
  // page edges + center + safe area
  vertical.add(0); vertical.add(w); vertical.add(w / 2); vertical.add(safe); vertical.add(w - safe);
  horizontal.add(0); horizontal.add(h); horizontal.add(h / 2); horizontal.add(safe); horizontal.add(h - safe);
  for (const o of flatOverlays(page).map((x) => x.overlay)) {
    if (excludeIds.has(o.id) || o.hidden) continue;
    vertical.add(o.x); vertical.add(o.x + o.width / 2); vertical.add(o.x + o.width);
    horizontal.add(o.y); horizontal.add(o.y + o.height / 2); horizontal.add(o.y + o.height);
  }
  return {
    vertical: Array.from(vertical).sort((a, b) => a - b),
    horizontal: Array.from(horizontal).sort((a, b) => a - b),
  };
}
export function snapValue(target: number, candidates: number[], threshold: number): { value: number; snapped: boolean } {
  let best = target, bestDelta = threshold + 1;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDelta) { best = c; bestDelta = d; }
  }
  return bestDelta <= threshold ? { value: best, snapped: true } : { value: target, snapped: false };
}

// ─── Compose helper for replacing a page back into a template ──────────────
export function withPage(template: ReportTemplate, next: Page): ReportTemplate {
  return { ...template, pages: template.pages.map((p) => (p.id === next.id ? next : p)) };
}

// ─── Block re-helpers (block.locked / block.hidden) ─────────────────────────
export function setBlockLocked(page: Page, blockId: string, locked: boolean): Page {
  return { ...page, blocks: page.blocks.map((b) => (b.id === blockId ? ({ ...b, locked } as Block) : b)) };
}
export function setBlockHidden(page: Page, blockId: string, hidden: boolean): Page {
  return { ...page, blocks: page.blocks.map((b) => (b.id === blockId ? ({ ...b, hidden } as Block) : b)) };
}
