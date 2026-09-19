/**
 * Template composition — a chosen template that cannot carry the report gets
 * the report body composed into it.
 *
 * ## The rule
 *
 * A template is two things at once: a DESIGN (its tokens — palette, typefaces,
 * radii, spacing — and its furniture: cover, running heads, closing page) and a
 * set of PAGES bound to a vocabulary. When a person chooses a template whose
 * pages bind nothing this report publishes (`templateBindingCoverage.pure.ts`),
 * honouring the choice means honouring the design: the chosen template's cover
 * and closing pages are kept, its content pages that resolve nothing are left
 * out, and the report body is drawn from a donor that does carry it — a family
 * master for the format — under the chosen template's tokens. Both kinds of
 * template share one token contract (`TokensSchema`), which is what makes the
 * palette portable; a token the chosen template does not declare falls back to
 * the donor's, so a block naming `token:info` never prints the literal.
 *
 * ## The cover must speak for THIS report
 *
 * A cover is the page that says what the document IS, and it is the one page
 * whose static words the coverage measure cannot judge: text between bindings
 * is invisible to it. Measured on 16 Sep 2026, the First-Home Buyer Report's
 * cover shipped as page 1 of an Investment report reading "FIRST HOME / Your
 * First Property" — its only bindings are the tenant's own mark
 * (`org.markMono`, which resolves on every report of every format) and
 * `client.name` (the ADDRESSEE, which resolves on every format prepared for
 * that person), so nothing on it could ever say which document it fronts, and
 * its static words claimed a different one. The rule: **a chosen cover is kept
 * only where it resolves at least one binding that names this document** — a
 * path outside the tenant (`org`, `brand`) and addressee (`client`)
 * namespaces, such as `report.title` or `property.address`. A cover that
 * cannot is left out with the blank pages, and the donor's cover — which
 * carries the report's identity by construction — leads the document under
 * the merged tokens, so the choice still decides how page 1 LOOKS while the
 * record decides what it SAYS.
 *
 * ## What it never does
 *
 * It never invents a page: every page in the result exists in one of the two
 * templates. It never keeps a page that binds nothing of this report — five
 * near-empty pages under a letterhead was the defect. It never touches a
 * template that already carries the body: the composition is the fallback for
 * a design that cannot carry the report, not a restyling of one that can. And
 * it never changes a binding: the donor's pages resolve against the same data
 * the chosen template was measured against.
 *
 * Pure and Deno-parseable; the route validates the result through
 * `parseTemplate` before drawing it.
 */
import {
  bindsOnlyAbsences,
  measureBindingCoverage,
  type PageCoverage,
  type TemplateCoverage,
} from './templateBindingCoverage.pure.ts';

/**
 * A kept chosen page with every label that binds only absences blanked.
 *
 * "Prepared for {{client.name}}" on a cover whose report names no client
 * printed "Prepared for" and stopped. The binding resolves to the empty string
 * exactly as it should; the words around it are the template author's promise
 * of a value, and a promise the record cannot keep is left unprinted rather
 * than half-printed. Only strings that bind something are touched, and only
 * on the CHOSEN template's kept pages — the donor's pages carry their own
 * conditionals and are never rewritten.
 */
function scrubAbsentLabels(value: unknown, data: Record<string, unknown>): unknown {
  if (typeof value === 'string') return bindsOnlyAbsences(value, data) ? '' : value;
  if (Array.isArray(value)) return value.map((v) => scrubAbsentLabels(v, data));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubAbsentLabels(v, data);
    return out;
  }
  return value;
}

function scrubPage(page: ComposablePage, data: Record<string, unknown>): ComposablePage {
  if (!Array.isArray(page.blocks)) return page;
  return {
    ...page,
    blocks: (page.blocks as Array<Record<string, unknown>>).map((block) =>
      block && typeof block === 'object' && 'props' in block
        ? { ...block, props: scrubAbsentLabels(block.props, data) }
        : block),
  };
}

interface ComposablePage {
  id?: unknown;
  [key: string]: unknown;
}

export interface ComposableTemplate {
  name?: unknown;
  tokens?: Record<string, unknown>;
  pages?: unknown;
  slots?: Record<string, unknown>;
  pageMasters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CompositionResult {
  /** The composed template, a plain object for `parseTemplate`. */
  schema: ComposableTemplate;
  /** Chosen pages kept, in document order, with why. */
  kept: Array<{ name: string; kind: PageCoverage['kind'] }>;
  /** Chosen pages left out because nothing on them resolves. */
  dropped: Array<{ name: string; kind: PageCoverage['kind'] }>;
  /** Donor pages carried into the body (the donor's cover included, when it leads). */
  bodyPages: number;
  /**
   * Whose cover leads the document. `chosen` when the chosen cover names this
   * report; `donor` when it could not and the donor's cover stands in under
   * the merged tokens; `none` when neither template has one.
   */
  coverFrom: 'chosen' | 'donor' | 'none';
  chosen: TemplateCoverage;
  donor: TemplateCoverage;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Chosen tokens over donor tokens, one level deep. Objects (colors, fonts,
 * radii, spacing, typeScale) merge key by key so an undeclared token keeps the
 * donor's value; arrays (fontFaces) and scalars are the chosen template's when
 * it declares them and the donor's otherwise.
 */
export function mergeTokens(
  donor: Record<string, unknown> | undefined,
  chosen: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(donor ?? {}) };
  for (const [key, value] of Object.entries(chosen ?? {})) {
    if (value === undefined || value === null) continue;
    if (isObject(value) && isObject(out[key])) {
      out[key] = { ...(out[key] as Record<string, unknown>), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

const TEMPLATE_LEVEL_EXCLUDED = new Set(['name', 'tokens', 'pages', 'slots', 'pageMasters']);

/** Namespaces about the TENANT (letterhead) or the ADDRESSEE, never the document. */
const NON_IDENTITY_NAMESPACES: ReadonlySet<string> = new Set(['org', 'brand', 'client']);

/**
 * Does this cover resolve anything that names THIS document?
 *
 * The tenant's mark resolves on every report of every format, and the client's
 * name on every format prepared for that person — neither says which document
 * the page fronts, so neither can vouch for the cover's static words. Anything
 * else that resolves (`report.title`, `property.address`, a content field)
 * is this report speaking on its own cover.
 */
export function coverNamesThisReport(cover: PageCoverage): boolean {
  return cover.resolved.some((path) => {
    const m = /^([A-Za-z_$][\w$]*)/.exec(path);
    return !NON_IDENTITY_NAMESPACES.has(m ? m[1] : path);
  });
}

/**
 * Compose `chosen` over `donor` for this report's data.
 *
 * Returns null when the chosen template does not need composing (it resolves
 * content of its own, or binds nothing at all) or when the donor resolves no
 * content either (nothing to compose FROM); the caller names the second case
 * as a refusal rather than drawing anything.
 *
 * Kept from the chosen template: its cover, its closing pages, and any content
 * page that is not blank — a page of static prose binds nothing and prints as
 * written, and a page that resolves something of this report is the author's.
 * Left out: every page that binds content and resolves none of it.
 */
export function composeTemplateWithDonor(
  chosen: ComposableTemplate,
  donor: ComposableTemplate,
  data: Record<string, unknown>,
): CompositionResult | null {
  const chosenCov = measureBindingCoverage(chosen, data);
  if (!chosenCov.needsComposition) return null;
  const donorCov = measureBindingCoverage(donor, data);
  if (!donorCov.carriesContent) return null;

  const chosenPages = Array.isArray(chosen.pages) ? (chosen.pages as ComposablePage[]) : [];
  const donorPages = Array.isArray(donor.pages) ? (donor.pages as ComposablePage[]) : [];

  const front: ComposablePage[] = [];
  const back: ComposablePage[] = [];
  const kept: CompositionResult['kept'] = [];
  const dropped: CompositionResult['dropped'] = [];
  let chosenHasCover = false;
  for (const pc of chosenCov.pages) {
    const page = chosenPages[pc.index];
    if (pc.kind === 'cover') {
      // A cover that cannot name this report goes with the blank pages: its
      // static words were written for the vocabulary the template binds, and
      // nothing this report publishes can vouch for them. See the header.
      if (!coverNamesThisReport(pc)) { dropped.push({ name: pc.name, kind: pc.kind }); continue; }
      chosenHasCover = true;
      front.push(page); kept.push({ name: pc.name, kind: pc.kind }); continue;
    }
    if (pc.kind === 'closing') { back.push(page); kept.push({ name: pc.name, kind: pc.kind }); continue; }
    if (!pc.blank) { front.push(page); kept.push({ name: pc.name, kind: pc.kind }); continue; }
    dropped.push({ name: pc.name, kind: pc.kind });
  }

  const chosenHasClosing = back.length > 0;
  // The donor's cover LEADS when the chosen one was refused or absent — a
  // document's first page is its cover, whichever template donates it — and
  // it draws under the merged tokens, so the choice still decides the palette.
  const lead: ComposablePage[] = [];
  const body: ComposablePage[] = [];
  for (const pc of donorCov.pages) {
    if (pc.kind === 'cover') {
      if (!chosenHasCover) lead.push(donorPages[pc.index]);
      continue;
    }
    if (pc.kind === 'closing' && chosenHasClosing) continue;
    body.push(donorPages[pc.index]);
  }

  // Page ids must stay unique across the two sources.
  const seen = new Set<string>();
  const uniqueId = (page: ComposablePage, suffix: string): ComposablePage => {
    const id = typeof page.id === 'string' && page.id ? page.id : `page-${seen.size + 1}`;
    if (!seen.has(id)) { seen.add(id); return page.id === id ? page : { ...page, id }; }
    let candidate = `${id}-${suffix}`;
    let n = 2;
    while (seen.has(candidate)) candidate = `${id}-${suffix}-${n++}`;
    seen.add(candidate);
    return { ...page, id: candidate };
  };
  const pages = [
    ...lead.map((p) => uniqueId(p, 'body')),
    ...front.map((p) => uniqueId(scrubPage(p, data), 'chosen')),
    ...body.map((p) => uniqueId(p, 'body')),
    ...back.map((p) => uniqueId(scrubPage(p, data), 'chosen')),
  ];

  const schema: ComposableTemplate = {};
  for (const [key, value] of Object.entries(donor)) {
    if (!TEMPLATE_LEVEL_EXCLUDED.has(key)) schema[key] = value;
  }
  for (const [key, value] of Object.entries(chosen)) {
    if (!TEMPLATE_LEVEL_EXCLUDED.has(key) && value !== undefined) schema[key] = value;
  }
  schema.name = chosen.name ?? donor.name;
  schema.tokens = mergeTokens(donor.tokens, chosen.tokens);
  schema.pages = pages;
  schema.slots = { ...(donor.slots ?? {}), ...(chosen.slots ?? {}) };
  schema.pageMasters = { ...(donor.pageMasters ?? {}), ...(chosen.pageMasters ?? {}) };

  return {
    schema,
    kept,
    dropped,
    bodyPages: lead.length + body.length,
    coverFrom: chosenHasCover ? 'chosen' : lead.length > 0 ? 'donor' : 'none',
    chosen: chosenCov,
    donor: donorCov,
  };
}
