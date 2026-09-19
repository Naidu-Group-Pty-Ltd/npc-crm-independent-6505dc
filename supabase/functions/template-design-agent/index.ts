// Template Design Agent — conversational tool-calling editor for ReportTemplate JSON.
//
// Accepts a chat history + the current schema, asks GPT-5.5 to plan and emit
// a batch of structured operations via tool calling, applies them server-side
// (so the schema returned is always valid), and returns:
//   { reply, schema, operations: [{ op, summary }] }
//
// Designed for high contextual awareness: passes a compact outline of every
// page/block/overlay plus the active selection, lets the model issue many
// operations in a single turn.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifyAuthOrNativeUser, createTokenAuthCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { analyzeReferenceImage, integrateBriefTokens, synthesisSystemAddendum, validateBriefSynthesis, type DesignBrief } from '../_shared/designBrief.ts';
import { callClaudeReconstruct } from '../_shared/claudeReconstruct.ts';
import { validateAndMigrateTemplateSchemaVersion } from '../_shared/templateSchemaVersion.ts';
import { expandIconOverlay, ICON_NAMES } from '../_shared/iconPack.ts';
import { validateVisionImageDataUrl } from '../_shared/visionImage.ts';
import { CRITIQUE_TOOL_SCHEMA, VISUAL_CRITIQUE_VERSION } from '../_shared/visualCritique.pure.ts';
// Used at both 5xx sites below. Missing since #2013, which added the calls
// without the import — so this file has not type-checked on `main` since, and
// `check-edge-functions.mjs` has been failing the `security` job on it.
import { internalError } from '../_shared/errorResponse.ts';
import { resolveAnthropicCredential } from '../_shared/anthropicCredential.ts';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
/*
 * Whether this deployment can reach Claude is resolved PER REQUEST, below.
 *
 * It used to be `const USE_CLAUDE = !!Deno.env.get('ANTHROPIC_API_KEY')` read
 * once at module load, which gates this agent's entire Claude path — visual
 * critique, native PDF reconstruction and brief synthesis. A clone that
 * reaches Anthropic by federation holds no key, so all three answered
 * "requires Claude (set ANTHROPIC_API_KEY)": a 400 telling an operator to set
 * a credential that must NOT be set on that deployment.
 */
const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-5.5';
// Synthesis model — strong reasoning + tool calling. Vision lives in designBrief.ts.
const SYNTHESIS_MODEL = 'openai/gpt-5';
const VISION_MODEL = 'openai/gpt-5';
const CLAUDE_MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-4-8';
const MAX_VISION_IMAGE_BYTES = 10 * 1024 * 1024;

// ─── C9: server-side visual-diff-repair-patch-v1 allowlist ───────────────────
// Defense-in-depth mirror of the client `validateVisualDiffRepairPatches`. The
// `layout_reconciliation_repair` mode may ONLY ever return page-scoped patches
// from this allowlist: known ops, no cross-page ids, no text-content edits, no
// added text overlays, capped. Page add/delete/reorder is unrepresentable.
const VISUAL_DIFF_REPAIR_ALLOWLIST_VERSION = 'visual-diff-repair-patch-v1';
const VISUAL_DIFF_REPAIR_ALLOWED_OPS = new Set(['updatePageBackground', 'updateOverlay', 'addOverlay', 'removeOverlay']);
const VISUAL_DIFF_REPAIR_FORBIDDEN_FIELDS = ['content', 'text', 'runs', 'rich'];
const VISUAL_DIFF_REPAIR_TEXT_TYPES = new Set(['text', 'textOnPath']);

function sanitizeVisualDiffRepairPatches(
  raw: unknown,
  pageId: string,
  maxOps: number,
): { patches: any[]; rejected: Array<{ index: number; reason: string }> } {
  const patches: any[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  if (!Array.isArray(raw)) return { patches, rejected: [{ index: -1, reason: 'patch payload is not an array' }] };
  raw.forEach((item: any, index: number) => {
    if (patches.length >= maxOps) { rejected.push({ index, reason: `exceeds max ${maxOps} operations` }); return; }
    const op = item?.operation;
    if (typeof op !== 'string' || !VISUAL_DIFF_REPAIR_ALLOWED_OPS.has(op)) { rejected.push({ index, reason: 'unknown or malformed operation' }); return; }
    if (item?.pageId !== pageId) { rejected.push({ index, reason: 'cross-page patch not allowed' }); return; }
    if (op === 'updateOverlay' && item?.changes && typeof item.changes === 'object'
      && VISUAL_DIFF_REPAIR_FORBIDDEN_FIELDS.some((f) => f in item.changes)) {
      rejected.push({ index, reason: 'text-content edits are not permitted' });
      return;
    }
    if (op === 'addOverlay' && VISUAL_DIFF_REPAIR_TEXT_TYPES.has(item?.overlay?.type)) {
      rejected.push({ index, reason: 'adding text overlays is not permitted' });
      return;
    }
    patches.push(item);
  });
  return { patches, rejected };
}


// ─── helpers: outline + uuid ──────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }
function ensureIds(node: any): any {
  if (node && typeof node === 'object') {
    if (!node.id) node.id = uid();
    if (Array.isArray(node.blocks)) node.blocks.forEach(ensureIds);
    if (Array.isArray(node.overlays)) node.overlays.forEach((o: any) => { if (!o.id) o.id = uid(); });
  }
  return node;
}


function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function normaliseSchemaForClient(schema: any): any {
  const s = JSON.parse(JSON.stringify(schema || {}));
  // Phase 4: validate + migrate explicitly instead of stamping version=1.
  validateAndMigrateTemplateSchemaVersion(s);
  s.tokens = s.tokens && typeof s.tokens === 'object' ? s.tokens : { colors: {}, fonts: {}, spacing: {} };
  s.tokens.colors = s.tokens.colors && typeof s.tokens.colors === 'object' ? s.tokens.colors : {};
  s.tokens.fonts = s.tokens.fonts && typeof s.tokens.fonts === 'object' ? s.tokens.fonts : {};
  s.tokens.spacing = s.tokens.spacing && typeof s.tokens.spacing === 'object' ? s.tokens.spacing : {};
  s.slots = s.slots && typeof s.slots === 'object' ? s.slots : {};
  s.pages = Array.isArray(s.pages) ? s.pages : [];
  for (const page of s.pages) {
    page.id = String(page.id || uid());
    page.name = String(page.name || 'Page');
    page.size = { width: Number(page.size?.width) || 595, height: Number(page.size?.height) || 842 };
    page.background = page.background && typeof page.background === 'object' ? page.background : {};
    page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
    for (const block of page.blocks) {
      block.id = String(block.id || uid());
      block.type = String(block.type || 'free');
      block.props = block.props && typeof block.props === 'object' ? block.props : {};
      block.overlays = Array.isArray(block.overlays) ? block.overlays : [];
      for (const overlay of block.overlays) {
        overlay.id = String(overlay.id || uid());
        overlay.x = Number(overlay.x) || 0;
        overlay.y = Number(overlay.y) || 0;
        overlay.width = Math.max(1, Number(overlay.width) || 1);
        overlay.height = Math.max(1, Number(overlay.height) || 1);
        overlay.rotation = Number(overlay.rotation) || 0;
        overlay.opacity = Math.min(1, Math.max(0, Number(overlay.opacity ?? 1)));
        if (overlay.type === 'text') {
          const weight = Number(overlay.fontWeight);
          // Keep the exact numeric weight (renderer emits fontWeightNumeric);
          // quantizing to bold/normal loses 300/500/600 weights from references.
          if (Number.isFinite(weight) && weight >= 100 && weight <= 1000 && overlay.fontWeightNumeric == null) {
            overlay.fontWeightNumeric = weight;
          }
          overlay.fontWeight = overlay.fontWeight === 'bold' || (Number.isFinite(weight) && weight >= 600) ? 'bold' : 'normal';
          overlay.fontStyle = overlay.fontStyle === 'italic' ? 'italic' : 'normal';
          overlay.align = ['left', 'center', 'right', 'justify'].includes(overlay.align) ? overlay.align : 'left';
          overlay.content = String(overlay.content ?? '');
          overlay.fontFamily = overlay.fontFamily ?? 'Helvetica';
          overlay.fontSize = overlay.fontSize ?? 12;
          overlay.color = overlay.color ?? '#000000';
          overlay.lineHeight = Number(overlay.lineHeight) || 1.3;
          overlay.letterSpacing = Number(overlay.letterSpacing) || 0;
        }
      }
    }
  }
  return s;
}
function outline(schema: any, activePageId?: string): string {
  if (!schema?.pages) return '(empty template)';
  const lines: string[] = [];
  const tokens = schema.tokens || {};
  lines.push(`tokens.colors=${JSON.stringify(tokens.colors || {})}`);
  lines.push(`tokens.fonts=${JSON.stringify(tokens.fonts || {})}`);
  schema.pages.forEach((p: any, i: number) => {
    const isActive = p.id === activePageId;
    const focused = !activePageId || isActive;
    lines.push(`${isActive ? '▶ ' : '  '}page[${i}] id=${p.id} name=${JSON.stringify(p.name)} size=${p.size?.width}x${p.size?.height} bg=${p.background?.color || p.background?.imageUrl || '-'}${isActive ? '  ← ACTIVE' : ''}`);
    const blocks = p.blocks || [];
    const overlayCap = focused ? 20 : 4;
    const blockCap = focused ? 999 : 6;
    blocks.slice(0, blockCap).forEach((b: any, bi: number) => {
      const ov = (b.overlays || []).length;
      lines.push(`    block[${bi}] id=${b.id} type=${b.type} overlays=${ov}${b.name ? ` name="${b.name}"` : ''}`);
      (b.overlays || []).slice(0, overlayCap).forEach((o: any, oi: number) => {
        const pos = `@${Math.round(o.x)},${Math.round(o.y)} ${Math.round(o.width)}x${Math.round(o.height)}`;
        if (o.type === 'text') {
          const c = String(o.content || '').replace(/\s+/g, ' ').slice(0, 60);
          const style = `${o.fontSize ?? '?'}pt ${o.fontWeight || 'normal'} ${o.color || '-'} align=${o.align || 'left'}`;
          lines.push(`      ov[${oi}] id=${o.id} text "${c}" ${pos} ${style}`);
        } else if (o.type === 'shape') {
          lines.push(`      ov[${oi}] id=${o.id} shape=${o.shape || 'rect'} fill=${o.fill || '-'} stroke=${o.stroke || '-'} ${pos}`);
        } else if (o.type === 'image') {
          lines.push(`      ov[${oi}] id=${o.id} image fit=${o.fit || 'cover'} ${pos}`);
        } else {
          lines.push(`      ov[${oi}] id=${o.id} ${o.type} ${pos}`);
        }
      });
      if ((b.overlays || []).length > overlayCap) lines.push(`      … +${b.overlays.length - overlayCap} more overlays`);
    });
    if (blocks.length > blockCap) lines.push(`    … +${blocks.length - blockCap} more blocks`);
  });
  return lines.join('\n');
}

// ─── post-op cleanup: snap to grid, clamp to canvas, dedupe duplicates ────────
function cleanupSchema(schema: any, opts: { grid?: number; clampPages?: Set<string> } = {}): { schema: any; fixes: string[] } {
  const s = JSON.parse(JSON.stringify(schema));
  const grid = Math.max(0, opts.grid ?? 0);
  const fixes: string[] = [];
  const snap = (n: number) => (grid > 0 ? Math.round(n / grid) * grid : n);

  for (const page of s.pages || []) {
    const shouldClamp = !opts.clampPages || opts.clampPages.has(page.id);
    const W = Number(page.size?.width) || 595;
    const H = Number(page.size?.height) || 842;
    for (const block of page.blocks || []) {
      // Dedupe text overlays with identical content + near-identical position
      const seen = new Map<string, any>();
      const survivors: any[] = [];
      for (const o of block.overlays || []) {
        if (shouldClamp) {
          const w = Math.min(W, Math.max(1, Number(o.width) || 1));
          const h = Math.min(H, Math.max(1, Number(o.height) || 1));
          let x = Math.max(0, Math.min(W - w, Number(o.x) || 0));
          let y = Math.max(0, Math.min(H - h, Number(o.y) || 0));
          if (grid > 0) {
            // Snapping can round a coordinate beyond the final grid interval,
            // so clamp again to keep the overlay inside the page.
            x = Math.max(0, Math.min(W - w, snap(x)));
            y = Math.max(0, Math.min(H - h, snap(y)));
          }
          if (x !== o.x || y !== o.y || w !== o.width || h !== o.height) {
            o.x = x; o.y = y; o.width = w; o.height = h;
          }
        }
        if (o.type === 'text') {
          const key = `${String(o.content || '').trim().toLowerCase()}|${Math.round(o.x / 6)}|${Math.round(o.y / 6)}|${o.fontSize}`;
          if (seen.has(key)) {
            fixes.push(`deduped duplicate text "${String(o.content || '').slice(0, 30)}" on page ${page.id}`);
            continue;
          }
          seen.set(key, o);
        }
        survivors.push(o);
      }
      block.overlays = survivors;
    }
  }
  return { schema: s, fixes };
}

// ─── operation applier ────────────────────────────────────────────────────────
type Op = { op: string; [k: string]: any };

function deepSet(obj: any, path: string, value: any) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}
function deepMerge<T>(target: any, patch: any): T {
  if (patch == null) return target;
  if (Array.isArray(patch)) return patch as T;
  if (typeof patch !== 'object') return patch as T;
  const out: any = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}
function findPage(s: any, id: string) { return s.pages.find((p: any) => p.id === id); }
function findBlock(p: any, id: string) { return (p.blocks || []).find((b: any) => b.id === id); }

function applyOps(schema: any, ops: Op[]): { schema: any; summaries: string[]; warnings: string[] } {
  const s = JSON.parse(JSON.stringify(schema));
  const summaries: string[] = [];
  const warnings: string[] = [];
  for (const op of ops) {
    try {
      switch (op.op) {
        case 'set_token': {
          if (!s.tokens) s.tokens = { colors: {}, fonts: {}, spacing: {} };
          deepSet(s.tokens, op.path, op.value);
          summaries.push(`token ${op.path} = ${JSON.stringify(op.value)}`);
          break;
        }
        case 'set_meta': {
          s.meta = deepMerge(s.meta || {}, op.patch || {});
          summaries.push(`meta updated`);
          break;
        }
        case 'add_page': {
          const page = ensureIds({
            id: uid(),
            name: op.page?.name || `Page ${s.pages.length + 1}`,
            size: op.page?.size || { width: 595, height: 842 },
            background: op.page?.background || {},
            blocks: op.page?.blocks || [],
            ...(op.page || {}),
          });
          if (typeof op.afterIndex === 'number') s.pages.splice(op.afterIndex + 1, 0, page);
          else s.pages.push(page);
          summaries.push(`added page "${page.name}" (${page.id})`);
          break;
        }
        case 'duplicate_page': {
          const idx = s.pages.findIndex((p: any) => p.id === op.pageId);
          if (idx < 0) { warnings.push(`duplicate_page: page ${op.pageId} not found`); break; }
          const clone = JSON.parse(JSON.stringify(s.pages[idx]));
          clone.id = uid();
          clone.name = `${clone.name} copy`;
          (clone.blocks || []).forEach((b: any) => {
            b.id = uid();
            (b.overlays || []).forEach((o: any) => { o.id = uid(); });
          });
          s.pages.splice(idx + 1, 0, clone);
          summaries.push(`duplicated page → ${clone.id}`);
          break;
        }
        case 'delete_page': {
          const before = s.pages.length;
          s.pages = s.pages.filter((p: any) => p.id !== op.pageId);
          if (s.pages.length === before) warnings.push(`delete_page: ${op.pageId} not found`);
          else summaries.push(`deleted page ${op.pageId}`);
          break;
        }
        case 'reorder_pages': {
          const order: string[] = op.pageIds || [];
          const map = new Map(s.pages.map((p: any) => [p.id, p]));
          const reordered = order.map((id) => map.get(id)).filter(Boolean);
          // append any pages missing from order
          for (const p of s.pages) if (!order.includes(p.id)) reordered.push(p);
          s.pages = reordered;
          summaries.push(`reordered pages`);
          break;
        }
        case 'update_page': {
          const p = findPage(s, op.pageId);
          if (!p) { warnings.push(`update_page: ${op.pageId} not found`); break; }
          Object.assign(p, deepMerge(p, op.patch || {}));
          summaries.push(`updated page ${op.pageId}`);
          break;
        }
        case 'add_block': {
          const p = findPage(s, op.pageId);
          if (!p) { warnings.push(`add_block: page ${op.pageId} not found`); break; }
          const block = ensureIds({
            id: uid(),
            type: op.block?.type || 'free',
            props: op.block?.props || {},
            overlays: op.block?.overlays || [],
            ...(op.block || {}),
          });
          if (op.afterBlockId) {
            const i = p.blocks.findIndex((b: any) => b.id === op.afterBlockId);
            p.blocks.splice(i >= 0 ? i + 1 : p.blocks.length, 0, block);
          } else p.blocks.push(block);
          summaries.push(`added ${block.type} block → page ${op.pageId}`);
          break;
        }
        case 'update_block': {
          const p = findPage(s, op.pageId);
          const b = p && findBlock(p, op.blockId);
          if (!b) { warnings.push(`update_block: ${op.blockId} not found`); break; }
          Object.assign(b, deepMerge(b, op.patch || {}));
          summaries.push(`updated block ${op.blockId}`);
          break;
        }
        case 'delete_block': {
          const p = findPage(s, op.pageId);
          if (!p) { warnings.push(`delete_block: page ${op.pageId}`); break; }
          const before = p.blocks.length;
          p.blocks = p.blocks.filter((b: any) => b.id !== op.blockId);
          if (p.blocks.length === before) warnings.push(`delete_block: ${op.blockId} not found`);
          else summaries.push(`deleted block ${op.blockId}`);
          break;
        }
        case 'add_overlay': {
          const p = findPage(s, op.pageId);
          const b = p && findBlock(p, op.blockId);
          if (!b) { warnings.push(`add_overlay: target not found`); break; }
          const overlay = expandIconOverlay({ id: uid(), rotation: 0, opacity: 1, ...op.overlay });
          b.overlays = b.overlays || [];
          b.overlays.push(overlay);
          summaries.push(`added ${overlay.type} overlay → block ${b.id}`);
          break;
        }
        case 'update_overlay': {
          const p = findPage(s, op.pageId);
          const b = p && findBlock(p, op.blockId);
          const o = b && (b.overlays || []).find((x: any) => x.id === op.overlayId);
          if (!o) { warnings.push(`update_overlay: ${op.overlayId} not found`); break; }
          Object.assign(o, deepMerge(o, op.patch || {}));
          if ((o as any).icon) Object.assign(o, expandIconOverlay(o));
          summaries.push(`updated overlay ${op.overlayId}`);
          break;
        }
        case 'delete_overlay': {
          const p = findPage(s, op.pageId);
          const b = p && findBlock(p, op.blockId);
          if (!b) { warnings.push(`delete_overlay: target not found`); break; }
          const before = b.overlays.length;
          b.overlays = b.overlays.filter((o: any) => o.id !== op.overlayId);
          if (b.overlays.length === before) warnings.push(`delete_overlay: ${op.overlayId} not found`);
          else summaries.push(`deleted overlay ${op.overlayId}`);
          break;
        }
        case 'clear_page': {
          const p = findPage(s, op.pageId);
          if (!p) { warnings.push(`clear_page: ${op.pageId} not found`); break; }
          const removed = (p.blocks || []).length;
          p.blocks = [];
          summaries.push(`cleared page ${op.pageId} (${removed} blocks removed)`);
          break;
        }
        case 'clear_block_overlays': {
          const p = findPage(s, op.pageId);
          const b = p && findBlock(p, op.blockId);
          if (!b) { warnings.push(`clear_block_overlays: target not found`); break; }
          const removed = (b.overlays || []).length;
          b.overlays = [];
          summaries.push(`cleared ${removed} overlays in block ${op.blockId}`);
          break;
        }
        case 'apply_theme': {
          // quick built-in palettes
          const themes: Record<string, any> = {
            luxe: { colors: { primary: '#BF9B50', bg: '#0D0D0D', text: '#F5F1E8', muted: '#9A8E73' }, fonts: { heading: '"Playfair Display", serif', body: 'Inter, sans-serif' } },
            editorial: { colors: { primary: '#1A1A1A', bg: '#FAFAF7', text: '#1A1A1A', muted: '#666' }, fonts: { heading: '"Playfair Display", serif', body: 'Georgia, serif' } },
            modern: { colors: { primary: '#0F62FE', bg: '#FFFFFF', text: '#161616', muted: '#525252' }, fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' } },
            print: { colors: { primary: '#000000', bg: '#FFFFFF', text: '#111111', muted: '#555' }, fonts: { heading: 'Georgia, serif', body: 'Georgia, serif' } },
            dark: { colors: { primary: '#D4A843', bg: '#0D0D0D', text: '#FFFFFF', muted: '#9A8E73' }, fonts: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' } },
          };
          const t = themes[String(op.name).toLowerCase()];
          if (!t) { warnings.push(`apply_theme: unknown theme ${op.name}`); break; }
          s.tokens = s.tokens || { colors: {}, fonts: {}, spacing: {} };
          s.tokens.colors = { ...s.tokens.colors, ...t.colors };
          s.tokens.fonts = { ...s.tokens.fonts, ...t.fonts };
          summaries.push(`applied theme "${op.name}"`);
          break;
        }
        default:
          warnings.push(`unknown op: ${op.op}`);
      }
    } catch (e) {
      warnings.push(`${op.op} failed: ${(e as Error).message}`);
    }
  }
  return { schema: s, summaries, warnings };
}

// ─── tool schema ──────────────────────────────────────────────────────────────
const TOOL = {
  type: 'function',
  function: {
    name: 'apply_changes',
    description:
      'Apply a batch of operations to the ReportTemplate JSON. Emit ALL changes for the current user turn as a single call (multiple ops). The server validates and applies them in order.',
    parameters: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Short, plain-English summary for the designer of what you changed and why.' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: [
                  'set_token','set_meta',
                  'add_page','duplicate_page','delete_page','reorder_pages','update_page',
                  'add_block','update_block','delete_block',
                  'add_overlay','update_overlay','delete_overlay',
                  'clear_page','clear_block_overlays',
                  'apply_theme',
                ],
              },
              path: { type: 'string' },
              value: {},
              patch: { type: 'object', additionalProperties: true },
              pageId: { type: 'string' },
              blockId: { type: 'string' },
              overlayId: { type: 'string' },
              afterIndex: { type: 'number' },
              afterBlockId: { type: 'string' },
              pageIds: { type: 'array', items: { type: 'string' } },
              page: { type: 'object', additionalProperties: true },
              block: { type: 'object', additionalProperties: true },
              overlay: { type: 'object', additionalProperties: true },
              name: { type: 'string' },
            },
            required: ['op'],
            additionalProperties: false,
          },
        },
      },
      required: ['reply', 'operations'],
      additionalProperties: false,
    },
  },
};

const SYSTEM = `You are the **Template Design Agent** for a premium PDF report builder.
You edit a ReportTemplate JSON document on behalf of a designer through a single tool: \`apply_changes\`.

Schema vocabulary you must respect:
- Coordinates are PDF points (1pt = 1/72 inch). A4 portrait = 595 × 842.
- Page = { id, name, size{width,height}, background{color,imageUrl}, blocks[] }.
- Block = { id, type, props, overlays[] }. Use exact block types: free, cover, hero, kpi-grid, data-table, chart, image, text-block, footer, disclaimer, divider, callout, two-column, gallery, page-number, spacer, qr, badge-list, toc, auto-toc, signature, slot, scorecard, risk-register, infra-timeline, amenity-matrix, planning-table, dd-checklist, decision-box, strengths-watch.
- Overlay = text | image | shape, each with x,y (top-left origin), width, height, rotation, opacity.
  - text: content, fontFamily, fontSize, fontWeight ("normal", "bold", or a numeric 100–900 weight), fontStyle, color (#hex or "token:primary"), align, lineHeight.
  - shape: shape='rect'|'line'|'ellipse', fill, stroke, strokeWidth, borderRadius. 'fill' accepts a flat colour OR a raw CSS gradient string (e.g. "linear-gradient(135deg, #0A2540 0%, #1A3A5A 100%)") — use a gradient when the source background is a gradient, never flatten it to one colour.
  - image: src, fit='cover'|'contain'|'fill'.
  - vector ICON: { type:'vector', icon:'<name>', color:'#hex', x,y,width,height } — the server expands the named glyph from the built-in icon pack (24×24 stroke icons). NEVER invent svg path data; only use pack names. Available names: ${ICON_NAMES.join(', ')}.
- Tokens: colors{}, fonts{}, spacing{}. Reference via "token:<key>" in any color or string.
- Bindings: "{{path.to.data}}" anywhere a string is allowed; do not invent paths.

DESIGN STANDARDS — be opinionated and creative:
- Use rich typographic hierarchy: display 56–72pt, h1 32, h2 22, h3 16, body 11, caption 9, eyebrow 10 UPPERCASE letter-spacing 1.5.
- Snap every overlay to a 6pt grid (x, y, width, height divisible by 6). Use a 48pt outer page margin and 24pt gutters.
- Use the token palette; only hard-code colours when the designer explicitly asks. Limit a page to bg + text + one accent (token:primary).
- Maintain ≥ 4.5:1 contrast for body text. Vertical rhythm should be a consistent 16pt or 24pt — never random gaps.

LAYOUT RECIPES (scaffolds — adapt to the brief, never copy verbatim):
- Editorial cover: eyebrow 11pt UPPERCASE muted · display title 56–72pt serif token:primary · sub-deck 18pt · 120×2 gold rule shape · 9pt footer meta with bindings.
- Section opener: oversized numeral (72pt thin, 35% opacity) · 32pt bold title · 14pt italic tagline · hairline rule below.
- KPI strip: three columns @ x=48,219,390 width=158 height=120 · 10pt UPPERCASE label · 36pt bold token:primary value · 11pt muted delta.
- Closing/CTA: 28pt italic quote · 11pt attribution · gold rule · contact block bottom-right.

QUALITY BAR — if any of these are true after your edit, you have failed:
- Two text overlays with the same content on the same page.
- Overlay extending beyond the page bounds.
- Mixed serif & sans display headings on the same page without intent.
- Hard-coded hex colour where a token exists.
- A "polish" request that created new blocks instead of refining existing ones.

REPLACEMENT vs ADDITIVE — CRITICAL:
- The default mistake is to keep stacking new blocks on top of existing ones. Don't.
- If the user says "redesign", "redo", "rebuild", "replace", "start over", "clean up", "from scratch", "wipe", or describes the page as if it were empty, you MUST emit a 'clear_page' for the target page BEFORE any add_block/add_overlay ops. This wipes existing content so your new layout actually replaces it.
- If the user asks to "tweak", "adjust", "tighten", "polish", "fix", or names a specific element, DO NOT clear — instead use update_block / update_overlay / delete_block on the precise targets.
- Never duplicate an element that already exists on the page. Before adding a heading/title/KPI grid, scan the outline; if one is present, update it in place instead of adding a new one.
- When unsure whether the user wants additive or replacement, prefer replacement for whole-page instructions and additive for element-level instructions.

CONVERSATIONAL RULES:
- Treat each user message as a possibly multi-step instruction. Break it down silently, then emit ALL operations in ONE \`apply_changes\` call.
- Reference targets by the exact ids shown in the outline. Never invent ids.
- When you ADD elements, do not include an "id" — the server generates one.
- Reply in 1–3 short sentences for the designer; keep it concrete ("Cleared the cover and rebuilt it with a gold hero title + accent rule + KPI strip").
- If the request is ambiguous, make the most tasteful interpretation and proceed; ask only when you genuinely cannot proceed.`;

Deno.serve(async (req) => {
  // Origin-aware: an allowlisted origin gets an exact ACAO + credentials so the
  // HttpOnly `__Host-session_token` cookie authenticates the caller. Anyone else
  // keeps the historical wildcard token-auth answer.
  const cors = createTokenAuthCorsHeaders(req.headers.get('origin'));
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // This agent spends AI credits on ambient cookie authority, so an
  // exact-origin check is mandatory. No-ops for callers that send no cookie.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  const anthropic = await resolveAnthropicCredential();
  const anthropicCredential = anthropic.ok ? anthropic.credential : null;
  const USE_CLAUDE = anthropicCredential !== null;
  if (!LOVABLE_API_KEY && !USE_CLAUDE) {
    return json({ error: `No AI provider configured: ${anthropic.ok ? '' : anthropic.why}` }, 500);
  }

  try {
    const body = await req.json();

    // Custom-auth verification (session token or custom HS256 JWT) — this agent
    // spends AI credits and must not be publicly invokable.
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const auth = await verifyAuthOrNativeUser(supabaseAdmin, req, body);
    if (auth.error) return createUnauthorizedResponse(auth.error, cors);
    const schema = body.schema || { version: 1, pages: [], tokens: {}, slots: {} };
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = body.messages || [];
    const userInstruction: string = body.instruction || (history[history.length - 1]?.content ?? '');
    const activePageId: string | undefined = body.activePageId;
    const selectedBlockId: string | undefined = body.selectedBlockId;
    const selectedOverlayId: string | undefined = body.selectedOverlayId;
    const mode: 'design' | 'art_director' | 'screenshot_to_block' | 'inline_text' | 'auto_fill' | 'brief' | 'pdf_document' = body.mode || 'design';
    const suppliedImage = body.imageDataUrl;
    const validatedImage = suppliedImage == null
      ? null
      : validateVisionImageDataUrl(suppliedImage, MAX_VISION_IMAGE_BYTES);
    if (validatedImage && !validatedImage.ok) {
      return json({
        error: validatedImage.reason === 'too_large'
          ? 'Attached image exceeds the 10 MB limit.'
          : 'Attached image must be a base64-encoded PNG, JPEG, WebP, or GIF data URL.',
      }, validatedImage.reason === 'too_large' ? 413 : 400);
    }
    const imageDataUrl = validatedImage?.ok ? validatedImage.dataUrl : undefined;
    const pdfBase64: string | undefined = typeof body.pdfBase64 === 'string' ? body.pdfBase64 : undefined; // §7a native PDF
    const memoryFacts: string[] = Array.isArray(body.memoryFacts) ? body.memoryFacts : [];
    const sampleData: any = body.sampleData ?? null;
    const replaceMode: boolean = body.replaceMode === true;
    // Re-roll support: client can pass a cached brief to skip the vision stage.
    const incomingBrief: DesignBrief | null = body.brief && typeof body.brief === 'object' ? body.brief : null;
    const briefStage: 'analyze_only' | 'synthesize_only' | 'full' = body.briefStage || 'full';
    // R5 — measured OCR ground truth for a FAITHFUL screenshot reconstruction.
    const groundedReference: { pageWidth?: number; pageHeight?: number; elements?: any[] } | null =
      body.groundedReference && typeof body.groundedReference === 'object' && Array.isArray(body.groundedReference.elements)
        ? body.groundedReference
        : null;
    // Stage 1 — per-source-page measurements from a PDF's own content stream.
    // A document has more than one page; `groundedReference` names only the
    // first, and grounding page 1 while the model guesses pages 2..n is the same
    // gap one page down.
    const groundedPages: { pageNumber: number; reference: any; dropped?: number }[] =
      Array.isArray(body.groundedPages)
        ? body.groundedPages.filter((p: any) =>
            p && typeof p === 'object' && Array.isArray(p.reference?.elements) && p.reference.elements.length)
        : [];
    // What the caps excluded. A bound nobody is told about reads as full coverage.
    const groundingCoverage: { totalPages?: number; pagesOmitted?: number; elementsDropped?: number } =
      body.groundingCoverage && typeof body.groundingCoverage === 'object' ? body.groundingCoverage : {};

    // C9 — page-scoped AI visual repair. This mode may ONLY return patches from
    // the visual-diff-repair-patch-v1 allowlist, scoped to a single page; it must
    // NOT fall through to the generic op-based `apply_changes` flow (which emits a
    // different shape). Any candidate patches are sanitized server-side before
    // return — the client re-validates them again before applying. Never mutates
    // a template server-side.
    if (body.mode === 'layout_reconciliation_repair') {
      const pageId = typeof body.pageId === 'string' ? body.pageId : '';
      if (!pageId) return json({ error: 'layout_reconciliation_repair requires a pageId' }, 400);
      const maxOps = Math.min(Math.max(Number(body.maxOperations) || 20, 1), 40);
      // This mode is a SANITISER, not a generator: it validates patches the
      // caller already holds. It has never called a model, and the only client
      // that reaches it (`aiClient.repairPage`) sends `plan`/`diffReport` and no
      // `candidatePatches` — so every request ever made of it returned zero
      // patches AND zero rejections, which the review UI reported as "AI repair
      // produced no changes", indistinguishable from "the page was fine".
      //
      // Say so instead. A caller with nothing to sanitise is a caller that meant
      // to ask for something else — the judge lives in `visual_critique`.
      if (body.candidatePatches === undefined) {
        return json({
          patches: [],
          rejected: [{ index: -1, reason: 'no candidatePatches supplied — this mode validates patches, it does not generate them (see mode: visual_critique)' }],
          pageId,
          allowlistVersion: VISUAL_DIFF_REPAIR_ALLOWLIST_VERSION,
        });
      }
      const { patches, rejected } = sanitizeVisualDiffRepairPatches(body.candidatePatches, pageId, maxOps);
      return json({ patches, rejected, pageId, allowlistVersion: VISUAL_DIFF_REPAIR_ALLOWLIST_VERSION });
    }

    // ─── Stage 3 — look at the rendered page and say what is wrong with it ───
    //
    // The quality gate already renders every page and diffs it against the
    // source raster, and reports a NUMBER: the same document scored 0.507 on the
    // visual gate and 1.0 on CDIR fidelity, and 74% of pages come back "needing
    // review" with no statement of what is wrong with any of them.
    //
    // This mode returns FINDINGS, and only findings. It never proposes geometry
    // and never touches a template: a model is good at noticing and bad at
    // measuring, which is the same reason the PDF path is grounded rather than
    // eyeballed. Everything the model claims that geometry can settle is settled
    // by geometry, client-side, in `visualCritique.pure.ts`.
    if (body.mode === 'visual_critique') {
      const pageId = typeof body.pageId === 'string' ? body.pageId : '';
      if (!pageId) return json({ error: 'visual_critique requires a pageId' }, 400);
      if (!USE_CLAUDE) return json({ error: `Visual critique requires Claude, which this deployment cannot reach: ${anthropic.ok ? '' : anthropic.why}` }, 400);

      const sourceImage = validateVisionImageDataUrl(body.sourceImageDataUrl, MAX_VISION_IMAGE_BYTES);
      const renderedImage = validateVisionImageDataUrl(body.renderedImageDataUrl, MAX_VISION_IMAGE_BYTES);
      if (!sourceImage?.ok || !renderedImage?.ok) {
        // Refuse rather than critique one image. Asked to judge a reconstruction
        // with nothing to compare it against, a model reports what it dislikes
        // about a page rather than how it differs from the source — which is a
        // redesign brief wearing a defect report's clothes.
        return json({
          error: 'Visual critique needs BOTH the source page and the rendered page as base64 image data URLs (≤10 MB each).',
        }, 400);
      }

      const inventory = Array.isArray(body.elements) ? body.elements.slice(0, 200) : [];
      const pageWidth = Number(body.pageWidth) || 595;
      const pageHeight = Number(body.pageHeight) || 842;
      const inventoryText = inventory.length
        ? inventory.map((e: any) =>
            `[${String(e?.id ?? '')}] ${String(e?.type ?? '?')} x=${e?.x} y=${e?.y} w=${e?.width} h=${e?.height}`
            + `${e?.content ? ` :: ${JSON.stringify(String(e.content)).slice(0, 120)}` : ''}`,
          ).join('\n')
        : '(no element inventory supplied)';

      const critiqueSystem = `You are reviewing a PDF page that was automatically rebuilt as an editable template.

The FIRST image is the SOURCE page. The SECOND image is the RECONSTRUCTION.

Report only differences you can actually SEE between them, as findings. Rules:
- Judge the reconstruction against the source. Never against your own taste — a difference you would prefer is not a finding.
- Name the element from the ELEMENT INVENTORY whenever one applies. Never invent an id.
- Do NOT propose fixes, coordinates, sizes or colours. A separate measurement step decides those, and a number you estimate from a picture is worse than the one already measured.
- Do NOT report a difference you are unsure of. An unreported minor difference costs far less than a confident wrong one.
- If the two pages match, return an empty findings array. That is a valid and common answer.

The page is ${pageWidth}×${pageHeight}pt, top-left origin.

ELEMENT INVENTORY (ids you may reference):
${inventoryText}`;

      const critique = await callClaudeReconstruct({
        credential: anthropicCredential!,
        messages: [
          { role: 'system', content: critiqueSystem },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'SOURCE page:' },
              { type: 'image_url', image_url: { url: sourceImage.dataUrl } },
              { type: 'text', text: 'RECONSTRUCTION of the same page:' },
              { type: 'image_url', image_url: { url: renderedImage.dataUrl } },
              { type: 'text', text: 'Report the differences as findings.' },
            ],
          },
        ],
        tools: [{
          type: 'function',
          function: {
            name: CRITIQUE_TOOL_SCHEMA.name,
            description: CRITIQUE_TOOL_SCHEMA.description,
            parameters: CRITIQUE_TOOL_SCHEMA.input_schema,
          },
        }],
        // Forced: a critique that has to be parsed out of a paragraph silently
        // becomes zero findings the first time the wording changes.
        tool_choice: { type: 'function', function: { name: CRITIQUE_TOOL_SCHEMA.name } },
        max_tokens: 4096,
        timeoutMs: 120_000,
      });
      if (!critique.ok) {
        return json({ error: `Visual critique failed: ${critique.errorText ?? critique.status}` }, 502);
      }
      const call = critique.data?.choices?.[0]?.message?.tool_calls?.[0];
      let raw: unknown = null;
      try { raw = JSON.parse(call?.function?.arguments ?? '{}'); } catch { raw = null; }
      return json({
        findings: (raw as { findings?: unknown } | null)?.findings ?? [],
        pageId,
        modelUsed: critique.data?.model ?? null,
        critiqueVersion: VISUAL_CRITIQUE_VERSION,
      });
    }

    // Decide whether to run the Design Brief pipeline.
    // R5 split: the brief pipeline is the REDESIGN path (it reinterprets a
    // reference into a new layout). Faithful reconstruction ('screenshot_to_block')
    // must NOT route here — it would discard measured text/positions and let the
    // model re-invent copy. Only explicit 'brief'/'design'-with-image redesigns,
    // or a re-roll of a cached brief, use the brief pipeline.
    const useBriefPipeline =
      mode === 'brief' || incomingBrief !== null ||
      (!!imageDataUrl && mode === 'design');

    // Diagnostic logging for image/vision flow.
    const imgKb = imageDataUrl ? Math.round(imageDataUrl.length / 1024) : 0;
    const imgValid = !!imageDataUrl && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageDataUrl);
    console.log(`[design-agent] mode=${mode} pipeline=${useBriefPipeline ? 'brief' : 'ops'} stage=${briefStage} image=${imageDataUrl ? `${imgKb}KB valid=${imgValid}` : 'no'}`);

    if (!userInstruction?.trim() && !imageDataUrl && !incomingBrief && mode !== 'auto_fill') return json({ error: 'empty instruction' }, 400);
    if (useBriefPipeline && !activePageId) {
      return json({ error: 'Brief pipeline needs an active page — select a page first.' }, 400);
    }

    let designBrief: DesignBrief | null = incomingBrief;
    let briefSwaps: string[] = [];
    let briefPairings: { bg: string; text: string; ratio: number; swapped: boolean }[] = [];
    let briefTokenPatch: Record<string, string> = {};

    const clientPalette: string[] = Array.isArray(body.sourcePalette)
      ? body.sourcePalette.filter((c: unknown) => typeof c === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c)).slice(0, 12)
      : [];

    // Faithful screenshot reconstruction still runs a structured vision pass for
    // colour/layout semantics. The direct multimodal op call receives the image
    // too, but this brief makes palette roles explicit so the model does not
    // collapse references into black-and-white defaults.
    if (mode === 'screenshot_to_block' && imageDataUrl && !designBrief) {
      try {
        const visionResult = await withTimeout(analyzeReferenceImage(
          imageDataUrl,
          LOVABLE_API_KEY || '',
          `${userInstruction || 'Faithfully reconstruct this image.'}
Focus especially on exact palette roles (background, surface, text, accent, muted), section fills, borders, and any coloured text.`,
        ), 30_000, 'screenshot colour vision');
        if ('error' in visionResult) {
          console.warn('[design-agent] screenshot colour vision failed:', visionResult.error);
        } else {
          designBrief = visionResult.brief;
          const integrated = integrateBriefTokens(schema.tokens || {}, designBrief);
          briefTokenPatch = integrated.tokenPatch;
          briefSwaps = integrated.swaps;
          briefPairings = integrated.pairings;
          console.log(`[design-agent] screenshot vision palette=${designBrief.palette.map((p) => `${p.role}:${p.hex}`).join(',')} clientPalette=${clientPalette.join(',')}`);
        }
      } catch (error) {
        console.warn('[design-agent] screenshot colour vision skipped:', String((error as Error).message ?? error));
      }
    }

    // ─── Measured ground truth, shared by every faithful-reconstruction mode ──
    //
    // Both reconstruction modes are transcription tasks, and both are strictly
    // better when the model is handed measurements instead of asked to derive
    // them. This block was originally built inside `screenshot_to_block` only,
    // which left the PDF path — the path holding the BEST evidence in the system,
    // real glyph geometry rather than OCR — as the one asked to eyeball it.
    //
    // Server-side slice is a backstop against an oversized payload. The client
    // selects the elements that survive a cap (see
    // `pdfImport/groundedReferenceFromImport.pure.ts`); position-based truncation
    // here would drop the footer and say nothing about it.
    const MAX_GROUNDED_ELEMENTS = 160;
    const describeElementStyle = (e: any): string => {
      const parts: string[] = [];
      if (e.color) parts.push(`color=${e.color}`);
      if (e.fontFamily) parts.push(`font=${JSON.stringify(String(e.fontFamily))}`);
      if (e.fontWeight != null) parts.push(`weight=${e.fontWeight}`);
      if (e.italic) parts.push('italic');
      return parts.length ? ` ${parts.join(' ')}` : '';
    };
    const elementRows = (ref: any): string =>
      (ref.elements ?? []).slice(0, MAX_GROUNDED_ELEMENTS).map((e: any) =>
        `[${e.id}] x=${e.x} y=${e.y} w=${e.width} h=${e.height} size≈${e.fontSize}pt${describeElementStyle(e)} :: ${JSON.stringify(String(e.text ?? '')).slice(0, 240)}`,
      ).join('\n');
    const groundingBlock = groundedPages.length
      // Multi-page: one section per SOURCE page, each with its own page size, so
      // the model never has to infer which measurements belong where.
      ? `\n\nMEASURED TEXT ELEMENTS — read from this exact PDF's content stream. These are AUTHORITATIVE for text, position and size; each source page is listed separately with its own dimensions (points, top-left origin).${
          groundedPages.map((p) =>
            `\n\n— SOURCE PAGE ${p.pageNumber} (${p.reference.pageWidth ?? '?'}×${p.reference.pageHeight ?? '?'}pt)${
              p.dropped ? ` [${p.dropped} smaller element(s) not listed — read them off the document]` : ''
            }:\n${elementRows(p.reference)}`,
          ).join('')
        }${
          groundingCoverage.pagesOmitted
            ? `\n\n[Pages ${groundedPages.length + 1}–${groundingCoverage.totalPages} were not measured — reconstruct them by reading the document.]`
            : ''
        }`
      : groundedReference && groundedReference.elements!.length
        ? `\n\nMEASURED TEXT ELEMENTS — measured ground truth on a ${groundedReference.pageWidth ?? '?'}×${groundedReference.pageHeight ?? '?'}pt page (top-left origin). These are AUTHORITATIVE for text, position, and any style fields present:\n${elementRows(groundedReference)}`
        : '';

    // Mode-specific system addendum
    let modeAddendum = '';
    if (mode === 'art_director') {
      modeAddendum = `\n\n[ART DIRECTOR MODE]
You are doing a DECISIVE polish pass on the active page (id=${activePageId}).
Improve in place: refine typographic hierarchy, fix alignment to a 12pt grid, tighten spacing, ensure colour harmony via tokens, upgrade copywriting clarity. PREFER update_block / update_overlay on existing elements. Only add new elements if a genuine gap exists (e.g. missing section title, missing accent rule). Do NOT duplicate elements that already exist. Cap at ~15 ops. Do NOT ask the user — just execute.`;
    } else if (mode === 'screenshot_to_block') {
      // R5 — FAITHFUL reconstruction. This is a transcription/placement task, NOT
      // a redesign: text content + positions come from measurement, never invention.
      modeAddendum = `\n\n[SCREENSHOT-TO-BLOCK MODE — FAITHFUL RECONSTRUCTION]
Recreate the attached reference on the active page (id=${activePageId}) as native editable blocks/overlays. This is a FAITHFUL reconstruction, NOT a redesign.
- FIRST emit a 'clear_page' op for page ${activePageId} (the reference replaces existing blocks).
- TEXT IS GROUND TRUTH. ${groundingBlock ? 'Use the MEASURED TEXT ELEMENTS below as the source of truth: transcribe each element\'s text EXACTLY (fix only obvious OCR garbles) and place ONE text overlay at its given x/y/width/height.' : 'Transcribe text verbatim from the image and place it where it appears.'} Do NOT invent, summarise, rewrite, translate, or pad copy. Do NOT replace real text with "Lorem ipsum" or generic placeholders.
- You MAY classify each text element's role (heading / subhead / body / label / price) to choose a sensible fontWeight and size, but keep its position and exact words from the measurements/image.
- From the IMAGE, reproduce only NON-TEXT design: background and section fills, accent shapes/rules/dividers, and image regions — at their observed positions. Prefer tokens for colour, else hex.
- ICONS ARE FIRST-CLASS. When the source shows a small pictogram (location pin, calendar, building, phone, chart, checkmark…), place a matching icon overlay { type:'vector', icon:'<pack name>', color } at its observed position and colour — do NOT approximate icons with circles/rects, draw them as text glyphs, or silently drop them.
- COLOUR IS GROUND TRUTH. Do not default to black-and-white unless the source is actually monochrome. Use exact observed colours for page.background.color, text.color, shape.fill, shape.stroke, table/header fills, and border rules. If a colour is translucent, use rgba(...) or #RRGGBBAA. When a measured element carries a color= field, copy it onto that overlay verbatim.
- FONT IS GROUND TRUTH. Match each text element's typeface to the source: when a measured element carries a font= field, set fontFamily to that exact family; otherwise judge from the image (serif vs sans vs slab vs mono vs script) and pick the closest family from this list — Sans: Inter, Manrope, DM Sans, Work Sans, Lato, Open Sans, Roboto, Montserrat, Poppins, Helvetica, Arial. Serif: Playfair Display, Fraunces, Cormorant Garamond, Lora, Merriweather, EB Garamond, Georgia, Times New Roman. Slab: Roboto Slab, Zilla Slab, Arvo. Display: Bebas Neue, Abril Fatface, Cinzel, Syne. Mono: JetBrains Mono, IBM Plex Mono, Courier New. Script: Dancing Script, Great Vibes, Caveat. Never leave every overlay on the default Helvetica when the source clearly uses another style; carry weight= as the numeric fontWeight and italic as fontStyle:"italic".
${designBrief?.palette?.length ? `- STRUCTURED VISION PALETTE (authoritative): ${designBrief.palette.map((p) => `${p.role}=${p.hex}${p.label ? ` (${p.label})` : ''}`).join('; ')}. These are also installed server-side as token:brief.bg / token:brief.text / token:brief.accent when present; use those token references or the exact hex/rgba values directly when matching source elements.` : ''}
${clientPalette.length ? `- CLIENT-SAMPLED DOMINANT COLOURS: ${clientPalette.join(', ')}.` : ''}
- Canvas is the active page's actual size${groundedReference?.pageWidth ? ` (${groundedReference.pageWidth}×${groundedReference.pageHeight}pt)` : ''}. Aim for 1:1 visual parity. Ignore only genuinely illegible marks; never fabricate to fill space.${groundingBlock}`;
    } else if (mode === 'inline_text') {
      modeAddendum = `\n\n[INLINE TEXT MODE]
Modify ONLY the selected text overlay (overlay id=${selectedOverlayId}, block id=${selectedBlockId}, page id=${activePageId}). Emit exactly one update_overlay operation patching the "content" field. Do not change anything else. Preserve bindings ({{...}} tokens) unless the user explicitly asks to remove them.`;
    } else if (mode === 'auto_fill') {
      modeAddendum = `\n\n[AUTO-FILL MODE]
Walk the entire template. For every text overlay whose content is empty, a placeholder (Lorem ipsum / "Heading" / "Subtitle" / etc.), or an unresolvable binding, replace it with a concrete, well-written value drawn from SAMPLE DATA below.
- Prefer keeping a {{binding}} when sample data has the value at that path. Only inline a literal when the path is missing or the placeholder is clearly generic.
- For headings/eyebrows, write crisp 2–6 word lines. For body copy, 1–3 short sentences in the document's tone.
- Use update_overlay only. Do NOT add new blocks/pages. Cap at ~40 ops.
SAMPLE DATA (JSON):
${JSON.stringify(sampleData ?? {}, null, 2).slice(0, 4000)}`;
    }

    if (replaceMode && activePageId) {
      modeAddendum += `\n\n[REPLACE MODE — USER OPTED IN]
The designer has explicitly enabled "Replace page contents" for page ${activePageId}. Your FIRST op MUST be { "op": "clear_page", "pageId": "${activePageId}" }. Then build the requested layout from scratch on that page. Never add on top of existing blocks in this mode.`;
    }

    // ─── Brief pipeline orchestration ───────────────────────────────────────
    if (useBriefPipeline) {
      // Stage 1 — Vision Analysis (skipped on re-roll when brief is supplied)
      if (!designBrief && imageDataUrl) {
        const visionResult = await analyzeReferenceImage(imageDataUrl, LOVABLE_API_KEY!, userInstruction);
        if ('error' in visionResult) {
          console.error('[design-agent] brief vision failed:', visionResult.error);
          return json({ error: `Vision analysis failed: ${visionResult.error}` }, 500);
        }
        designBrief = visionResult.brief;
        console.log(`[design-agent] brief: palette=${designBrief.palette.length} sections=${designBrief.layout.sections.length} vibe=${designBrief.typography.vibe}`);
      }

      if (!designBrief) {
        return json({ error: 'Brief pipeline requires an image (first turn) or a cached brief (re-roll).' }, 400);
      }

      // Stage 2 — token integration + contrast guard
      const integrated = integrateBriefTokens(schema.tokens || {}, designBrief);
      briefTokenPatch = { ...briefTokenPatch, ...integrated.tokenPatch };
      briefSwaps = [...briefSwaps, ...integrated.swaps];
      briefPairings = integrated.pairings;
      console.log(`[design-agent] brief tokens=${Object.keys(briefTokenPatch).length} swaps=${briefSwaps.length}`);

      if (briefStage === 'analyze_only') {
        // Return the brief without any layout changes so the user can edit it.
        return json({
          reply: `Analysed the reference. Palette: ${designBrief.palette.map((p) => p.hex).join(' · ')}. Vibe: ${designBrief.typography.vibe}. ${designBrief.layout.sections.length} sections.`,
          schema: normaliseSchemaForClient(schema),
          operations: [],
          warnings: briefSwaps,
          brief: designBrief,
          briefSwaps,
          briefPairings,
          briefTokenPatch,
        });
      }

      // Stage 3 — synthesis: replace modeAddendum with brief-driven instructions
      const targetPage = schema.pages.find((p: any) => p.id === activePageId);
      const pageSize = targetPage?.size || { width: 595, height: 842 };
      modeAddendum = synthesisSystemAddendum(designBrief, activePageId!, pageSize, briefTokenPatch);
    }

    // Persistent memory facts about this template (brand voice, do/don'ts, etc.)
    const memoryBlock = memoryFacts.length
      ? `\n\nPERSISTENT MEMORY (apply to every turn):\n${memoryFacts.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}`
      : '';

    const context = `CURRENT TEMPLATE OUTLINE:
${outline(schema, activePageId)}

ACTIVE SELECTION:
  page=${activePageId ?? '-'} block=${selectedBlockId ?? '-'} overlay=${selectedOverlayId ?? '-'}${memoryBlock}`;

    // §7a — native PDF reconstruction: send the document straight to Claude.
    const usePdfDocument = mode === 'pdf_document' && !!pdfBase64;
    if (usePdfDocument && !USE_CLAUDE) {
      return json({ error: `PDF document reconstruction requires Claude, which this deployment cannot reach: ${anthropic.ok ? '' : anthropic.why}` }, 400);
    }
    if (usePdfDocument && activePageId) {
      // When the deterministic importer has already parsed this document, its
      // overlays are exact glyph geometry — better evidence than the model can
      // recover by reading the rendered page, and the reason this branch now
      // carries the same grounding block the screenshot path always had.
      const readInstruction = groundingBlock
        ? 'The MEASURED TEXT ELEMENTS below were read from this exact PDF\'s content stream and are AUTHORITATIVE for text, position and size: transcribe each element\'s text verbatim and place ONE text overlay at its given x/y/width/height. Never substitute your own reading of the page where a measurement exists — use the document itself for what the measurements do not cover (fills, rules, shapes, image regions, icons, typeface and weight). If the document plainly contains text that has no measurement, add it; do not drop it.'
        : 'Read the PDF directly: transcribe text EXACTLY at its real positions (page is PDF points, top-left origin).';
      // Measurements are per SOURCE page, so the multi-page contract has to be
      // stated: without it a many-page document collapses onto the active one.
      const pageInstruction = groundedPages.length > 1
        ? `The source has ${groundingCoverage.totalPages ?? groundedPages.length} pages. Reconstruct SOURCE PAGE 1 on the active page (id=${activePageId}), then emit one 'add_page' per further source page and reconstruct it there, in order. Every overlay's coordinates are relative to its own page.`
        : `Reconstruct it on the active page (id=${activePageId}) as native editable blocks.`;
      modeAddendum += `\n\n[PDF DOCUMENT MODE — FAITHFUL RECONSTRUCTION]
A PDF is attached. ${pageInstruction} FIRST emit a 'clear_page' for ${activePageId}. ${readInstruction} Reproduce non-text design (background/section fills, accent shapes/rules, image regions). Preserve observed colours for page backgrounds, text, fills, strokes, borders, and accents; use rgba(...) or #RRGGBBAA for translucency. Reproduce source pictograms as icon-pack vector overlays ({ type:'vector', icon:'<name>', color }) rather than dropping them. Match each text run's typeface: read the PDF's font names/styles and set fontFamily to the same family (or the closest of: Inter, Lato, Open Sans, Roboto, Montserrat, Helvetica, Playfair Display, Lora, Merriweather, EB Garamond, Georgia, Times New Roman, Roboto Slab, JetBrains Mono, Courier New), with the numeric fontWeight and italic style it uses. Do NOT redesign, summarise, translate, or use placeholders.${groundingBlock}`;
    }

    // Brief pipeline runs synthesis on text-only context (image already digested
    // into the brief). Other image-attached flows keep multimodal.
    const useVision = !!imageDataUrl && !useBriefPipeline;

    const messages: any[] = [
      { role: 'system', content: SYSTEM + modeAddendum },
      { role: 'system', content: context },
      ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    ];

    // Build final user turn — multimodal when image attached
    if (useVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userInstruction || 'Recreate this design as native template blocks on the active page.' },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      });
    } else {
      const finalText = userInstruction || (
        useBriefPipeline ? 'Synthesise the page from the BRIEF-DRIVEN SYNTHESIS instructions above.' :
        mode === 'auto_fill' ? 'Auto-fill every empty/placeholder text overlay with concrete values from the sample data above.' :
        ''
      );
      if (finalText && messages[messages.length - 1]?.content !== finalText) {
        messages.push({ role: 'user', content: finalText });
      }
    }

    const callGateway = async (toolChoice: any, modelOverride?: string) => {
      // Route through Claude for brief-synthesis & vision flows when
      // this deployment can reach Anthropic. Other modes still use the Lovable AI Gateway.
      const preferClaude = USE_CLAUDE && (useBriefPipeline || useVision || usePdfDocument);
      if (preferClaude) {
        // Faithful reconstructions emit one op per measured element — a dense page
        // produces a large op list. 8K output tokens truncated the tool-call JSON
        // mid-stream (malformed args / silently dropped overlays), so give the
        // reconstruction modes real headroom.
        const reconstructing = usePdfDocument || mode === 'screenshot_to_block';
        const r = await callClaudeReconstruct({
          credential: anthropicCredential!,
          model: CLAUDE_MODEL,
          messages: messages as any,
          tools: [TOOL as any],
          tool_choice: toolChoice,
          max_tokens: reconstructing ? 32768 : 8192,
          documents: usePdfDocument ? [{ base64: pdfBase64!, mediaType: 'application/pdf' }] : undefined,
        });
        if (r.ok) {
          return new Response(JSON.stringify(r.data), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (!LOVABLE_API_KEY) {
          return new Response(r.errorText || 'anthropic error', { status: r.status });
        }
        console.warn('[design-agent] Claude failed; falling back to Lovable gateway', r.status, String(r.errorText || '').slice(0, 240));
      }
      if (!LOVABLE_API_KEY) {
        return new Response('LOVABLE_API_KEY missing and Claude route is unavailable for this request', { status: 500 });
      }
      const resp = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelOverride ?? (useBriefPipeline ? SYNTHESIS_MODEL : (useVision ? VISION_MODEL : DEFAULT_MODEL)),
          messages,
          tools: [TOOL],
          tool_choice: toolChoice,
        }),
      });
      return resp;
    };


    // Vision multimodal: 'required'. Brief synthesis + text: explicit function choice.
    let aiResp = await callGateway(
      (useVision || usePdfDocument) ? 'required' : { type: 'function', function: { name: 'apply_changes' } },
    );

    if (!aiResp.ok) {
      const text = await aiResp.text();
      if (aiResp.status === 429) return json({ error: 'Rate limited — try again shortly.' }, 429);
      if (aiResp.status === 402) return json({ error: 'AI credits exhausted. Add credits in Workspace settings.' }, 402);
      console.error('design agent gateway error', aiResp.status, text);
      return json({ error: `AI gateway error (${aiResp.status})` }, 500);
    }
    let aiData = await aiResp.json();
    let toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];

    // Vision retry: if the model replied with text only, retry once with an
    // explicit nudge to call apply_changes.
    if (!toolCall && (useVision || usePdfDocument)) {
      console.warn('[design-agent] vision pass returned no tool_call — retrying with explicit nudge');
      messages.push({
        role: 'user',
        content: 'You MUST respond by calling the apply_changes function with the operations needed to recreate the attached image. Do not reply with prose.',
      });
      aiResp = await callGateway('required');
      if (aiResp.ok) {
        aiData = await aiResp.json();
        toolCall = aiData?.choices?.[0]?.message?.tool_calls?.[0];
      } else {
        console.error('[design-agent] vision retry failed', aiResp.status, await aiResp.text());
      }
    }

    if (!toolCall) {
      const reply = aiData?.choices?.[0]?.message?.content ?? 'No changes proposed.';
      console.warn('[design-agent] no tool_call after retry, reply=', String(reply).slice(0, 200));
      return json({
        reply,
        schema,
        operations: [],
        warnings: [useVision
          ? 'Vision model returned text instead of operations. Try a clearer screenshot or a shorter prompt.'
          : 'Model did not call apply_changes.'],
      });
    }
    let parsed: { reply: string; operations: Op[] };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      return json({ ...internalError(e, 'template-design-agent'), error: 'AI returned malformed tool arguments' }, 500);
    }

    // Log only structural metadata: replies and operation payloads can contain
    // client or financial data copied from templates and auto-fill sample data.
    console.log(`[design-agent] tool_call ops=${(parsed.operations || []).length}`);

    // ─── Brief-pipeline content validator + auto-retry ──────────────────────
    // The synthesis pass occasionally returns shape-only layouts. Detect and re-prompt.
    if (useBriefPipeline) {
      const v = validateBriefSynthesis(parsed.operations || []);
      console.log(`[design-agent] brief validate: ok=${v.ok} reason=${v.reason || '-'} stats=${JSON.stringify(v.stats)}`);
      if (!v.ok) {
        messages.push({
          role: 'assistant',
          content: `(rejected — ${v.reason}; only ${v.stats.textOverlays} text overlays, ${v.stats.shapeOverlays} shapes)`,
        });
        messages.push({
          role: 'user',
          content: `Your previous attempt FAILED the content quota: ${v.reason}. RE-EMIT apply_changes with: (a) clear_page first, (b) set_token + update_page background, (c) AT LEAST 4 text overlays (eyebrow + headline + deck + body/caption) with real copy, (d) any decorative shape larger than 120pt MUST have a text overlay over it. Invent plausible report copy if the brief is thin. Do NOT just place shapes.`,
        });
        const retry = await callGateway({ type: 'function', function: { name: 'apply_changes' } });
        if (retry.ok) {
          const retryData = await retry.json();
          const retryCall = retryData?.choices?.[0]?.message?.tool_calls?.[0];
          if (retryCall) {
            try {
              const retryParsed = JSON.parse(retryCall.function.arguments);
              const v2 = validateBriefSynthesis(retryParsed.operations || []);
              console.log(`[design-agent] brief retry validate: ok=${v2.ok} text=${v2.stats.textOverlays}`);
              if (v2.stats.textOverlays > (v.stats.textOverlays || 0)) {
                parsed = retryParsed;
              }
            } catch (e) {
              console.warn('[design-agent] retry parse failed', e);
            }
          }
        }
      }
    }

    const { schema: appliedSchema, summaries, warnings } = applyOps(schema, parsed.operations || []);
    if (Object.keys(briefTokenPatch).length) {
      appliedSchema.tokens = appliedSchema.tokens || { colors: {}, fonts: {}, spacing: {} };
      appliedSchema.tokens.colors = { ...(appliedSchema.tokens.colors || {}), ...briefTokenPatch };
      summaries.push(`installed ${Object.keys(briefTokenPatch).length} reference colour token(s)`);
    }
    console.log(`[design-agent] applied summaries=${summaries.length} warnings=${warnings.length} ${warnings.length ? JSON.stringify(warnings).slice(0,300) : ''}`);

    // Post-op cleanup: grid snap + canvas clamp + dedupe identical text overlays.
    // Only clamp pages we actually touched to avoid disturbing untouched layouts.
    // FAITHFUL reconstruction modes get NO grid snap: positions are measured from
    // the source (OCR/PDF/DOM) and snapping them drifts the layout by up to 3pt.
    const faithfulMode = mode === 'screenshot_to_block' || mode === 'pdf_document';
    const touchedPages = new Set<string>();
    for (const op of parsed.operations || []) {
      if (op.pageId) touchedPages.add(String(op.pageId));
    }
    const { schema: cleanedSchema, fixes } = cleanupSchema(appliedSchema, {
      grid: faithfulMode ? 0 : 6,
      clampPages: touchedPages.size ? touchedPages : undefined,
    });

    return json({
      reply: parsed.reply || '',
      schema: normaliseSchemaForClient(cleanedSchema),
      operations: summaries,
      warnings: [...warnings, ...fixes, ...briefSwaps],
      raw_ops: parsed.operations,
      brief: designBrief,
      briefSwaps,
      briefPairings,
      briefTokenPatch,
      pipeline: useBriefPipeline ? 'brief' : 'ops',
      modelUsed: aiData?.model ?? null,
    });
  } catch (e) {
    console.error('template-design-agent error', e);
    return json({ ...internalError(e, 'template-design-agent') }, 500);
  }
});
