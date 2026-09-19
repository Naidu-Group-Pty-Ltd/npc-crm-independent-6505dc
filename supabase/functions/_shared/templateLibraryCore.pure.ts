/**
 * Template Library — pure decision logic, Deno-free.
 *
 * Everything here is a total function over plain data: no Deno APIs, no
 * network, no Supabase client. That is deliberate. The rules encoded below are
 * the ones that decide whether a template can reach a customer's report, and a
 * source-scanning test can only prove a literal has not changed — it cannot
 * prove the control flow still holds. Keeping the rules here lets the frontend
 * test suite execute them directly, the same way
 * `claudeReconstruct.pure.ts` and `pdfCacheContract.pure.ts` already are.
 *
 * `manage-template-library/index.ts` is the I/O shell around this module.
 */
import { SUPPORTED_TEMPLATE_SCHEMA_VERSION } from './templateSchemaVersion.ts';
import {
  PRODUCTION_SAFE_BLOCK_TYPES,
  PRODUCTION_REPORT_TEMPLATE_TYPES,
} from './productionBlockTypes.ts';
import {
  applyColourwayToSchema,
  defaultColourwayFor,
  findColourway,
  type ApprovedColourway,
} from './templateColourways.pure.ts';
import { bindOrganisationDisclaimer } from './reports/disclaimerBinding.pure.ts';

// ── Operations and authorisation ─────────────────────────────────────────────

export type LibraryOperation =
  | 'list' | 'get' | 'instantiate' | 'use_for_reports' | 'promote' | 'save_draft'
  | 'publish' | 'deprecate' | 'archive' | 'restore' | 'events';

export type RequiredAuthz =
  | { kind: 'module'; permission: 'can_view' | 'can_edit' }
  | { kind: 'superadmin' };

const READ_OPERATIONS: ReadonlySet<string> = new Set(['list', 'get']);
// `use_for_reports` is deliberately the same bar as `instantiate`: both copy a
// published entry into `report_templates` with every safety-critical field
// fixed server-side. The copy it creates is user-scoped, so it is visible only
// to its owner and can only ever affect that owner's own documents — the
// activation gate's superadmin bar protects the GLOBAL candidate set, which
// this operation cannot touch.
const EDIT_OPERATIONS: ReadonlySet<string> = new Set(['instantiate', 'use_for_reports']);

/**
 * What an operation requires. Deny-by-default: anything not explicitly a read
 * or an edit is a control-plane action, so a NEW operation is superadmin-only
 * until somebody deliberately lowers it.
 */
export function requiredAuthzFor(operation: string): RequiredAuthz {
  if (READ_OPERATIONS.has(operation)) return { kind: 'module', permission: 'can_view' };
  if (EDIT_OPERATIONS.has(operation)) return { kind: 'module', permission: 'can_edit' };
  return { kind: 'superadmin' };
}

/**
 * Columns returned by `list`. Never includes the heavy `schema` payload.
 *
 * `design_meta` is small — a manifest of ~21 short strings plus ten colourway
 * ids — and the browse card reads family, variant axis, density, ground and
 * recommended use straight off it, so leaving it out would cost one detail
 * fetch per visible card.
 */
export const LIST_COLUMNS: readonly string[] = [
  'id', 'family_id', 'slug', 'version', 'name', 'description',
  'category', 'report_type', 'tier', 'variant', 'industry', 'tags', 'style',
  'orientation', 'page_size', 'page_count',
  'preview_schema', 'thumbnail_path', 'preview_image_paths',
  'supported_modules', 'required_bindings', 'brand_safe', 'production_ready',
  'compatibility_version', 'status', 'access_tier', 'visibility', 'engine',
  'source_template_id', 'created_at', 'updated_at', 'published_at',
  'usage_count', 'last_used_at', 'design_meta',
];

export const LIST_SELECT = LIST_COLUMNS.join(',');

// ── Schema inspection ────────────────────────────────────────────────────────

export function pagesOf(schema: unknown): any[] {
  const pages = (schema as any)?.pages;
  return Array.isArray(pages) ? pages : [];
}

/** Distinct block types used anywhere in the template, sorted. */
export function blockTypesOf(schema: unknown): string[] {
  const types = new Set<string>();
  for (const page of pagesOf(schema)) {
    for (const block of Array.isArray(page?.blocks) ? page.blocks : []) {
      const t = String(block?.type ?? '').trim();
      if (t) types.add(t);
    }
  }
  return [...types].sort();
}

export function unsupportedBlocks(schema: unknown): string[] {
  return blockTypesOf(schema).filter((t) => !PRODUCTION_SAFE_BLOCK_TYPES.has(t));
}

/**
 * Every `{{path}}` referenced in the template, filters stripped and sorted.
 *
 * `{{=name}}` is a computed field evaluated from other data, not a binding the
 * report has to supply, so it is excluded — listing it would tell a user to
 * provide something the template calculates for itself.
 */
export function requiredBindingsOf(schema: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) {
        const path = m[1].trim();
        if (path && !path.startsWith('=')) found.add(path);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(schema);
  return [...found].sort();
}

// ── The template invariant, mechanically (audit F13) ─────────────────────────
//
// A template FORMATS data; it never COMPUTES it. The programme's whole
// invariant — the template controls presentation and can never alter a
// figure — was process-enforced only: `{{= financials.annualNet * 1.1 }}`
// passed the expression evaluator's character whitelist, so an approved
// template could print a number no engine produced. These helpers make the
// rule mechanical, and they are deliberately strict:
//
//  * Selection stays legal: ternaries, comparisons, `&&`/`||` presence logic
//    (`{{= financials.annualNet > 0 ? 'surplus' : 'shortfall' }}`) choose
//    between values the engine supplied.
//  * Arithmetic over ANY data reference is refused — not only the financial
//    namespaces, because a computed figure under `property.*` is as much a
//    fabrication as one under `financials.*`. Measured before writing this:
//    zero expressions in the 543-template catalogue or the block library use
//    arithmetic at all, so strictness costs nothing today.
//  * Even `financials.x > -1` is refused (the `-` is arithmetic to this
//    rule); write `>= 0`. A slightly stricter refusal beats a parser.
//  * Pure-literal arithmetic (`{{= 1 + 1 }}`) stays legal: no data is
//    touched, so nothing can be misstated.

const ARITHMETIC_OPERATOR = /[+\-*/%]/;
const EXPRESSION_LITERALS = new Set(['true', 'false', 'null', 'undefined']);

/** True when the expression applies arithmetic to something read from data. */
export function expressionComputesOverData(expr: unknown): boolean {
  const withoutStrings = String(expr ?? '').replace(/'[^']*'|"[^"]*"/g, ' ');
  if (!ARITHMETIC_OPERATOR.test(withoutStrings)) return false;
  for (const match of withoutStrings.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    if (!EXPRESSION_LITERALS.has(match[0])) return true;
  }
  return false;
}

/**
 * Every expression a schema evaluates: inline `{{= … }}` heads (filters
 * split exactly as the resolver splits them) and `tokens.computed[].expr`.
 */
export function templateExpressionsOf(schema: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
        const head = m[1].split('|')[0].trim();
        if (head.startsWith('=')) found.push(head.slice(1).trim());
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(schema);
  const computed = (schema as any)?.tokens?.computed;
  if (Array.isArray(computed)) {
    for (const field of computed) {
      const expr = String(field?.expr ?? '').trim();
      if (expr) found.push(expr);
    }
  }
  return found;
}

/** The expressions in this schema that compute over data — empty when the invariant holds. */
export function dataArithmeticIn(schema: unknown): string[] {
  return templateExpressionsOf(schema).filter(expressionComputesOverData);
}

const COLOUR_KEY = /(colou?r|fill|stroke|bg|background|accent|shadow|border)/i;
const COLOUR_LITERAL = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i;

/**
 * True when no colour is hard-coded, so a partner brand applies in full.
 *
 * `token:*` and `{{binding}}` values are brand-safe by definition. The
 * `tokens` map is skipped — literal colours are exactly what a token
 * definition is for, and flagging them would make every template unsafe.
 */
export function isBrandSafe(schema: unknown): boolean {
  let safe = true;
  const walk = (node: unknown, key?: string): void => {
    if (!safe) return;
    if (typeof node === 'string') {
      if (key && COLOUR_KEY.test(key) && COLOUR_LITERAL.test(node.trim())) safe = false;
      return;
    }
    if (Array.isArray(node)) { node.forEach((v) => walk(v, key)); return; }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  const { tokens: _skip, ...rest } = (schema && typeof schema === 'object' ? schema : {}) as Record<string, unknown>;
  walk(rest);
  return safe;
}

/**
 * Whether a copy of this template could ever be activated for live report
 * generation. Both conditions are enforced elsewhere by `manage-templates`;
 * evaluating them here is what lets the library say so on the card instead of
 * letting a user find out from a 422 after an afternoon of edits.
 */
export function isProductionReady(reportType: unknown, schema: unknown): boolean {
  const key = String(reportType ?? '').trim().toLowerCase();
  if (!key || !PRODUCTION_REPORT_TEMPLATE_TYPES.has(key)) return false;
  return unsupportedBlocks(schema).length === 0;
}

/** Page-1-only schema with base64 payloads stripped, for the SVG card thumbnail. */
export function buildPreviewSchema(schema: unknown): unknown {
  const first = pagesOf(schema)[0];
  if (!first) return null;
  const strip = (node: unknown): unknown => {
    if (typeof node === 'string') return node.startsWith('data:') ? '' : node;
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, strip(v)]));
    }
    return node;
  };
  return {
    version: SUPPORTED_TEMPLATE_SCHEMA_VERSION,
    tokens: (schema as any)?.tokens ?? {},
    pages: [strip(first)],
  };
}

export function slugify(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'template';
}

// ── Derived facts ────────────────────────────────────────────────────────────

export interface DerivedEntryFacts {
  page_count: number;
  supported_modules: string[];
  required_bindings: string[];
  brand_safe: boolean;
  production_ready: boolean;
  compatibility_version: number;
  orientation: 'portrait' | 'landscape';
  preview_schema: unknown;
}

/**
 * Recompute every derived field from the schema.
 *
 * Always called server-side on write, never populated from the request body: a
 * caller that could set `production_ready` could make a preview-only template
 * claim it drives live reports.
 */
export function deriveEntryFacts(entry: Record<string, unknown>): DerivedEntryFacts {
  const schema = entry?.schema ?? {};
  const first = pagesOf(schema)[0];
  const width = Number(first?.size?.width ?? 595);
  const height = Number(first?.size?.height ?? 842);
  return {
    page_count: pagesOf(schema).length,
    supported_modules: blockTypesOf(schema),
    required_bindings: requiredBindingsOf(schema),
    brand_safe: isBrandSafe(schema),
    production_ready: isProductionReady(entry?.report_type, schema),
    compatibility_version: SUPPORTED_TEMPLATE_SCHEMA_VERSION,
    orientation: width > height ? 'landscape' : 'portrait',
    preview_schema: buildPreviewSchema(schema),
  };
}

// ── Publish gate ─────────────────────────────────────────────────────────────

export interface PublishProblem {
  code: string;
  message: string;
  detail?: unknown;
}

/** Blocking problems that stop an entry being published. Null when it may go. */
export function validateForPublish(entry: Record<string, unknown>): PublishProblem | null {
  const schema = entry?.schema;
  if (!schema || typeof schema !== 'object') {
    return { code: 'library_schema_invalid', message: 'Entry has no template schema.' };
  }
  if (pagesOf(schema).length === 0) {
    return { code: 'library_schema_empty', message: 'A published template must have at least one page.' };
  }
  const unsupported = unsupportedBlocks(schema);
  if (unsupported.length > 0) {
    return {
      code: 'library_renderer_blocked',
      message: 'Template contains block types without production renderer support.',
      detail: unsupported.slice(0, 20),
    };
  }
  const computing = dataArithmeticIn(schema);
  if (computing.length > 0) {
    return {
      code: 'library_template_computes',
      message: 'A template formats data; it never computes it. Remove the arithmetic from these expressions.',
      detail: computing.slice(0, 20),
    };
  }
  if (!String(entry?.name ?? '').trim()) {
    return { code: 'library_name_required', message: 'A published template must have a name.' };
  }
  if (!String(entry?.slug ?? '').trim()) {
    return { code: 'library_slug_required', message: 'A published template must have a slug.' };
  }
  return null;
}

// ── Working-copy payload ─────────────────────────────────────────────────────

/** Metadata a superadmin may set on a draft. Everything else is derived or fixed. */
export const EDITABLE_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'long_description', 'category', 'report_type', 'tier',
  'variant', 'industry', 'tags', 'style', 'page_size', 'access_tier',
  'schema', 'config', 'custom_css', 'thumbnail_path', 'preview_image_paths',
  'design_meta',
]);

export function pickEditable(input: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (EDITABLE_ENTRY_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// ── Colourway selection ──────────────────────────────────────────────────────

/** The design family an entry belongs to, or null if it is not a family entry. */
export function familyKeyOf(entry: Record<string, unknown>): string | null {
  const meta = entry?.design_meta;
  if (!meta || typeof meta !== 'object') return null;
  const key = (meta as Record<string, unknown>).familyKey;
  return typeof key === 'string' && key ? key : null;
}

/** The colourway ids this entry offers, in the approved order. */
export function offeredColourwayIds(entry: Record<string, unknown>): string[] {
  const meta = entry?.design_meta;
  if (!meta || typeof meta !== 'object') return [];
  const ids = (meta as Record<string, unknown>).colourways;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export interface ColourwaySelection {
  colourway: ApprovedColourway | null;
  problem: PublishProblem | null;
}

/**
 * Resolve the colourway a copy should be baked in.
 *
 * Validated against **this entry's own curated list**, not against the global
 * registry. A colourway id is only meaningful inside the family that curated
 * it, and accepting any known id would let a request paint a Private Banking
 * master in a palette from a family that never approved the pairing.
 *
 * Three outcomes, all deliberate:
 *   - no id requested → the family default, or null for a non-family entry
 *     (which then keeps whatever tokens its schema already carries);
 *   - a requested id the entry offers → that colourway;
 *   - anything else → a problem. Never a silent fallback to the default:
 *     a user who picked Oxblood Night and got Gold on Obsidian would only
 *     find out after opening the copy in the Builder.
 */
export function resolveRequestedColourway(
  entry: Record<string, unknown>,
  requestedId: unknown,
): ColourwaySelection {
  const familyKey = familyKeyOf(entry);
  const requested = typeof requestedId === 'string' ? requestedId.trim() : '';

  if (!familyKey) {
    if (requested) {
      return {
        colourway: null,
        problem: {
          code: 'colourway_not_supported',
          message: 'This template does not belong to a design family, so it has no colourways.',
        },
      };
    }
    return { colourway: null, problem: null };
  }

  if (!requested) {
    return { colourway: defaultColourwayFor(familyKey), problem: null };
  }

  if (!offeredColourwayIds(entry).includes(requested)) {
    return {
      colourway: null,
      problem: {
        code: 'colourway_not_offered',
        message: `"${requested}" is not one of this template's colourways.`,
      },
    };
  }

  const colourway = findColourway(familyKey, requested);
  if (!colourway) {
    return {
      colourway: null,
      problem: {
        code: 'colourway_unknown',
        message: `Colourway "${requested}" is not registered for family "${familyKey}".`,
      },
    };
  }
  return { colourway, problem: null };
}

export interface WorkingCopyRequest {
  /** Verified session user id. Never taken from the request body. */
  userId: string;
  /** User-supplied display name, already trimmed. */
  name: string;
  /** User-supplied description, optional. */
  description?: string | null;
  /** The published library entry being copied. */
  entry: Record<string, unknown>;
  /** Validated + migrated schema. */
  schema: unknown;
  /**
   * Colourway to bake into the copy's tokens. Resolved server-side by
   * `resolveRequestedColourway`; never taken from the request body directly.
   */
  colourway?: ApprovedColourway | null;
}

/**
 * The row inserted into `report_templates` for a working copy.
 *
 * Every field that could make a template reach a customer is fixed here rather
 * than being merged from the caller. `manage-templates`' generic insert branch
 * performs no validation — `validateReportTemplateUpdate` is wired only into
 * `update` — so a client-built payload could name its own `is_active`,
 * `scope` or `owner_user_id`. Building the row server-side removes that
 * possibility instead of relying on the client to behave.
 */
export function buildWorkingCopyPayload(req: WorkingCopyRequest): Record<string, unknown> {
  const { entry } = req;

  // Bake the colourway into the copy's own tokens rather than referencing it.
  //
  // That is what makes the choice survive everywhere without any downstream
  // system needing to know colourways exist: the Template Builder, the
  // WeasyPrint PDF and live report generation all see an ordinary template that
  // happens to be that colour. A reference would have meant teaching three
  // pipelines to resolve one, and a copy whose appearance could change later —
  // which is exactly what the library's snapshot rule exists to prevent.
  const coloured = req.colourway
    ? applyColourwayToSchema(req.schema, req.colourway)
    : req.schema;

  /*
   * The disclaimer belongs to the deployment, and a copy is taken at a moment
   * in time.
   *
   * That is not hypothetical: the eight formats activated on 14 Aug took
   * `e.schema` verbatim, v7 bound `{{org.disclaimer}}` in the catalogue on the
   * 15th, and the twelve live templates kept the pre-v7 literal — which the
   * block renderer then honours for ever, because it only reaches its fallback
   * when the binding resolves empty. Binding here means a copy from a stale
   * entry, an old export or an operator's paste all end up reading Report
   * Settings, and the literal they arrived with becomes the fallback rather
   * than being thrown away. See `reports/disclaimerBinding.pure.ts`.
   */
  const schema = bindOrganisationDisclaimer(coloured);

  const meta = (entry.design_meta && typeof entry.design_meta === 'object')
    ? entry.design_meta as Record<string, unknown>
    : {};

  const baseConfig = (entry.config && typeof entry.config === 'object')
    ? entry.config as Record<string, unknown>
    : {};

  // Lineage a person can read months later, on the copy itself. The library's
  // own `template_library_instantiations` row records which ENTRY was copied;
  // this records what it was copied AS — the family, the variant and the
  // colourway — which that row cannot know.
  //
  // Written for EVERY entry, family or not.
  //
  // It used to be written only where `meta.familyKey` existed, on the
  // reasoning that a voice template has no family, no variant axis and no
  // colourway and would carry eleven null fields for nothing. The eleven
  // fields are not what the block is for: `entryId` is, and four separate
  // readers key identity on it — the picker's stored-choice resolution, its
  // "is this the current one" mark, `matchesReportUseCopy` below (which
  // opens `if (!lineage) return false`) and the SQL filter on
  // `config->libraryLineage->>entryId` that the adopt path dedupes with.
  //
  // So a voice template adopted for reports came back lineage-less: the
  // library tile was not marked current, the same design appeared a second
  // time under the standalone templates, and because nothing could match it,
  // every press of Save minted ANOTHER active `report_templates` row. Forty
  // three designs round-tripped that way.
  const config = {
    ...baseConfig,
    libraryLineage: {
      entryId: entry.id ?? null,
      entrySlug: entry.slug ?? null,
      entryVersion: entry.version ?? null,
      familyKey: meta.familyKey ?? null,
      familyName: meta.familyName ?? null,
      templateCode: meta.templateCode ?? null,
      variantAxis: meta.variantAxis ?? null,
      density: meta.density ?? null,
      colourway: req.colourway?.id ?? null,
      colourwayName: req.colourway?.name ?? null,
      ground: req.colourway?.ground ?? null,
    },
  };

  return {
    name: req.name,
    description: req.description ?? (entry.description as string | null) ?? null,
    schema,
    // report_templates.config is NOT NULL.
    config,
    custom_css: entry.custom_css ?? null,
    report_type: entry.report_type ?? null,
    tier: entry.tier ?? null,
    variant: entry.variant ?? null,
    engine: entry.engine ?? 'weasyprint',

    // Nothing about a fresh copy is live.
    version: 1,
    is_active: false,
    is_default: false,
    is_draft: true,
    approval_status: 'draft',
    locked_for_review: false,
    locked_at: null,
    locked_by: null,
    priority: 0,

    // parent_template_id is an FK to report_templates; a library entry is not
    // in that table, so lineage lives in template_library_instantiations.
    parent_template_id: null,

    // created_by is an FK to auth.users, and this platform's custom-auth ids
    // are not in auth.users — stamping one violates the constraint. Same
    // decision as TemplateBranchingDialog.tsx:91-94.
    created_by: null,

    // The copy belongs to whoever made it. owner_user_id has no FK, so a
    // custom_users id is valid, and applyReportTemplateReadScope in
    // manage-templates already limits non-superadmin reads to
    // `scope='global' OR (scope='user' AND owner_user_id = me)`.
    scope: 'user',
    owner_user_id: req.userId,
    agency_id: null,
  };
}

// ── Using an entry for report generation ─────────────────────────────────────

/**
 * Whether this entry may back live report generation directly.
 *
 * Stricter than instantiation on purpose. A working copy is an editing
 * artefact — anything published may be copied and worked on. A report-use copy
 * goes straight into the caller's selectable set, so it must already be the
 * whole of what the activation gate would check: a production report type, a
 * schema of production-safe blocks, and the WeasyPrint engine. Refusing here is
 * a 422 with a reason; refusing at render time is a silent legacy fallback the
 * user would read as "my choice did nothing".
 */
export function validateEntryForReportUse(
  entry: Record<string, unknown>,
): PublishProblem | null {
  if (entry.status !== 'published') {
    return { code: 'not_published', message: 'Only published templates can be used for reports.' };
  }
  if (String(entry.engine ?? 'weasyprint').toLowerCase() !== 'weasyprint') {
    return {
      code: 'engine_not_supported',
      message: 'This template is not rendered by the design system, so choosing it would not change your documents.',
    };
  }
  if (entry.production_ready !== true) {
    return {
      code: 'not_production_ready',
      message: 'This template is preview-only and cannot generate live reports yet.',
    };
  }
  const key = String(entry.report_type ?? '').trim().toLowerCase();
  if (!key || !PRODUCTION_REPORT_TEMPLATE_TYPES.has(key)) {
    return {
      code: 'format_not_production',
      message: `"${key || 'untyped'}" does not have a production report pipeline yet.`,
    };
  }
  return null;
}

/**
 * The colourway id a report-use copy is recorded under.
 *
 * The entry's default colourway maps to **null** — "the authored palette,
 * unbaked" — for the same reason `instantiate` without a `colourwayId` bakes
 * nothing: the stored schema already carries it. This is also what makes reuse
 * find the globally seeded masters, whose lineage records `colourway: null`;
 * treating "the default, explicitly" and "the default, implicitly" as different
 * choices would mint a duplicate copy of a template the user already has.
 */
export function normaliseRequestedColourwayId(
  entry: Record<string, unknown>,
  requestedId: unknown,
): string | null {
  const requested = String(requestedId ?? '').trim();
  if (!requested) return null;
  const meta = (entry.design_meta && typeof entry.design_meta === 'object')
    ? entry.design_meta as Record<string, unknown>
    : {};
  return requested === String(meta.defaultColourway ?? '') ? null : requested;
}

export interface ReportUseCopyRequest {
  /** Verified session user id. Never taken from the request body. */
  userId: string;
  /** The published library entry being adopted. */
  entry: Record<string, unknown>;
  /** Validated + migrated schema. */
  schema: unknown;
  /** Resolved server-side; null bakes nothing and ships the authored palette. */
  colourway?: ApprovedColourway | null;
}

/**
 * The row a "use for my reports" adoption inserts into `report_templates`.
 *
 * Built ON TOP of `buildWorkingCopyPayload` so the two copies cannot drift:
 * the schema handling, the colourway bake, the `libraryLineage` block and the
 * FK decisions are all inherited. Three fields differ, and each is the point:
 *
 * - **`is_active: true`, `is_draft: false`** — the copy exists to be selectable
 *   and resolvable, not to be edited first.
 * - **`approval_status: 'approved'`** — the state `insertGoesLive` requires.
 *   The review it claims happened is the library's own publish gate, which
 *   `validateEntryForReportUse` has just re-checked; a user-scoped row affects
 *   only its owner's documents, which is why this does not need the
 *   superadmin approval a global activation does.
 *
 * The name is built here rather than taken from the caller: the copy is not
 * the user's document, it is a catalogue design they picked, and it should be
 * recognisable as such in every list it appears in.
 */
export function buildReportUseCopyPayload(req: ReportUseCopyRequest): Record<string, unknown> {
  const { entry } = req;
  const meta = (entry.design_meta && typeof entry.design_meta === 'object')
    ? entry.design_meta as Record<string, unknown>
    : {};

  const familyName = String(meta.familyName ?? '').trim();
  const baseName = String(entry.name ?? 'Template').trim();
  const name = (familyName ? `${familyName} — ${baseName}` : baseName)
    + (req.colourway ? ` · ${req.colourway.name}` : '');

  return {
    ...buildWorkingCopyPayload({
      userId: req.userId,
      name: name.slice(0, MAX_WORKING_COPY_NAME),
      description: (entry.description as string | null) ?? null,
      entry,
      schema: req.schema,
      colourway: req.colourway ?? null,
    }),
    is_active: true,
    is_draft: false,
    approval_status: 'approved',
  };
}

/**
 * Whether an existing `report_templates` row already IS this adoption.
 *
 * Matched on lineage — entry, entry version, colourway — never on name, which
 * is display text. A version bump in the library deliberately does not match:
 * the user picked the design as it is now, and reusing a copy of the previous
 * version would hand them a document the library no longer shows.
 */
export function matchesReportUseCopy(
  row: Record<string, unknown>,
  entry: Record<string, unknown>,
  colourwayId: string | null,
): boolean {
  if (row?.is_active !== true || row?.is_draft === true) return false;
  const config = (row?.config && typeof row.config === 'object')
    ? row.config as Record<string, unknown>
    : {};
  const lineage = (config.libraryLineage && typeof config.libraryLineage === 'object')
    ? config.libraryLineage as Record<string, unknown>
    : null;
  if (!lineage) return false;
  return lineage.entryId === entry.id
    && Number(lineage.entryVersion ?? -1) === Number(entry.version ?? -2)
    && ((lineage.colourway ?? null) === (colourwayId ?? null));
}

// ── Name validation ──────────────────────────────────────────────────────────

export const MAX_WORKING_COPY_NAME = 200;

export function validateWorkingCopyName(raw: unknown): PublishProblem | null {
  const name = String(raw ?? '').trim();
  if (!name) return { code: 'name_required', message: 'A name for the working copy is required.' };
  if (name.length > MAX_WORKING_COPY_NAME) {
    return {
      code: 'name_too_long',
      message: `Name must be ${MAX_WORKING_COPY_NAME} characters or fewer.`,
    };
  }
  return null;
}

// ── Draft transitions ────────────────────────────────────────────────────────

export type EntryStatus = 'draft' | 'in_review' | 'published' | 'deprecated' | 'archived';

/**
 * Whether editing this entry must fork a new version rather than mutate in
 * place. Published entries are immutable so a copy already taken always points
 * at an unchanging snapshot.
 */
export function editRequiresNewVersion(status: unknown): boolean {
  return status === 'published';
}

/** The next-version draft row created when a published entry is edited. */
export function buildNextVersionDraft(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  userId: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...current,
    ...patch,
    version: Number(current.version ?? 1) + 1,
    status: 'draft',
    published_at: null,
    deprecated_at: null,
    // Usage belongs to the version that earned it.
    usage_count: 0,
    last_used_at: null,
    created_by_user_id: userId,
  };
  delete next.id;
  delete next.created_at;
  delete next.updated_at;
  Object.assign(next, deriveEntryFacts(next));
  return next;
}

export function statusForLifecycleOperation(operation: string): EntryStatus | null {
  if (operation === 'archive') return 'archived';
  if (operation === 'deprecate') return 'deprecated';
  if (operation === 'restore') return 'draft';
  return null;
}
