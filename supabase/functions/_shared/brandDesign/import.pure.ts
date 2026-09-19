/**
 * Bringing a published design system in from Claude Design.
 *
 * ## Why this can exist at all
 *
 * `reportDesign/tokens.pure.ts` states every print value as a derivation of a
 * named design-system variable, with the reason inline — `paper` is
 * `--background`, `paperAlt` is `--muted`, the cover `field` is
 * `--aurixa-obsidian`, `rule` is `--border`, body ink is `--foreground`. Until
 * now that was **prose in a comment**: true, load-bearing, and not executable.
 * A design system published on claude.ai/design exports exactly those variables
 * — so running the same derivation over a *different* project's tokens is all
 * an import needs to be.
 *
 * The spec beside this module imports the committed NPC manifest and asserts
 * the result equals `PRINT_SURFACE` / `PRINT_INK` / `PRINT_BRAND.base` to the
 * byte. That is the proof the derivation is the documented one, and it fails
 * the moment either side drifts.
 *
 * ## Two input shapes, because a person has whichever they have
 *
 * - **`_ds_manifest.json`** — the compiled index. Its `tokens[]` are already
 *   parsed into `{ name, value, kind, scope }`, so nothing here has to read
 *   CSS. Preferred: it also carries the theme list, the brand fonts and the
 *   card index.
 * - **`tokens/colors.css`** (or any token CSS) — parsed here. The same
 *   information, one step further back, for somebody who copied a file out of
 *   the project rather than exporting it.
 *
 * ## Nothing is guessed silently
 *
 * Every role has an ordered fallback chain, and taking any fallback but the
 * first records a note that the review screen prints. A design system missing
 * `--muted` gets `--secondary` as its panel stock and *says so* — because the
 * alternative is somebody discovering their report has our champagne panels in
 * it after they have sent it.
 *
 * Three roles have no fallback worth having: without `paper`, `bodyInk` or
 * `field` there is no document, and the import is refused rather than
 * half-completed against house defaults.
 *
 * Pure: no I/O, no `fetch`. `scripts/brandDesign/syncClaudeDesign.ts` does the
 * fetching, and the browser hands this a file a person dropped.
 */
import {
  NEUTRAL_ROLES,
  type ReportNeutrals,
} from '../reportDesign/brandResolve.pure.ts';
import { DEFAULT_REPORT_DESIGN_OPTIONS } from '../reportDesign/options.pure.ts';
import { type BrandDesignSystem, MAX_NAME_CHARS, slugify } from './system.pure.ts';

/** A source larger than this is not a token file. */
export const MAX_IMPORT_CHARS = 2_000_000;

/**
 * What Claude Design calls a token's type.
 *
 * `color` and `font` are the annotated ones (`/* @kind color *\/` in the CSS);
 * the rest the manifest infers. Only `color` drives the derivation, but the
 * others are carried so the review screen can say how big the system is.
 */
export type TokenKind = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'other';

const KINDS: readonly TokenKind[] = ['color', 'font', 'spacing', 'radius', 'shadow', 'other'];

export interface ImportedToken {
  /** With the leading dashes, as authored: `--background`. */
  name: string;
  /** As authored. An HSL triplet, a hex, a font stack, a length. */
  value: string;
  kind: TokenKind;
  /**
   * The selector it was declared under. Absent for `:root`.
   *
   * The reason this is kept: a design system's dark theme redeclares
   * `--background` as its darkest ground, which is a *very* good candidate for
   * the report cover when the project has no `--aurixa-obsidian` of its own.
   */
  scope?: string;
  definedIn?: string;
}

export interface ImportedCard {
  name: string;
  subtitle: string;
  group: string;
  path: string;
  viewport: string;
}

/** The parts of a `_ds_manifest.json` this consumes. */
export interface DesignSystemManifest {
  namespace: string;
  tokens: ImportedToken[];
  themes: Array<{ selector: string; label: string }>;
  fonts: Array<{ family: string; weight?: string; style?: string }>;
  brandFonts: Array<{ family: string; status?: string; tokens?: string[] }>;
  cards: ImportedCard[];
}

// ── Colour ──────────────────────────────────────────────────────────────────

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;
const RGB_FN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;
/** `42 54% 96%` or `hsl(42, 54%, 96%)` or `hsl(42 54% 96% / .5)`. */
const HSL = /^(?:hsla?\()?\s*([-\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i;

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0').toUpperCase();

/**
 * A design-system colour value to `#RRGGBB`, or null.
 *
 * Claude Design writes HSL triplets without the `hsl()` wrapper so they compose
 * with alpha — `hsl(var(--primary) / 0.12)` — which means a bare `42 54% 96%`
 * is the *common* case rather than the exotic one. Hex and `rgb()` are accepted
 * too, so a token file that never went through Claude Design still imports.
 */
export function tokenValueToHex(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;

  const h6 = HEX6.exec(v);
  if (h6) return `#${h6[1].toUpperCase()}`;

  const h3 = HEX3.exec(v);
  if (h3) return `#${h3[1].split('').map((c) => c + c).join('').toUpperCase()}`;

  const rgb = RGB_FN.exec(v);
  if (rgb) return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;

  const hsl = HSL.exec(v);
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));

  return null;
}

/** `(42, 54, 96)` → `#FAF7EF`. Degrees, percent, percent. */
export function hslToHex(h: number, s: number, l: number): string | null {
  if (![h, s, l].every(Number.isFinite)) return null;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const hue = ((h % 360) + 360) % 360;

  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  const [r, g, b] = hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return `#${hex2((r + m) * 255)}${hex2((g + m) * 255)}${hex2((b + m) * 255)}`;
}

// ── Reading the two input shapes ────────────────────────────────────────────

const str = (v: unknown, max = 200): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function readToken(raw: unknown): ImportedToken | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 120);
  if (!name.startsWith('--')) return null;
  // Not `str` — a font stack's internal spacing is part of the value and a
  // shadow's is too. Only the ends are trimmed.
  const value = typeof r.value === 'string' ? r.value.trim().slice(0, 400) : '';
  if (!value) return null;
  const kind = KINDS.includes(r.kind as TokenKind) ? r.kind as TokenKind : 'other';
  const scope = str(r.scope, 80);
  const definedIn = str(r.definedIn, 200);
  return { name, value, kind, ...(scope ? { scope } : {}), ...(definedIn ? { definedIn } : {}) };
}

/**
 * Read a `_ds_manifest.json`.
 *
 * Total: an unusable manifest returns an error rather than throwing, because
 * this runs on a file somebody dropped onto a page.
 */
export function readDesignSystemManifest(
  raw: unknown,
): { ok: true; manifest: DesignSystemManifest } | { ok: false; error: string } {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_IMPORT_CHARS) return { ok: false, error: 'that file is too large to be a design system' };
    try { parsed = JSON.parse(raw); } catch { return { ok: false, error: 'that is not valid JSON' }; }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'a manifest must be an object' };
  const m = parsed as Record<string, unknown>;

  const tokens = (Array.isArray(m.tokens) ? m.tokens : [])
    .map(readToken)
    .filter((t): t is ImportedToken => t !== null);
  if (!tokens.length) {
    return {
      ok: false,
      error: 'no design tokens were found — this looks like a manifest but it declares none',
    };
  }

  const cards: ImportedCard[] = (Array.isArray(m.cards) ? m.cards : [])
    .map((c) => (c && typeof c === 'object' ? c as Record<string, unknown> : {}))
    .map((c) => ({
      name: str(c.name, 120),
      subtitle: str(c.subtitle, 200),
      group: str(c.group, 64),
      path: str(c.path, 256),
      viewport: str(c.viewport, 24),
    }))
    .filter((c) => c.name);

  return {
    ok: true,
    manifest: {
      namespace: str(m.namespace, 120),
      tokens,
      themes: (Array.isArray(m.themes) ? m.themes : [])
        .map((t) => (t && typeof t === 'object' ? t as Record<string, unknown> : {}))
        .map((t) => ({ selector: str(t.selector, 80), label: str(t.label, 80) }))
        .filter((t) => t.selector),
      fonts: (Array.isArray(m.fonts) ? m.fonts : [])
        .map((f) => (f && typeof f === 'object' ? f as Record<string, unknown> : {}))
        .map((f) => ({ family: str(f.family, 80), weight: str(f.weight, 12), style: str(f.style, 12) }))
        .filter((f) => f.family),
      brandFonts: (Array.isArray(m.brandFonts) ? m.brandFonts : [])
        .map((f) => (f && typeof f === 'object' ? f as Record<string, unknown> : {}))
        .map((f) => ({
          family: str(f.family, 80),
          status: str(f.status, 24),
          tokens: (Array.isArray(f.tokens) ? f.tokens : []).map((t) => str(t, 120)).filter(Boolean),
        }))
        .filter((f) => f.family),
      cards,
    },
  };
}

/** `--font-x`, `--weight-x`, `--leading-x`, `--tracking-x`, `--text-x`. */
const FONT_NAME = /^--(font|weight|leading|tracking|text)-/;

/**
 * Read token declarations out of CSS.
 *
 * Two things make this less trivial than a one-line regex, and both are true of
 * the real files:
 *
 * 1. **The `@kind` annotation sits after the semicolon**, not inside the value
 *    — `--background: 42 54% 96%; /* @kind color *\/ /* warm ivory *\/`. So a
 *    declaration is read first and its annotation looked for afterwards.
 * 2. **`tokens/typography.css` is partly minified**: twenty declarations on one
 *    line, comments interleaved. A line-oriented parser reads that file as a
 *    single token and loses nineteen.
 *
 * Selector tracking is flat — token files do not nest — and anything starting
 * `@` is skipped so an `@font-face` block cannot contribute a scope.
 */
export function parseTokenCss(css: string, definedIn = ''): ImportedToken[] {
  const source = String(css ?? '').slice(0, MAX_IMPORT_CHARS);
  const out: ImportedToken[] = [];

  const BLOCK = /([^{}]*)\{([^{}]*)\}/g;
  for (const block of source.matchAll(BLOCK)) {
    const selectorRaw = block[1] ?? '';
    const body = block[2] ?? '';

    // The selector is whatever follows the previous block. Comments before it
    // are common and are not part of it.
    const selector = selectorRaw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(',')[0]
      .replace(/\s+/g, ' ')
      .trim();
    if (selector.startsWith('@')) continue;

    const DECL = /--([a-zA-Z0-9-]+)\s*:\s*([^;}]+);?/g;
    for (const decl of body.matchAll(DECL)) {
      const name = `--${decl[1]}`;
      // The value stops at the first comment, so an inline `/* warm ivory */`
      // does not become part of the colour.
      const value = (decl[2] ?? '').split('/*')[0].trim();
      if (!value) continue;

      // Look just past this declaration for its annotation. Bounded, so a
      // comment forty declarations later cannot be claimed by this one.
      const after = body.slice((decl.index ?? 0) + decl[0].length, (decl.index ?? 0) + decl[0].length + 60);
      const annotated = /^\s*\/\*\s*@kind\s+([a-z]+)\s*\*\//i.exec(after)?.[1]?.toLowerCase();

      const kind: TokenKind = KINDS.includes(annotated as TokenKind)
        ? annotated as TokenKind
        : tokenValueToHex(value) ? 'color'
        : FONT_NAME.test(name) ? 'font'
        : 'other';

      out.push({
        name,
        value,
        kind,
        ...(selector && selector !== ':root' ? { scope: selector } : {}),
        ...(definedIn ? { definedIn } : {}),
      });
    }
  }

  return out;
}

// ── The derivation ──────────────────────────────────────────────────────────

/**
 * Where each print role comes from, in order of preference.
 *
 * A `.dark:` prefix means "that variable as the dark theme redeclares it".
 * Every entry after the first is a compromise and says so when it is used.
 *
 * These are not invented. Each first choice is the variable
 * `reportDesign/tokens.pure.ts` already names as that value's source, and a
 * spec holds the two together.
 */
export const NEUTRAL_SOURCES: Record<keyof ReportNeutrals | 'brand', readonly string[]> = {
  /** The sheet. */
  paper: ['--background'],
  /** Panels, table stripes, wells — must be *darker* than the sheet. */
  paperAlt: ['--muted', '--secondary', '--surface-3'],
  /** Cooler, brighter stock for dense pages. */
  paperBright: ['--card', '--popover', '--surface-1'],
  /**
   * The cover and disclaimer ground.
   *
   * `--aurixa-obsidian` is NPC's name for it and most systems will not have
   * one, so the dark theme's own page colour is the honest second choice — a
   * design system with a dark mode has already decided what its darkest ground
   * is.
   */
  field: ['--aurixa-obsidian', '.dark:--background', '--sidebar-background', '--foreground'],
  /** Hairlines, table borders, footer rules. */
  rule: ['--border', '--input', '--border-soft'],
  /** Body copy. */
  bodyInk: ['--foreground'],
  /** Captions, eyebrows, running heads. */
  mutedInk: ['--muted-foreground', '--foreground'],
  /** Category A. Fills and rules; the type variants are re-derived downstream. */
  brand: ['--brand', '--primary', '--accent'],
};

/**
 * Roles with no acceptable substitute.
 *
 * Without a sheet, body ink or a cover ground there is no document. Filling
 * these from NPC's own values would produce something that renders, looks
 * deliberate, and is not the design system anybody imported.
 */
const REQUIRED: readonly (keyof ReportNeutrals)[] = ['paper', 'bodyInk', 'field'];

export interface DerivedNeutrals {
  neutrals: ReportNeutrals;
  /** `#RRGGBB`, or null when the system declares no brand colour at all. */
  brandHex: string | null;
  /** The token each role was taken from, for the review screen. */
  sources: Record<keyof ReportNeutrals | 'brand', string>;
  /** Every compromise, in words. Empty when every first choice was present. */
  notes: string[];
}

function lookup(tokens: readonly ImportedToken[], ref: string): ImportedToken | null {
  const scoped = ref.startsWith('.') ? ref.split(':') : null;
  const wantScope = scoped ? scoped[0] : undefined;
  const name = scoped ? scoped.slice(1).join(':') : ref;
  for (const t of tokens) {
    if (t.name !== name) continue;
    if (wantScope ? t.scope === wantScope : !t.scope) return t;
  }
  return null;
}

/**
 * Design-system tokens to print paper and ink.
 *
 * The whole point of the feature, in forty lines. Returns an error only for the
 * three roles that have no honest substitute.
 */
export function deriveReportNeutrals(
  tokens: readonly ImportedToken[],
): { ok: true; derived: DerivedNeutrals } | { ok: false; error: string } {
  const neutrals = {} as Record<keyof ReportNeutrals, string>;
  const sources = {} as Record<keyof ReportNeutrals | 'brand', string>;
  const notes: string[] = [];
  const missing: string[] = [];

  for (const role of NEUTRAL_ROLES) {
    const chain = NEUTRAL_SOURCES[role];
    let taken: { ref: string; hex: string } | null = null;
    for (const ref of chain) {
      const token = lookup(tokens, ref);
      const hex = token ? tokenValueToHex(token.value) : null;
      if (hex) { taken = { ref, hex }; break; }
    }

    if (!taken) {
      if (REQUIRED.includes(role)) missing.push(`${role} (${chain[0]})`);
      continue;
    }
    neutrals[role] = taken.hex;
    sources[role] = taken.ref;
    if (taken.ref !== chain[0]) {
      notes.push(`${role} came from ${taken.ref} — this system has no ${chain[0]}`);
    }
  }

  if (missing.length) {
    return {
      ok: false,
      error: `this design system does not declare ${missing.join(', ')}, and a report cannot be `
        + 'set without them',
    };
  }

  // A non-required role that resolved to nothing takes the sheet rather than a
  // colour from somewhere else's palette — a panel the same shade as the paper
  // is invisible, which is honest, where an imported NPC champagne would be a
  // quiet lie about whose design system this is.
  for (const role of NEUTRAL_ROLES) {
    if (neutrals[role]) continue;
    neutrals[role] = role === 'mutedInk' ? neutrals.bodyInk : neutrals.paper;
    sources[role] = role === 'mutedInk' ? 'bodyInk' : 'paper';
    notes.push(`${role} has no source in this system and falls back to ${sources[role]}`);
  }

  let brandHex: string | null = null;
  for (const ref of NEUTRAL_SOURCES.brand) {
    const token = lookup(tokens, ref);
    const hex = token ? tokenValueToHex(token.value) : null;
    if (hex) {
      brandHex = hex;
      sources.brand = ref;
      if (ref !== NEUTRAL_SOURCES.brand[0]) {
        notes.push(`the accent came from ${ref} — this system has no ${NEUTRAL_SOURCES.brand[0]}`);
      }
      break;
    }
  }
  if (!brandHex) notes.push('this system declares no brand colour, so the house accent is used');

  return { ok: true, derived: { neutrals, brandHex, sources, notes } };
}

// ── The whole import ────────────────────────────────────────────────────────

export interface DesignSystemImport extends DerivedNeutrals {
  system: BrandDesignSystem;
  /** What was recognised, for the review screen. */
  summary: {
    namespace: string;
    tokenCount: number;
    colorCount: number;
    cardCount: number;
    themes: string[];
    brandFonts: string[];
    /** `manifest` or `css`. Which shape was handed in. */
    kind: 'manifest' | 'css';
  };
}

/**
 * A dropped file to a saveable design system.
 *
 * Accepts either shape and works out which by looking, because the difference
 * matters to this function and not to the person dropping the file.
 *
 * The system it returns is **not saved and not yet legible** — the caller runs
 * `auditBrandDesignSystem` and the route refuses it if the imported grounds
 * cannot carry their own ink. Producing an unaudited system here and auditing
 * it there is deliberate: there is one gate, and it is the one every other
 * design system already passes through.
 */
export function importDesignSystem(
  input: unknown,
  opts: { name?: string; fallbackName?: string } = {},
): { ok: true; result: DesignSystemImport } | { ok: false; error: string } {
  const raw = typeof input === 'string' ? input.trim() : input;

  let tokens: ImportedToken[];
  let manifest: DesignSystemManifest | null = null;
  let kind: 'manifest' | 'css';

  if (typeof raw === 'string' && !raw.startsWith('{')) {
    tokens = parseTokenCss(raw);
    kind = 'css';
    if (!tokens.length) {
      return { ok: false, error: 'no custom properties were found — a token file declares `--name: value`' };
    }
  } else {
    const read = readDesignSystemManifest(raw);
    if (read.ok === false) return read;
    manifest = read.manifest;
    tokens = manifest.tokens;
    kind = 'manifest';
  }

  const derived = deriveReportNeutrals(tokens);
  if (derived.ok === false) return derived;

  const name = (opts.name ?? '').trim()
    || (manifest?.namespace ? manifest.namespace.replace(/_[0-9a-f]{6,}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2') : '')
    || opts.fallbackName
    || 'Imported design system';

  const system: BrandDesignSystem = {
    name: name.slice(0, MAX_NAME_CHARS),
    slug: slugify(name),
    description: manifest
      ? `Imported from ${manifest.namespace || 'a Claude Design project'} — `
        + `${derived.derived.notes.length ? 'with substitutions, ' : ''}`
        + `${tokens.filter((t) => t.kind === 'color').length} colour tokens.`
      : `Imported from a token file — ${tokens.filter((t) => t.kind === 'color').length} colour tokens.`,
    brandHex: derived.derived.brandHex,
    // The preset still has to be *something*, and it is inert: `neutrals`
    // replaces everything it would have supplied. `signature` is the house
    // default and reads correctly in the picker.
    options: { ...DEFAULT_REPORT_DESIGN_OPTIONS },
    neutrals: derived.derived.neutrals,
    origin: 'imported',
    brief: '',
    sourceNamespace: manifest?.namespace ?? '',
  };

  return {
    ok: true,
    result: {
      ...derived.derived,
      system,
      summary: {
        namespace: manifest?.namespace ?? '',
        tokenCount: tokens.length,
        colorCount: tokens.filter((t) => t.kind === 'color').length,
        cardCount: manifest?.cards.length ?? 0,
        themes: manifest?.themes.map((t) => t.label || t.selector) ?? [],
        brandFonts: manifest?.brandFonts.map((f) => f.family) ?? [],
        kind,
      },
    },
  };
}
