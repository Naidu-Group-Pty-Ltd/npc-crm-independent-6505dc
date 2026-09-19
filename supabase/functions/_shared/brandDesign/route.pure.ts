/**
 * What `generate-brand-design-system` accepts, and what it answers.
 *
 * Three actions, and the split between them is the whole design:
 *
 * - **`audit`** resolves a palette and checks it. No model, no write. The form
 *   calls it on every change, so a person dragging a brand colour sees the
 *   contrast verdict before they commit to anything.
 * - **`generate`** asks Claude for a design system from a brief and returns the
 *   draft **without saving it**. A model's first answer is a proposal.
 * - **`save`** writes one. Authored or accepted-generated, same path, same
 *   validation.
 *
 * `generate` deliberately does not persist. A route that generated *and* saved
 * would fill the picker with every attempt somebody made at a brief, and the
 * picker is a list a person chooses a house style from — not a log of drafting.
 *
 * Everything testable about the route lives here. The function around it does
 * auth, one model call, a resolve, an audit and one write.
 */
import {
  type BrandDesignSystem,
  type BrandSystemAudit,
  MAX_BRIEF_CHARS,
  readBrandDesignSystem,
} from './system.pure.ts';
import type { BrandSystemOrigin } from './system.pure.ts';
import { MAX_IMPORT_CHARS } from './import.pure.ts';
import type { ReportNeutrals } from '../reportDesign/brandResolve.pure.ts';
import {
  normalizeReportDesignOptions,
  type ReportDesignOptions,
} from '../reportDesign/options.pure.ts';
import { readReportNeutrals } from '../reportDesign/brandResolve.pure.ts';

export type BrandRouteAction = 'audit' | 'generate' | 'save' | 'list' | 'import';

export interface BrandAuditRequest {
  action: 'audit';
  /** The candidate, in the same shape `readBrandDesignSystem` reads. */
  system: BrandDesignSystem;
}

export interface BrandGenerateRequest {
  action: 'generate';
  brief: string;
  /** Printed into the prompt so the model knows whose document it is. */
  companyName: string;
}

export interface BrandSaveRequest {
  action: 'save';
  system: BrandDesignSystem;
  /** Update in place when the caller names an existing row. */
  id: string | null;
  isActive: boolean;
}

/**
 * List the saved systems.
 *
 * This exists because the browser cannot read the table.
 *
 * `brand_design_systems` is granted to `authenticated` only, and this app's
 * browser Supabase client is permanently anonymous — identity lives in an
 * HttpOnly cookie the custom auth flow owns, so `persistSession` is off and no
 * GoTrue session is ever created. A direct `supabase.from('brand_design_systems')`
 * is therefore refused at the *grant* level before RLS is even consulted, and
 * the picker it feeds renders empty for everybody.
 *
 * The route is the only thing holding a service-role client that has already
 * verified the cookie, so the read has to happen here. It is the same shape the
 * repo already uses for `template_imports` (`TemplateBuilder.tsx`) and linked
 * imports (`TemplateBuilderEdit.tsx`).
 */
export interface BrandListRequest {
  action: 'list';
  /** Inactive systems are hidden from pickers but kept for auditing. */
  includeInactive: boolean;
}

/**
 * Read a published design system into a candidate.
 *
 * The source is whatever a person dropped onto the page — a
 * `_ds_manifest.json` exported from a Claude Design project, or a
 * `tokens/*.css` copied out of one. It is sent to the route rather than parsed
 * in the browser for one reason: the browser would then hold a second copy of
 * the derivation, and the derivation is the feature. `import.pure.ts` is
 * bridged, so both ends run the same code, and the route is where the audit
 * that gates every other design system already lives.
 *
 * Like `generate`, this **does not save**. It returns a candidate and its
 * verdict; the browser shows the specimen gallery and calls `save` if the
 * person accepts it.
 */
export interface BrandImportRequest {
  action: 'import';
  /** The raw file contents. Manifest JSON or token CSS; the reader works it out. */
  source: string;
  /** What to call it. Empty falls back to the manifest's own namespace. */
  name: string;
}

export type BrandRouteRequest =
  | BrandAuditRequest
  | BrandGenerateRequest
  | BrandSaveRequest
  | BrandListRequest
  | BrandImportRequest;

export type BrandRequestParse =
  | { ok: true; request: BrandRouteRequest }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A brief shorter than this is not a brief, it is a word. */
export const MIN_BRIEF_CHARS = 12;

/**
 * Read a request body.
 *
 * A malformed system is refused here rather than defaulted, because
 * `readBrandDesignSystem` is the one place that decides what a legal design
 * system is and this route has no business having a second opinion.
 */
export function parseBrandRequest(body: unknown): BrandRequestParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid json' };
  const b = body as Record<string, unknown>;
  const action = typeof b.action === 'string' ? b.action.trim() : '';

  // Before `audit` and `save`, which both run `readBrandDesignSystem(b.system)`
  // and would refuse a listing request for having no design system in it.
  if (action === 'list') {
    return { ok: true, request: { action: 'list', includeInactive: b.includeInactive === true } };
  }

  // Also above `audit`/`save` — an import carries a file, not a design system.
  if (action === 'import') {
    const source = typeof b.source === 'string' ? b.source : '';
    if (!source.trim()) return { ok: false, error: 'no file contents were sent' };
    if (source.length > MAX_IMPORT_CHARS) {
      return {
        ok: false,
        error: `that file is ${Math.round(source.length / 1024)} KB and the limit is `
          + `${Math.round(MAX_IMPORT_CHARS / 1024)} KB — a design system's tokens are far smaller`,
      };
    }
    return {
      ok: true,
      request: {
        action: 'import',
        source,
        name: typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '',
      },
    };
  }

  if (action === 'generate') {
    const brief = typeof b.brief === 'string' ? b.brief.trim().slice(0, MAX_BRIEF_CHARS) : '';
    if (brief.length < MIN_BRIEF_CHARS) {
      return {
        ok: false,
        error: `a brief needs at least ${MIN_BRIEF_CHARS} characters — say what the documents are for and who reads them`,
      };
    }
    return {
      ok: true,
      request: {
        action: 'generate',
        brief,
        companyName: typeof b.companyName === 'string' ? b.companyName.trim().slice(0, 120) : '',
      },
    };
  }

  if (action === 'audit' || action === 'save') {
    const read = readBrandDesignSystem(b.system);
    if (read.ok === false) return { ok: false, error: read.error };
    if (action === 'audit') return { ok: true, request: { action: 'audit', system: read.system } };

    const rawId = typeof b.id === 'string' ? b.id.trim() : '';
    if (rawId && !UUID.test(rawId)) return { ok: false, error: 'id must be a uuid' };
    return {
      ok: true,
      request: {
        action: 'save',
        system: read.system,
        id: rawId || null,
        isActive: b.isActive !== false,
      },
    };
  }

  return {
    ok: false,
    error: `unknown action "${action.slice(0, 40)}" — expected audit, generate, import, save or list`,
  };
}

/** What comes back from every action. `id` is set only by `save`. */
export interface BrandRouteResponse {
  action: BrandRouteAction;
  system: BrandDesignSystem;
  /** The resolved palette, so the UI can paint a swatch without re-deriving. */
  audit: {
    ok: boolean;
    problems: BrandSystemAudit['problems'];
    /** `describeAuditProblems`, or empty. Ready to put in front of a person. */
    summary: string;
    accentOnPaper: string;
    accentOnField: string;
    paper: string;
    field: string;
  };
  id: string | null;
  slug: string;
  /** Present on `generate`: what the model was told, for the review screen. */
  brief: string;
  /**
   * Present on `import`: what was recognised in the dropped file.
   *
   * Optional because only the import action fills it — every other action
   * answers about a system that was authored or drafted, and has no provenance
   * to report.
   */
  imported?: {
    namespace: string;
    tokenCount: number;
    colorCount: number;
    cardCount: number;
    themes: string[];
    brandFonts: string[];
    sources: Record<string, string>;
    notes: string[];
    kind: 'manifest' | 'css';
  };
  durationMs: number;
}

/** One row of the picker. */
export interface BrandDesignSystemSummary {
  id: string;
  name: string;
  slug: string;
  description: string;
  origin: BrandSystemOrigin;
  /** `#RRGGBB`, or null for the house brand. The *requested* hue, not the
   *  resolved accent — the palette is derived per render, never stored. */
  brandHex: string | null;
  isActive: boolean;
  updatedAt: string;
  /**
   * The system's own paper and ink, when it brought some.
   *
   * On the *summary* rather than only on the full row because the brand-systems
   * page renders a live specimen for whichever system is selected, and having
   * it here means that costs no second fetch. Null for everything authored or
   * drafted from a brief — those take their grounds from the preset.
   */
  neutrals: ReportNeutrals | null;
  /** The Claude Design project it came from. Empty unless imported. */
  sourceNamespace: string;
  /** The full options, so the page can render a specimen without re-reading. */
  options: ReportDesignOptions;
}

/**
 * The listing.
 *
 * A separate interface rather than a member of `BrandRouteResponse`, on
 * purpose. Widening that type into a union would force every existing
 * `.system` / `.audit` / `.id` access in `BrandDesignSystemDialog` to narrow
 * first, for no gain — a listing and a single-system answer have nothing in
 * common but the word "response".
 */
export interface BrandListResponse {
  action: 'list';
  systems: BrandDesignSystemSummary[];
  durationMs: number;
}

/** One database row into one picker row. */
export function readBrandSystemSummary(row: Record<string, unknown>): BrandDesignSystemSummary {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    description: String(row.description ?? ''),
    origin: row.origin === 'generated' || row.origin === 'imported'
      ? row.origin
      : 'authored',
    brandHex: typeof row.brand_hex === 'string' && row.brand_hex ? row.brand_hex : null,
    isActive: row.is_active !== false,
    updatedAt: String(row.updated_at ?? ''),
    // All seven or none. A row whose `neutrals` column was hand-edited into a
    // partial object reads as null here and takes the preset's grounds, which
    // is a document that is merely not what was imported rather than one with
    // half of two design systems in it.
    neutrals: readReportNeutrals(row.neutrals),
    sourceNamespace: typeof row.source_namespace === 'string' ? row.source_namespace : '',
    options: normalizeReportDesignOptions(
      (row.options ?? {}) as Partial<ReportDesignOptions>,
    ),
  };
}

/**
 * Pull the first JSON object out of a model's reply.
 *
 * Claude is asked for one JSON object and usually returns exactly that, but a
 * fenced block or a sentence of preamble is common enough that failing on it
 * would make the feature flaky for no reason. Brace-matching rather than a
 * regex, because a design system's `description` can contain a brace and a lazy
 * `\{.*\}` would cut the object in half.
 *
 * Returns `null` rather than throwing: the caller has a better error to give
 * than "unexpected token".
 */
export function extractJsonObject(text: string): unknown {
  const source = String(text ?? '');
  const start = source.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
