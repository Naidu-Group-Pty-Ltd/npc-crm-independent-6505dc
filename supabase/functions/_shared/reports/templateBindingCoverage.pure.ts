/**
 * Binding coverage — does this template bind anything THIS report publishes?
 *
 * ## The defect this measures
 *
 * On 15 Sep 2026 a person chose the library's "First-Home Buyer Report" for an
 * Investment report and received five pages: a cover reading "Prepared for"
 * with no name after it, three pages carrying only their headings, and a
 * disclaimer. The template is seeded against a sample preset — `client.deposit`,
 * `finance.capacity`, `grants.fhog`, `steps.0` — a vocabulary no adapter has
 * ever published, and every one of those bindings resolved to the empty string.
 * Nothing refused it: `refuseUnboundReconstruction` catches a static copy of one
 * client's report, and the route's empty-context guard catches an adapter that
 * published nothing. A template that binds the WRONG things was invisible to
 * both, and it shipped under the tenant's own letterhead.
 *
 * So the measure is taken against the data the adapter actually built, never
 * against a sample: every bound path is resolved exactly as the renderer would
 * resolve it, and a page is classified by what it is FOR (a cover, a closing
 * page, a content page) and by whether any of its content resolves.
 *
 * ## Two questions, kept apart
 *
 * *Coverage* — how many of the template's bound paths resolve — is a number
 * for an operator. *Carrying the body* — whether any page binds the report's
 * narrative — is the decision the route acts on: a template that carries the
 * body is drawn as designed, whatever its coverage elsewhere; one that does
 * not is composed over a donor that does (`templateComposition.pure.ts`).
 * Deciding on the number would have refused a family master with a few stale
 * bindings and accepted a five-page cover set that happened to bind the
 * address in its footer.
 *
 * Pure: no imports beyond the shared presence rule, parses under Deno, and
 * reads no clock.
 */
import { presenceOf } from './contract/visibilityPolicy.pure.ts';

/** The same syntax `bindingResolver.ts` resolves: `{{ path | filter }}`. */
export const BINDING_PATH_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** A data path the resolver can walk: dotted, with `[n]` or `.n` indices. */
const PATH_RE = /^[A-Za-z_$][\w$]*(?:(?:\.[\w$]+)|(?:\[\w+\]))*$/;

/** Dotted identifiers inside a conditional expression, e.g. `narrative.pages > 3`. */
const CONDITIONAL_PATH_RE = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g;

/**
 * Props whose bare string value is a data path rather than a binding — the
 * chart blocks name their series this way (`dataPath: "finance.rateScenarios"`).
 */
const BARE_PATH_PROPS = new Set(['dataPath', 'seriesPath', 'itemsPath', 'rowsPath', 'sourcePath']);

/**
 * Namespaces every adapter publishes about the DOCUMENT rather than about the
 * report's findings. A page whose only resolvable binding is the letterhead or
 * the address in its running foot is not carrying content.
 */
export const FURNITURE_NAMESPACES: ReadonlySet<string> = new Set([
  'org', 'brand', 'report', 'meta', 'tier', 'variant', 'client',
]);

/** Block types that are page furniture whatever they bind. */
export const FURNITURE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'footer', 'page-number', 'running-head', 'header', 'page-header', 'slot',
  'toc', 'auto-toc', 'divider', 'spacer', 'watermark', 'rule',
]);

/** Paths that mean a page draws the report's own narrative. */
export const BODY_NAMESPACES: ReadonlyArray<string> = ['narrative.', 'sections.'];

export type PageKind = 'cover' | 'closing' | 'content' | 'furniture';

export interface PageCoverage {
  index: number;
  id: string;
  name: string;
  kind: PageKind;
  /** Every distinct path this page binds, in first-seen order. */
  bound: string[];
  /** The subset that resolves to a present value on this report. */
  resolved: string[];
  /** Paths bound on non-furniture blocks, outside the furniture namespaces. */
  contentBound: string[];
  /** The subset of `contentBound` that resolves. */
  contentResolved: string[];
  /**
   * The page binds content and none of it resolves — the page would print its
   * headings over empty values. A page that binds nothing (static prose) is
   * NOT blank: it prints exactly what its author wrote.
   */
  blank: boolean;
  /** Whether any resolved path is one of the body namespaces. */
  carriesBody: boolean;
}

export interface TemplateCoverage {
  pages: PageCoverage[];
  /** Distinct paths bound anywhere in the template. */
  bound: string[];
  resolved: string[];
  /** `resolved / bound`, 0 when nothing is bound. */
  coverage: number;
  /** Distinct content paths (non-furniture blocks, non-furniture namespaces). */
  contentBound: string[];
  contentResolved: string[];
  /** Whether any page draws the report body (a narrative format's `narrative.*`). */
  carriesBody: boolean;
  /** Whether any content page resolves anything of this report. */
  carriesContent: boolean;
  /**
   * The decision the route acts on: the template binds content and NONE of it
   * resolves on this report. That is the First-Home Buyer pathology exactly —
   * forty-one bindings to a vocabulary the format never publishes — and
   * nothing else: a template that binds nothing is a brochure and is drawn as
   * designed; one that resolves even one content field is the author's
   * document and is drawn as designed, blank pages and all being their call.
   */
  needsComposition: boolean;
}

interface BlockLike {
  type?: unknown;
  props?: unknown;
  conditional?: unknown;
}

interface PageLike {
  id?: unknown;
  name?: unknown;
  blocks?: unknown;
  conditional?: unknown;
  background?: unknown;
}

export interface TemplateLike {
  pages?: unknown;
}

/** `getByPath` as the resolver walks it: `a.b[0].c` → a, b, 0, c. */
export function getByPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  return parts.reduce<unknown>(
    (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key.trim()]),
    obj,
  );
}

function namespaceOf(path: string): string {
  const m = /^([A-Za-z_$][\w$]*)/.exec(path);
  return m ? m[1] : path;
}

/** Bound paths in one string: the head of each `{{…}}`, computed forms skipped. */
export function pathsInString(value: string): string[] {
  const out: string[] = [];
  if (!value.includes('{{')) return out;
  for (const m of value.matchAll(BINDING_PATH_RE)) {
    const head = m[1].split('|')[0].trim();
    if (!head || head.startsWith('=') || head.startsWith('@')) continue;
    if (PATH_RE.test(head)) out.push(head);
  }
  return out;
}

/** Dotted data paths a conditional reads. Bare namespaces are not counted. */
export function pathsInConditional(expr: unknown): string[] {
  if (typeof expr !== 'string' || !expr.trim()) return [];
  return Array.from(expr.matchAll(CONDITIONAL_PATH_RE), (m) => m[0]);
}

function walk(value: unknown, key: string | null, out: string[]): void {
  if (typeof value === 'string') {
    if (key && BARE_PATH_PROPS.has(key) && !value.includes('{{') && PATH_RE.test(value.trim())) {
      out.push(value.trim());
      return;
    }
    out.push(...pathsInString(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, null, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, k, out);
  }
}

/** Every path a block binds: its props, and its own conditional. */
export function pathsInBlock(block: BlockLike): string[] {
  const out: string[] = [];
  walk(block.props, null, out);
  out.push(...pathsInConditional(block.conditional));
  return out;
}

const uniq = (xs: string[]): string[] => Array.from(new Set(xs));

function blockType(block: BlockLike): string {
  return typeof block.type === 'string' ? block.type : '';
}

/**
 * What a page is for.
 *
 * A cover is a `cover` block, a first page built on a `hero` (the family
 * masters compose their covers that way — a hero plate, a wordmark and the
 * address in text blocks, no `cover` block anywhere), or a page the author
 * named "Cover". A closing page carries a `disclaimer` or is named as one.
 * Everything else is content, unless every block on it is furniture.
 */
export function classifyPage(page: PageLike, index = 0): PageKind {
  const blocks = Array.isArray(page.blocks) ? (page.blocks as BlockLike[]) : [];
  const types = blocks.map(blockType);
  const name = typeof page.name === 'string' ? page.name.trim() : '';
  if (types.includes('disclaimer') || /\b(disclaimer|important information|colophon|back cover)\b/i.test(name)) {
    return 'closing';
  }
  if (types.includes('cover') || /^cover\b/i.test(name) || (index === 0 && types.includes('hero'))) {
    return 'cover';
  }
  if (types.length && types.every((t) => FURNITURE_BLOCK_TYPES.has(t))) return 'furniture';
  return 'content';
}

/**
 * A string prop that binds only absences.
 *
 * "Prepared for {{client.name}}" on a cover whose report has no client prints
 * "Prepared for" and nothing — a label promising a value the page does not
 * hold. The resolver renders each absent binding as the empty string, which
 * is right for the binding and wrong for the sentence around it. A prop is
 * unresolvable when it binds at least one path and none of them resolve.
 */
export function bindsOnlyAbsences(value: string, data: Record<string, unknown>): boolean {
  const paths = pathsInString(value);
  if (!paths.length) return false;
  return paths.every((p) => !isResolved(data, p));
}

function isResolved(data: Record<string, unknown>, path: string): boolean {
  return presenceOf(getByPath(data, path)) !== 'absent';
}

/**
 * Measure one template against the data an adapter built for one report.
 *
 * Pages are read in order; a page's own conditional counts among its bindings,
 * because a page whose conditional reads `narrative.pages` is a page about the
 * narrative whether or not a block on it says so.
 */
export function measureBindingCoverage(
  template: TemplateLike,
  data: Record<string, unknown>,
): TemplateCoverage {
  const pages = Array.isArray(template.pages) ? (template.pages as PageLike[]) : [];
  const perPage: PageCoverage[] = pages.map((page, index) => {
    const blocks = Array.isArray(page.blocks) ? (page.blocks as BlockLike[]) : [];
    const bound: string[] = [];
    const contentBound: string[] = [];
    for (const block of blocks) {
      const paths = pathsInBlock(block);
      bound.push(...paths);
      if (!FURNITURE_BLOCK_TYPES.has(blockType(block))) {
        contentBound.push(...paths.filter((p) => !FURNITURE_NAMESPACES.has(namespaceOf(p))));
      }
    }
    bound.push(...pathsInConditional(page.conditional));
    const bg: string[] = [];
    walk(page.background, null, bg);
    bound.push(...bg);
    const boundU = uniq(bound);
    const resolved = boundU.filter((p) => isResolved(data, p));
    const contentBoundU = uniq(contentBound);
    const contentResolved = contentBoundU.filter((p) => isResolved(data, p));
    const kind = classifyPage(page, index);
    return {
      index,
      id: typeof page.id === 'string' ? page.id : String(index),
      name: typeof page.name === 'string' ? page.name : `Page ${index + 1}`,
      kind,
      bound: boundU,
      resolved,
      contentBound: contentBoundU,
      contentResolved,
      blank: kind === 'content' && contentBoundU.length > 0 && contentResolved.length === 0,
      carriesBody: resolved.some((p) => BODY_NAMESPACES.some((ns) => p.startsWith(ns))),
    };
  });
  const bound = uniq(perPage.flatMap((p) => p.bound));
  const resolved = uniq(perPage.flatMap((p) => p.resolved));
  const contentPages = perPage.filter((p) => p.kind === 'content');
  const contentBoundAll = uniq(contentPages.flatMap((p) => p.contentBound));
  const contentResolvedAll = uniq(contentPages.flatMap((p) => p.contentResolved));
  return {
    pages: perPage,
    bound,
    resolved,
    coverage: bound.length ? Number((resolved.length / bound.length).toFixed(4)) : 0,
    contentBound: contentBoundAll,
    contentResolved: contentResolvedAll,
    carriesBody: perPage.some((p) => p.carriesBody),
    carriesContent: contentResolvedAll.length > 0,
    needsComposition: contentBoundAll.length > 0 && contentResolvedAll.length === 0,
  };
}
