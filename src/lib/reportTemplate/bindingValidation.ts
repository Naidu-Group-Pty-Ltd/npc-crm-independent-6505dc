/**
 * Binding token autocomplete + validation.
 *
 * Centralises the list of known data paths, brand tokens and filters that the
 * editor (PropertiesInspector) suggests and validates against. Keeping this in
 * one place ensures the chip suggestions, the autocomplete popover and the
 * pre-export validator never drift apart.
 */
import type { ReportTemplate } from './templateSchema';

/** Top-level data paths exposed by the live preview / runtime. */
export const KNOWN_DATA_PATHS: string[] = [
  'property.address',
  'property.suburb',
  'property.imageUrl',
  'financials.weeklyRent',
  'financials.purchasePrice',
  'financials.deposit',
  'client.name',
  'client.email',
  'tier',
  'reportType',
  'pageNumber',
  'pageCount',
];

import { FILTER_NAMES } from './bindingResolver';
/** Filters supported by the binding resolver. Kept in sync with bindingResolver.ts. */
export const KNOWN_FILTERS = FILTER_NAMES;



export interface BindingIssue {
  raw: string;        // e.g. "{{property.adres | currency}}"
  start: number;
  end: number;
  message: string;
}

const BINDING_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Build the full suggestion list, including brand-token references. */
export function buildSuggestions(template?: ReportTemplate | null): Array<{
  insert: string;
  label: string;
  group: 'Data' | 'Tokens' | 'Filters';
  detail?: string;
}> {
  const out: Array<{ insert: string; label: string; group: 'Data' | 'Tokens' | 'Filters'; detail?: string }> = [];

  for (const p of KNOWN_DATA_PATHS) {
    out.push({ insert: `{{${p}}}`, label: `{{${p}}}`, group: 'Data' });
  }
  for (const f of KNOWN_FILTERS) {
    out.push({ insert: `| ${f}`, label: `| ${f}`, group: 'Filters', detail: `apply ${f} filter` });
  }
  const tokenColors = Object.keys(template?.tokens?.colors ?? {});
  const tokenFonts = Object.keys(template?.tokens?.fonts ?? {});
  for (const k of tokenColors) out.push({ insert: `token:${k}`, label: `token:${k}`, group: 'Tokens', detail: 'colour' });
  for (const k of tokenFonts) out.push({ insert: `token:${k}`, label: `token:${k}`, group: 'Tokens', detail: 'font' });

  return out;
}

/** Check that a bindable path is recognised. Suffix matches handled (e.g. 'property.address.line1'). */
function isKnownPath(path: string): boolean {
  if (!path) return false;
  return KNOWN_DATA_PATHS.some((p) => path === p || path.startsWith(`${p}.`));
}

/**
 * Validate every `{{...}}` expression inside a string. Also accepts
 * `token:xxx` literals (no curly braces required).
 *
 * Returns an empty array when valid.
 */
export function validateBindable(input: unknown, template?: ReportTemplate | null): BindingIssue[] {
  if (input == null) return [];
  const s = String(input);
  const issues: BindingIssue[] = [];

  // Validate token: literals (no braces)
  if (s.startsWith('token:')) {
    const key = s.slice(6);
    const knownTokens = new Set([
      ...Object.keys(template?.tokens?.colors ?? {}),
      ...Object.keys(template?.tokens?.fonts ?? {}),
      ...Object.keys(template?.tokens?.spacing ?? {}),
    ]);
    if (!knownTokens.has(key)) {
      issues.push({ raw: s, start: 0, end: s.length, message: `Unknown token "${key}"` });
    }
  }

  let m: RegExpExecArray | null;
  BINDING_RE.lastIndex = 0;
  while ((m = BINDING_RE.exec(s)) !== null) {
    const raw = m[0];
    const expr = m[1].trim();
    const start = m.index;
    const end = start + raw.length;

    if (!expr) {
      issues.push({ raw, start, end, message: 'Empty binding' });
      continue;
    }
    const [pathPart, ...filterParts] = expr.split('|').map((p) => p.trim());

    // Skip path validation for inline expressions (=) and computed refs (@)
    const isExpr = pathPart.startsWith('=') || pathPart.startsWith('@');
    if (!isExpr && !isKnownPath(pathPart)) {
      issues.push({ raw, start, end, message: `Unknown path "${pathPart}"` });
    }
    for (const f of filterParts) {
      const [name] = f.split(':').map((p) => p.trim());
      if (!FILTER_NAMES.includes(name)) {
        issues.push({ raw, start, end, message: `Unknown filter "${name}"` });
      }
    }
  }


  // Detect orphan braces (`{{ ... ` without closing) — naive check
  const openCount = (s.match(/\{\{/g) || []).length;
  const closeCount = (s.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    issues.push({ raw: s, start: 0, end: s.length, message: 'Unbalanced {{ }} braces' });
  }

  return issues;
}

export interface TemplateIssue extends BindingIssue {
  where: string;
  pageId?: string;
  pageIndex?: number;
  blockId?: string;
  overlayId?: string;
  field?: string;
}

/** Walk the whole template and collect every binding issue (used pre-export). */
export function collectTemplateIssues(template: ReportTemplate): TemplateIssue[] {
  const all: TemplateIssue[] = [];
  const push = (where: string, value: unknown, ctx: Partial<TemplateIssue> = {}) => {
    for (const i of validateBindable(value, template)) all.push({ ...i, where, ...ctx });
  };
  template.pages.forEach((page, pi) => {
    const pageCtx = { pageId: page.id, pageIndex: pi };
    push(`Page ${pi + 1} background`, page.background?.color, { ...pageCtx, field: 'background.color' });
    push(`Page ${pi + 1} background image`, page.background?.imageUrl, { ...pageCtx, field: 'background.imageUrl' });
    page.blocks.forEach((b, bi) => {
      b.overlays.forEach((o, oi) => {
        const tag = `Page ${pi + 1} → block ${bi + 1} → overlay ${oi + 1}`;
        const oCtx = { ...pageCtx, blockId: b.id, overlayId: o.id };
        if (o.type === 'text') {
          push(`${tag} (content)`, o.content, { ...oCtx, field: 'content' });
          push(`${tag} (color)`, o.color, { ...oCtx, field: 'color' });
          push(`${tag} (font)`, o.fontFamily, { ...oCtx, field: 'fontFamily' });
        } else if (o.type === 'image') {
          push(`${tag} (src)`, o.src, { ...oCtx, field: 'src' });
        } else if (o.type === 'shape') {
          push(`${tag} (fill)`, o.fill, { ...oCtx, field: 'fill' });
          push(`${tag} (stroke)`, o.stroke, { ...oCtx, field: 'stroke' });
        }
      });
    });
  });
  return all;
}
