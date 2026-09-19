/**
 * Binding fixer — suggests and applies replacements for broken bindings.
 *
 * Given the live `TemplateIssue[]` from `collectTemplateIssues`, this module
 * fuzzy-matches each unknown {{path}}, `token:key`, or filter against the
 * actually-resolvable values (sample data + brand tokens + known filters)
 * and produces a list of `BindingFix` candidates the user can accept.
 *
 * The applier mutates a single field on a single block/overlay/page so we can
 * apply per-issue or in bulk.
 */
import type { ReportTemplate, Block, Overlay, Page } from './templateSchema';
import { KNOWN_FILTERS } from './bindingValidation';
import type { TemplateIssue } from './bindingValidation';
import { flattenPaths } from './sampleDataPresets';

export type FixKind = 'path' | 'token' | 'filter';

export interface FixSuggestion {
  /** what replaces the broken token (e.g. "property.address") */
  replacement: string;
  /** human-readable label (often same as replacement) */
  label: string;
  /** preview value from sample data, when available */
  preview?: string;
  /** 0..1 — higher = better match */
  score: number;
}

export interface BindingFix {
  issue: TemplateIssue;
  kind: FixKind;
  /** the broken slug e.g. "propery.address" or "currnecy" or "primry" */
  broken: string;
  suggestions: FixSuggestion[];
}

// ─── Fuzzy scoring ───────────────────────────────────────────────────────────
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i);
  let v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0[0], v1[0]] = [v1[0], v0[0]];
    for (let k = 0; k <= b.length; k++) v0[k] = v1[k];
  }
  return v0[b.length];
}

function similarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  if (lb.includes(la) || la.includes(lb)) return 0.85;
  const distance = lev(la, lb);
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 0;
  return 1 - distance / maxLen;
}

function rank<T extends { value: string }>(needle: string, candidates: T[], topN = 5): Array<T & { score: number }> {
  return candidates
    .map((c) => ({ ...c, score: similarity(needle, c.value) }))
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ─── Issue parsing ───────────────────────────────────────────────────────────
const PATH_RE = /Unknown path\s+\"([^\"]+)\"/;
const FILTER_RE = /Unknown filter\s+\"([^\"]+)\"/;
const TOKEN_RE = /Unknown token\s+\"([^\"]+)\"/;

function parseIssue(issue: TemplateIssue): { kind: FixKind; broken: string } | null {
  const t = issue.message;
  const p = PATH_RE.exec(t);
  if (p) return { kind: 'path', broken: p[1] };
  const f = FILTER_RE.exec(t);
  if (f) return { kind: 'filter', broken: f[1] };
  const tk = TOKEN_RE.exec(t);
  if (tk) return { kind: 'token', broken: tk[1] };
  return null;
}

// ─── Public API: build fixes ─────────────────────────────────────────────────
export function buildFixes(
  issues: TemplateIssue[],
  template: ReportTemplate,
  sampleData: Record<string, any>,
): BindingFix[] {
  const paths = flattenPaths(sampleData).map((p) => ({ value: p.path, preview: p.preview }));
  const tokenKeys = [
    ...Object.keys(template.tokens?.colors ?? {}),
    ...Object.keys(template.tokens?.fonts ?? {}),
    ...Object.keys(template.tokens?.spacing ?? {}),
  ].map((k) => ({ value: k }));

  const out: BindingFix[] = [];
  for (const iss of issues) {
    const parsed = parseIssue(iss);
    if (!parsed) continue;
    const { kind, broken } = parsed;
    let suggestions: FixSuggestion[] = [];
    if (kind === 'path') {
      suggestions = rank(broken, paths).map((c) => ({
        replacement: c.value,
        label: c.value,
        preview: c.preview,
        score: c.score,
      }));
    } else if (kind === 'token') {
      suggestions = rank(broken, tokenKeys).map((c) => ({
        replacement: c.value,
        label: `token:${c.value}`,
        score: c.score,
      }));
    } else if (kind === 'filter') {
      suggestions = rank(broken, KNOWN_FILTERS.map((f) => ({ value: f }))).map((c) => ({
        replacement: c.value,
        label: `| ${c.value}`,
        score: c.score,
      }));
    }
    out.push({ issue: iss, kind, broken, suggestions });
  }
  return out;
}

// ─── Apply a fix to the template ─────────────────────────────────────────────
function replaceInString(
  input: string,
  kind: FixKind,
  broken: string,
  replacement: string,
): string {
  if (input == null) return input;
  if (kind === 'path') {
    // replace inside {{ broken | …filters }} — keep filters intact
    return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, expr: string) => {
      const [pathPart, ...rest] = expr.split('|').map((p: string) => p.trim());
      if (pathPart !== broken) return full;
      return rest.length ? `{{${replacement} | ${rest.join(' | ')}}}` : `{{${replacement}}}`;
    });
  }
  if (kind === 'filter') {
    return input.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, expr: string) => {
      const parts = expr.split('|').map((p: string) => p.trim());
      const [pathPart, ...rest] = parts;
      const next = rest.map((f: string) => {
        const [name, ...args] = f.split(':').map((p) => p.trim());
        if (name !== broken) return f;
        return args.length ? `${replacement}:${args.join(':')}` : replacement;
      });
      return next.length ? `{{${pathPart} | ${next.join(' | ')}}}` : `{{${pathPart}}}`;
    });
  }
  if (kind === 'token') {
    if (input === `token:${broken}`) return `token:${replacement}`;
    return input;
  }
  return input;
}

function applyToBlock(block: Block, fix: BindingFix, replacement: string): Block {
  const next: Block = { ...block, props: { ...block.props } };
  if (fix.issue.field) {
    const cur = (next.props as any)[fix.issue.field];
    if (typeof cur === 'string') (next.props as any)[fix.issue.field] = replaceInString(cur, fix.kind, fix.broken, replacement);
  } else {
    // fall back: walk all string props
    for (const [k, v] of Object.entries(next.props)) {
      if (typeof v === 'string') (next.props as any)[k] = replaceInString(v, fix.kind, fix.broken, replacement);
    }
  }
  return next;
}

function applyToOverlay(o: Overlay, fix: BindingFix, replacement: string): Overlay {
  const field = fix.issue.field as keyof Overlay | undefined;
  if (!field) return o;
  const cur = (o as any)[field];
  if (typeof cur !== 'string') return o;
  return { ...o, [field]: replaceInString(cur, fix.kind, fix.broken, replacement) } as Overlay;
}

export function applyFix(
  template: ReportTemplate,
  fix: BindingFix,
  replacement: string,
): ReportTemplate {
  return {
    ...template,
    pages: template.pages.map((page): Page => {
      if (fix.issue.pageId && page.id !== fix.issue.pageId) return page;
      // Background fields
      if (!fix.issue.blockId && !fix.issue.overlayId && fix.issue.field?.startsWith('background.')) {
        const sub = fix.issue.field.slice('background.'.length);
        const cur = (page.background as any)?.[sub];
        if (typeof cur === 'string') {
          return {
            ...page,
            background: { ...page.background, [sub]: replaceInString(cur, fix.kind, fix.broken, replacement) },
          };
        }
      }
      return {
        ...page,
        blocks: page.blocks.map((b) => {
          if (fix.issue.blockId && b.id !== fix.issue.blockId) return b;
          if (fix.issue.overlayId) {
            return {
              ...b,
              overlays: b.overlays.map((o) => (o.id === fix.issue.overlayId ? applyToOverlay(o, fix, replacement) : o)),
            };
          }
          return applyToBlock(b, fix, replacement);
        }),
      };
    }),
  };
}

/** Apply each fix's top suggestion (if score >= threshold). Returns new template + count applied. */
export function applyAllAutoFixes(
  template: ReportTemplate,
  fixes: BindingFix[],
  threshold = 0.6,
): { template: ReportTemplate; applied: number; skipped: number } {
  let next = template;
  let applied = 0;
  let skipped = 0;
  for (const fix of fixes) {
    const top = fix.suggestions[0];
    if (top && top.score >= threshold) {
      next = applyFix(next, fix, top.replacement);
      applied += 1;
    } else {
      skipped += 1;
    }
  }
  return { template: next, applied, skipped };
}
