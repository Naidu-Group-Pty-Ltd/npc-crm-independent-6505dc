/**
 * Binding & token resolution for report templates.
 *
 * Supports:
 *   "literal value"                          → returned as-is
 *   "token:primary"                          → tokens.colors.primary or tokens.fonts.primary etc.
 *   "{{property.address}}"                   → data.property.address
 *   "{{financials.weeklyRent | currency}}"   → with filter
 *   "{{=netYield}}"                          → computed field (tokens.computed[name])
 *   "{{= price * 0.052 | currency}}"         → inline expression
 *   "Hello {{name}}, you owe {{amt | currency}}"
 *
 * Conditional expressions (`block.conditional`, `page.conditional`) are
 * evaluated via a tiny safe-ish expression evaluator: only a small allow-list
 * of operators is supported. NEVER pass user input to this function unsanitised.
 */
import type { Tokens, ComputedField } from './templateSchema';
import { expressionComputesOverData } from '../../../supabase/functions/_shared/templateLibraryCore.pure';
import { presenceOf } from '../../../supabase/functions/_shared/reports/contract/visibilityPolicy.pure';

export interface ResolveContext {
  data: Record<string, any>;
  tokens: Tokens;
}

// ─── Filters ──────────────────────────────────────────────────────────────────
type Filter = (value: any, ...args: string[]) => any;

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const precision = (value: string | undefined, fallback: number, maximum: number): number => {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : fallback;
};

// ─── Dates ────────────────────────────────────────────────────────────────────
/*
 * One implementation, shared with every flowing render route.
 *
 * `reportDate.pure.ts` is the single reader; this file used to be the twelfth
 * copy of it. Its header carries the three reasons an ISO string is read field
 * by field and never handed to `Date` — the third being that
 * `new Date('2016-02-14')` is midnight UTC, so a client's move-in date printed
 * a day early on every render west of UTC.
 *
 * The two engines still SPELL a date differently on purpose: the flowing routes
 * print `16 August 2026` and the masters are typeset around `16 Aug 2026`. That
 * is now the `style` argument rather than two implementations free to drift.
 *
 * Re-exported because `bindingResolver` is where the template side imports its
 * binding vocabulary from, and a block reaching across the tree for a date
 * helper is how a thirteenth copy starts.
 */
export {
  formatIsoDate,
  isIsoDateValue,
  type ReportDateStyle,
} from '../../../supabase/functions/_shared/reports/reportDate.pure.ts';

import {
  formatIsoDate,
  isIsoDateValue,
  type ReportDateStyle,
} from '../../../supabase/functions/_shared/reports/reportDate.pure.ts';

/** The `| date` filter's argument, mapped onto the shared styles. */
function dateStyle(fmt: string | undefined): ReportDateStyle {
  if (fmt === 'iso' || fmt === 'long') return fmt;
  // `short` has always meant `16/08/2026` to this filter, which the shared
  // module calls `numeric`; its own `short` is the `16 Aug 2026` default.
  if (fmt === 'short') return 'numeric';
  return 'short';
}

export const FILTERS: Record<string, Filter> = {
  /**
   * Two-digit zero padding — `{{partNumber | pad2}}` → "07". For the running
   * furniture that numbers a document's parts at render time, where the count
   * must be over the pages that actually rendered: a part number baked at
   * compose time keeps counting pages a conditional later drops, and a real
   * comparison shipped with its parts jumping 12 → 19.
   */
  pad2: (v) => String(v ?? '').padStart(2, '0'),
  // Money / numeric formatting
  currency: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: precision(decimals, 0, 20) }).format(n);
  },
  number: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return new Intl.NumberFormat('en-AU', { maximumFractionDigits: precision(decimals, 0, 20) }).format(n);
  },
  percent: (v, decimals) => {
    const n = num(v);
    if (Number.isNaN(n)) return String(v ?? '');
    return `${n.toFixed(precision(decimals, 2, 100))}%`;
  },
  fixed: (v, decimals) => {
    const n = num(v); return Number.isNaN(n) ? String(v ?? '') : n.toFixed(precision(decimals, 2, 100));
  },
  round: (v) => { const n = num(v); return Number.isNaN(n) ? v : Math.round(n); },
  abs: (v) => { const n = num(v); return Number.isNaN(n) ? v : Math.abs(n); },

  // Arithmetic (chainable)
  add: (v, x) => num(v) + num(x),
  sub: (v, x) => num(v) - num(x),
  mul: (v, x) => num(v) * num(x),
  div: (v, x) => { const d = num(x); return d === 0 ? 0 : num(v) / d; },
  mod: (v, x) => { const d = num(x); return d === 0 ? 0 : num(v) % d; },
  min: (v, x) => Math.min(num(v), num(x)),
  max: (v, x) => Math.max(num(v), num(x)),

  // Dates
  date: (v, fmt) => {
    if (!v) return '';
    // An ISO string is read field by field rather than parsed — see
    // `formatIsoDate`. Anything else (a `Date`, "March 3 2026") still goes
    // through the platform parser, which is the only thing that understands it.
    const iso = typeof v === 'string' ? formatIsoDate(v, dateStyle(fmt)) : null;
    if (iso !== null) return iso;
    const d = new Date(v as any);
    if (Number.isNaN(d.getTime())) return String(v);
    if (fmt === 'iso') return d.toISOString().slice(0, 10);
    if (fmt === 'short') return d.toLocaleDateString('en-AU');
    if (fmt === 'long') return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  },
  dateRel: (v) => {
    if (!v) return '';
    const d = new Date(v as any);
    if (Number.isNaN(d.getTime())) return String(v);
    const diff = (Date.now() - d.getTime()) / 1000;
    const abs = Math.abs(diff);
    const sign = diff >= 0 ? 'ago' : 'from now';
    if (abs < 60) return `just now`;
    if (abs < 3600) return `${Math.round(abs / 60)}m ${sign}`;
    if (abs < 86400) return `${Math.round(abs / 3600)}h ${sign}`;
    if (abs < 2592000) return `${Math.round(abs / 86400)}d ${sign}`;
    return `${Math.round(abs / 2592000)}mo ${sign}`;
  },

  // Strings
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  capitalize: (v) => { const s = String(v ?? ''); return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; },
  title: (v) => String(v ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
  trim: (v) => String(v ?? '').trim(),
  truncate: (v, len, suffix) => {
    const s = String(v ?? ''); const n = Number(len ?? 80);
    return s.length > n ? s.slice(0, n) + (suffix ?? '…') : s;
  },
  replace: (v, find, repl) => String(v ?? '').split(String(find ?? '')).join(String(repl ?? '')),
  slice: (v, start, end) => String(v ?? '').slice(Number(start ?? 0), end != null ? Number(end) : undefined),
  pluralize: (v, singular, plural) => {
    const n = num(v); const s = singular ?? ''; const p = plural ?? `${s}s`;
    return `${n} ${n === 1 ? s : p}`;
  },
  join: (v, sep) => Array.isArray(v) ? v.join(sep ?? ', ') : String(v ?? ''),
  first: (v) => Array.isArray(v) ? v[0] : v,
  last: (v) => Array.isArray(v) ? v[v.length - 1] : v,
  count: (v) => Array.isArray(v) ? v.length : (v == null ? 0 : 1),
  sum: (v, path) => {
    if (!Array.isArray(v)) return num(v) || 0;
    return v.reduce((acc, item) => acc + num(path ? getByPath(item, path) : item) || 0, 0);
  },
  avg: (v, path) => {
    if (!Array.isArray(v) || v.length === 0) return 0;
    const total = v.reduce((acc, item) => acc + (num(path ? getByPath(item, path) : item) || 0), 0);
    return total / v.length;
  },

  // Conditional / fallback
  default: (v, fallback) => (v === null || v === undefined || v === '' ? (fallback ?? '') : v),
  fallback: (v, fallback) => (v === null || v === undefined || v === '' ? (fallback ?? '') : v),
  if: (v, truthy, falsy) => (v ? (truthy ?? '') : (falsy ?? '')),
  eq: (v, x) => String(v) === String(x),
  neq: (v, x) => String(v) !== String(x),
  gt: (v, x) => num(v) > num(x),
  lt: (v, x) => num(v) < num(x),
  gte: (v, x) => num(v) >= num(x),
  lte: (v, x) => num(v) <= num(x),

  // Encoding
  json: (v) => { try { return JSON.stringify(v); } catch { return String(v ?? ''); } },
  urlencode: (v) => encodeURIComponent(String(v ?? '')),
};

// ─── Path access ──────────────────────────────────────────────────────────────
// Supports dotted paths, with array index syntax: "properties[0].price" or "properties.0.price"
function getByPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key.trim()]), obj);
}

// ─── Computed field evaluation ────────────────────────────────────────────────
const SAFE_EXPR_RE = /^[\s\w.@$'"=!<>&|()+\-*/%?:,\[\]]*$/;

/**
 * Names that cannot be function parameters, so they cannot be bound and are
 * left for the expression to fail on naturally.
 */
const RESERVED = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'eval', 'export',
  'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
  'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'tokens', '$',
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The data keys an expression may reference by bare name.
 *
 * These become the evaluated function's parameters, which is what `with (data)`
 * used to provide. `with` cannot appear in strict-mode code, so the previous
 * form threw at construction and every expression fell into its catch — a
 * silent empty string for computed fields, a silent `false` for conditionals.
 */
function dataParameterNames(ctx: ResolveContext): string[] {
  return Object.keys(ctx.data ?? {}).filter(
    (key) => IDENTIFIER.test(key) && !RESERVED.has(key),
  );
}

/** Bare words that are language literals rather than references to look up. */
const LITERAL_NAMES = new Set(['true', 'false', 'null', 'undefined']);

/**
 * Whether every bare name in the expression is something we deliberately bind.
 *
 * The character whitelist alone never made this a sandbox: `window.location`
 * is all word characters and dots, and an unbound name resolves against the
 * global scope. That was invisible only because the evaluator threw on every
 * input; once it actually runs, an allow-list of *names* is what keeps an
 * expression inside its data.
 *
 * Names after a dot are property accesses on an already-checked base, so only
 * the leading identifier of each chain is tested.
 */
function referencesOnlyBoundNames(expr: string, bound: string[]): boolean {
  const withoutStrings = expr.replace(/'[^']*'|"[^"]*"/g, ' ');
  const allowed = new Set([...bound, 'tokens', '$']);
  for (const match of withoutStrings.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (!LITERAL_NAMES.has(name) && !allowed.has(name)) return false;
  }
  return true;
}

/**
 * Whether every unbound name in the expression was guarded by its own author.
 *
 * `explanation && explanation.steps` states, in the expression itself, that
 * `explanation` may not be there. A name that appears only as the left side of
 * an `&&` — before any property access on it — is a presence check, and its
 * absence is the case the author wrote it for.
 *
 * `explanationX && explanationX.steps` (a typo) is indistinguishable from a
 * genuine optional namespace and is also silent, which is the cost of this. The
 * alternative — warning on every render of every master with an optional
 * section — is what made the real warnings unreadable. A binding that resolves
 * to nothing is caught by the catalogue specs, which resolve every bound path
 * against a production row.
 *
 * This changes reporting only. The expression is rejected either way.
 */
function unboundNamesAreAllGuarded(expr: string, bound: string[]): boolean {
  const withoutStrings = expr.replace(/'[^']*'|"[^"]*"/g, ' ');
  const allowed = new Set([...bound, 'tokens', '$']);
  const unbound = new Set<string>();
  for (const match of withoutStrings.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (!LITERAL_NAMES.has(name) && !allowed.has(name)) unbound.add(name);
  }
  if (!unbound.size) return false;
  return [...unbound].every((name) => {
    // `name &&` — the bare name used as a presence test, not dereferenced.
    const guard = new RegExp(`(?<![.\\w$])${name}\\s*&&`);
    return guard.test(withoutStrings);
  });
}

function evalExpression(expr: string, ctx: ResolveContext): any {
  if (!SAFE_EXPR_RE.test(expr)) {
    console.warn('[binding] Rejected unsafe expression:', expr);
    return '';
  }
  // The template invariant, mechanically (audit F13): a template FORMATS
  // data, it never COMPUTES it. The publish gate refuses these at the
  // library door (validateForPublish); this is the always-on stop for
  // schemas that never pass through it — an activated copy, a user-authored
  // draft, an import. Selection (ternaries, comparisons, presence logic)
  // still evaluates; arithmetic over a data reference resolves to nothing,
  // like every other refused expression.
  if (expressionComputesOverData(expr)) {
    console.warn('[binding] Rejected expression that computes over data:', expr);
    return '';
  }
  try {
    // Same defect as evalConditional had: `with` is a syntax error in strict
    // mode, so this threw while constructing and every computed field resolved
    // to ''. Bind the data keys as parameters instead.
    const names = dataParameterNames(ctx);
    if (!referencesOnlyBoundNames(expr, names)) {
      console.warn('[binding] Rejected expression referencing unbound name:', expr);
      return '';
    }
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, 'tokens', '$', `"use strict"; return (${expr});`);
    const data = ctx.data as Record<string, unknown>;
    return fn(...names.map((key) => data[key]), ctx.tokens, ctx.data);
  } catch (e) {
    console.warn('[binding] Expression eval failed:', expr, e);
    return '';
  }
}

function resolveComputed(name: string, ctx: ResolveContext): any {
  const cf: ComputedField | undefined = (ctx.tokens.computed ?? []).find((c) => c.name === name);
  if (!cf) return undefined;
  const value = evalExpression(cf.expr, ctx);
  // Apply default format if specified and no inline filter follows
  if (cf.format && cf.format !== 'raw') {
    const fn = FILTERS[cf.format];
    if (fn) return fn(value);
  }
  return value;
}

// ─── Bindable string resolution ───────────────────────────────────────────────
const BINDING_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function applyFilters(value: any, filterParts: string[]): any {
  for (const f of filterParts) {
    // Parse filter:arg1:arg2 with support for quoted args containing colons
    const m = f.match(/^([a-zA-Z_]\w*)\s*(?::\s*(.*))?$/);
    if (!m) continue;
    const name = m[1];
    const argsRaw = m[2] ?? '';
    const args = argsRaw
      ? argsRaw.match(/'[^']*'|"[^"]*"|[^:]+/g)?.map((a) => a.trim().replace(/^['"]|['"]$/g, '')) ?? []
      : [];
    const fn = FILTERS[name];
    if (fn) value = fn(value, ...args);
  }
  return value;
}

/**
 * Filters whose whole purpose is to answer an absence.
 *
 * The presence gate above must not run in front of these, or the author's own
 * answer to "what if this is missing" never gets asked. `fallback`/`default`
 * supply a replacement; `if`, `eq`/`neq` and `exists` BRANCH on emptiness, so
 * short-circuiting them would silently take the wrong branch rather than
 * printing nothing.
 *
 * Everything else — `currency`, `percent`, `number`, `fixed` — is a FORMATTER,
 * and a formatter must never see an absence, because `Number(null)` is `0`.
 */
const ABSENCE_AWARE_FILTERS = new Set([
  'fallback', 'default', 'if', 'eq', 'neq', 'exists', 'empty', 'unless',
]);

function handlesAbsence(filterParts: readonly string[]): boolean {
  return filterParts.some((part) =>
    ABSENCE_AWARE_FILTERS.has(part.split(':')[0]!.trim().toLowerCase()));
}

export function resolveBindable(
  input: unknown,
  ctx: ResolveContext,
  transformResolvedValue: (value: string) => string = (value) => value,
): string {
  if (input == null) return '';
  const s = String(input);

  // token:xxx → look up in tokens (colors > fonts > spacing)
  if (s.startsWith('token:')) {
    const key = s.slice(6);
    return (
      ctx.tokens.colors[key] ??
      ctx.tokens.fonts[key] ??
      (ctx.tokens.spacing[key] != null ? String(ctx.tokens.spacing[key]) : s)
    );
  }

  if (!s.includes('{{')) return s;

  return s.replace(BINDING_RE, (_match, expr: string) => {
    const trimmed = expr.trim();
    const [headRaw, ...filterParts] = trimmed.split('|').map((p) => p.trim());
    let value: any;

    if (headRaw.startsWith('=')) {
      // Inline expression OR computed reference: "= name" or "= price * 0.06"
      const body = headRaw.slice(1).trim();
      // bare identifier → computed field lookup
      if (/^[a-zA-Z_]\w*$/.test(body)) {
        value = resolveComputed(body, ctx);
        if (value === undefined) value = evalExpression(body, ctx);
      } else {
        value = evalExpression(body, ctx);
      }
    } else if (headRaw.startsWith('@')) {
      value = resolveComputed(headRaw.slice(1).trim(), ctx);
    } else {
      value = getByPath(ctx.data, headRaw);
    }

    /*
     * RF-7.2B — presence is established BEFORE formatting, never after.
     *
     * `applyFilters` used to run first and the null check second, which meant
     * the formatters decided what an absence looked like. They decided badly:
     * `currency`/`percent`/`number` all begin `Number(v)`, and `Number(null)`
     * and `Number('')` are both `0` — a finite number — so an unknown LVR
     * rendered `0%` and an unknown rent rendered `$0`. Proved by execution in
     * RF-7.2A and recorded in `INVESTMENT_REPORT_DATA_CONTRADICTIONS.md` §10.
     *
     * That was masked in production only because `reportBindingProjection.put()`
     * refuses `undefined`, `null` and `''`, so an absent fact arrived as a
     * MISSING KEY rather than a null. The guarantee rested on one line in one
     * projection; any adapter writing a null re-opened it.
     *
     * A genuine `0` is untouched — it is a measured finding and still formats
     * as `$0` / `0%` / `0`. That distinction is the whole point, and it is why
     * this is an explicit presence test rather than `if (!value)`.
     */
    if (presenceOf(value) === 'absent' && !handlesAbsence(filterParts)) return '';

    value = applyFilters(value, filterParts);
    if (value == null) return '';
    /*
     * A binding with no filter that resolves to a bare ISO date gets the `date`
     * filter anyway.
     *
     * `report.generatedDate` is a full ISO timestamp in all seven projections —
     * they publish `updated_at` / `created_at` / `preparedOn` verbatim, under a
     * name that promises a date — so a master that omits `| date` prints
     * `2026-08-16T08:58:56.946Z` on a client's cover. It is not hypothetical:
     * seven of the thirteen `report_templates` rows a document is actually drawn
     * from bind it with no filter, and that is what the reported Client Details
     * export printed, twice.
     *
     * Making it a property of the RENDERER rather than of the template is what
     * makes it hold. The catalogue source was corrected in `ad99bc228`, and the
     * activated copies kept printing the timestamp for the plain reason that an
     * activated template is a copy — and neither a user-authored template, nor
     * an imported one, nor a converted one is reachable by any seed at all.
     *
     * Only when NO filter was written: an author who wrote one has said what
     * they want, and `| date:iso` is how you ask for the machine form.
     */
    if (filterParts.length === 0 && isIsoDateValue(value)) {
      const formatted = formatIsoDate(String(value));
      if (formatted !== null) return transformResolvedValue(formatted);
    }
    return transformResolvedValue(String(value));
  });
}

export function resolveTokenReference(input: unknown, ctx: ResolveContext): string {
  if (input == null) return '';
  const s = String(input);
  if (!s.startsWith('token:')) return resolveBindable(input, ctx);
  const key = s.slice(6);
  return (
    ctx.tokens.colors[key] ??
    ctx.tokens.fonts[key] ??
    (ctx.tokens.spacing[key] != null ? String(ctx.tokens.spacing[key]) : '')
  );
}

/** Resolve a numeric bindable (font sizes, etc.). */
export function resolveBindableNumber(input: unknown, ctx: ResolveContext, fallback = 0): number {
  if (typeof input === 'number') return input;
  const resolved = resolveBindable(input, ctx);
  const n = Number(resolved);
  return Number.isFinite(n) ? n : fallback;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function byteToHex(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  if (sat === 0) {
    const v = clampByte(light * 255);
    return { r: v, g: v, b: v };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: clampByte(channel(hue + 1 / 3) * 255), g: clampByte(channel(hue) * 255), b: clampByte(channel(hue - 1 / 3) * 255) };
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  transparent: 'transparent',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  navy: '#000080',
  teal: '#008080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  brown: '#a52a2a',
};

function normaliseCssColor(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  if (v.startsWith('#')) {
    const h = v.slice(1);
    if (/^[0-9a-fA-F]{3,8}$/.test(h)) return `#${h}`;
    return null;
  }
  if (/^[0-9a-fA-F]{3,8}$/.test(v)) return `#${v}`;

  const rgb = lower.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const nums = parts.slice(0, 3).map((part) => part.endsWith('%') ? Number(part.slice(0, -1)) * 2.55 : Number(part));
      if (nums.every(Number.isFinite)) return `#${byteToHex(nums[0])}${byteToHex(nums[1])}${byteToHex(nums[2])}`;
    }
  }

  const hsl = lower.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[\s,\/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const h = Number(parts[0].replace(/deg$/, ''));
      const sat = parts[1].endsWith('%') ? Number(parts[1].slice(0, -1)) / 100 : Number(parts[1]);
      const light = parts[2].endsWith('%') ? Number(parts[2].slice(0, -1)) / 100 : Number(parts[2]);
      if ([h, sat, light].every(Number.isFinite)) {
        const { r, g, b } = hslToRgb(h, sat, light);
        return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
      }
    }
  }

  return null;
}

/** Resolve a colour, accepting hex plus common CSS rgb/rgba/hsl/named forms and returning a renderer-safe value. */
export function resolveBindableColor(input: unknown, ctx: ResolveContext, fallback = '#000000'): string {
  const v = resolveBindable(input, ctx);
  if (!v) return fallback;
  return normaliseCssColor(v) ?? fallback;
}

// ─── Conditional expressions ──────────────────────────────────────────────────
const SAFE_EXPR = /^[\s\w.'"=!<>&|()+\-*/%?:,\[\]@]*$/;

export function evalConditional(expr: string | undefined, ctx: ResolveContext): boolean {
  if (!expr) return true;
  if (!SAFE_EXPR.test(expr)) {
    console.warn('[conditional] Rejected unsafe expression:', expr);
    return false;
  }
  try {
    // Data keys are bound as named parameters rather than exposed through
    // `with`. `with` is a syntax error inside strict-mode code, so the previous
    // `"use strict"; with (data) {...}` form threw while *constructing* every
    // conditional — which the catch below swallowed into `false`. The effect was
    // that every conditional overlay silently failed to render, whatever the
    // data said. Parameters give the same lexical lookup and keep strict mode.
    const names = dataParameterNames(ctx);
    if (!referencesOnlyBoundNames(expr, names)) {
      // The rejection is unconditional and stays that way — an unbound name
      // resolves against the global scope, which is what the allow-list above
      // exists to stop. Only how loudly it is reported changes.
      //
      // `explanation && explanation.steps` is an author GUARDING an optional
      // namespace, and on the Borrowing Capacity masters that guard is doing
      // its job: `explanation` and `audit_trail` are columns written only by
      // calculator runs since the keep-update, so 127 of 128 stored assessments
      // do not have them and those pages are meant to stay dark. Reporting the
      // designed path as a warning meant every render of every one of those
      // masters logged three of these — which is the noise a genuine typo would
      // hide in, and the typo is the case this check exists to catch.
      if (unboundNamesAreAllGuarded(expr, names)) return false;
      console.warn('[conditional] Rejected expression referencing unbound name:', expr);
      return false;
    }
    // eslint-disable-next-line no-new-func
    const fn = new Function(...names, 'tokens', `"use strict"; return (${expr});`);
    const data = ctx.data as Record<string, unknown>;
    return Boolean(fn(...names.map((key) => data[key]), ctx.tokens));
  } catch (e) {
    console.warn('[conditional] Eval failed:', expr, e);
    return false;
  }
}

/** Exported list of filter names, kept in sync for validation. */
export const FILTER_NAMES = Object.keys(FILTERS);
