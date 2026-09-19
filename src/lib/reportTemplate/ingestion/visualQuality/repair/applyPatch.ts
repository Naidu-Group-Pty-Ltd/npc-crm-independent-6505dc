/**
 * Phase 6 — Apply repair patches to a CDIR document.
 *
 * Pure, deep-cloning: the input document is never mutated. Unknown layer ids
 * are silently skipped (the patch will simply not improve the score, so the
 * orchestrator's accept-on-improvement policy will reject it). All numbers
 * are validated to be finite before being written.
 */
import type {
  CdirDocument,
  CdirLayer,
  CdirPage,
  CdirTextLayer,
} from '@/lib/reportTemplate/ingestion/cdir/schema';
import type { RepairOp, RepairPatch } from './repairTypes';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function cloneDocument(doc: CdirDocument): CdirDocument {
  // CDIR is plain JSON — structuredClone is safe and quick.
  if (typeof structuredClone === 'function') return structuredClone(doc);
  return JSON.parse(JSON.stringify(doc));
}

function visitLayers(
  layers: CdirLayer[],
  visitor: (layer: CdirLayer, parent: CdirLayer[] | null, index: number) => void,
  parent: CdirLayer[] | null = null,
): void {
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!layer) continue;
    visitor(layer, parent ?? layers, i);
    if (layer.kind === 'group') {
      visitLayers(layer.children ?? [], visitor, layer.children ?? []);
    }
  }
}

function findLayerById(page: CdirPage, layerId: string): CdirLayer | null {
  let found: CdirLayer | null = null;
  visitLayers(page.layers ?? [], (layer) => {
    if (!found && layer.id === layerId) found = layer;
  });
  return found;
}

function applyOp(doc: CdirDocument, op: RepairOp): boolean {
  const page = doc.pages.find((p) => p.id === op.pageId);
  if (!page) return false;

  switch (op.kind) {
    case 'replace_text': {
      const layer = findLayerById(page, op.layerId);
      if (!layer || layer.kind !== 'text') return false;
      const textLayer = layer as CdirTextLayer;
      const runs = textLayer.runs ?? [];
      const first = runs[0] ?? { text: '' };
      textLayer.text = op.text;
      textLayer.runs = [{ ...first, text: op.text }];
      return true;
    }
    case 'set_bounds': {
      const layer = findLayerById(page, op.layerId);
      if (!layer) return false;
      const b = op.bounds;
      if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y) || !isFiniteNumber(b.width) || !isFiniteNumber(b.height)) {
        return false;
      }
      layer.bounds = { ...layer.bounds, x: b.x, y: b.y, width: b.width, height: b.height };
      return true;
    }
    case 'append_text_layer': {
      const { layer } = op;
      if (!layer?.id || !layer?.bounds || typeof layer.text !== 'string') return false;
      if (!isFiniteNumber(layer.bounds.x) || !isFiniteNumber(layer.bounds.y) || !isFiniteNumber(layer.bounds.width) || !isFiniteNumber(layer.bounds.height)) {
        return false;
      }
      // Avoid id collisions — silently drop if it would clobber.
      if (findLayerById(page, layer.id)) return false;
      const newLayer: CdirTextLayer = {
        id: layer.id,
        kind: 'text',
        bounds: layer.bounds,
        text: layer.text,
        runs: [{
          text: layer.text,
          fontSize: layer.fontSize,
          color: layer.color,
        }],
        align: layer.align,
      };
      page.layers = [...(page.layers ?? []), newLayer];
      return true;
    }
    default:
      return false;
  }
}

export interface ApplyPatchResult {
  doc: CdirDocument;
  opsApplied: number;
  opsRejected: number;
}

/** Apply a single patch (deep-clone first) and return the new document. */
export function applyPatch(doc: CdirDocument, patch: RepairPatch): ApplyPatchResult {
  const next = cloneDocument(doc);
  let applied = 0;
  let rejected = 0;
  for (const op of patch.ops) {
    if (applyOp(next, op)) applied += 1;
    else rejected += 1;
  }
  return { doc: next, opsApplied: applied, opsRejected: rejected };
}

/** Apply many patches sequentially (each on top of the previous result). */
export function applyPatches(doc: CdirDocument, patches: RepairPatch[]): ApplyPatchResult {
  let current = doc;
  let applied = 0;
  let rejected = 0;
  for (const patch of patches) {
    const r = applyPatch(current, patch);
    current = r.doc;
    applied += r.opsApplied;
    rejected += r.opsRejected;
  }
  return { doc: current, opsApplied: applied, opsRejected: rejected };
}
