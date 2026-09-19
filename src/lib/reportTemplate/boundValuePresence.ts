/**
 * Did a bound string actually receive a value?
 *
 * A master authors a field as a sentence with holes in it —
 * `'{{recommendation.grade}} · {{recommendation.score | fixed:0}} out of 100'`
 * — and `resolveBindable` honours this renderer's contract by resolving an
 * absent binding to the EMPTY STRING rather than to a visible `{{…}}`. That is
 * right, and on its own it is not enough: what reaches the page is then the
 * author's punctuation and boilerplate with nothing between it. On the
 * certification record that printed
 *
 *     Assessment grade   · out of 100
 *
 * which is a label, a separator and a unit describing no figure. The client
 * cannot tell it from a broken page.
 *
 * The rule this module states is the one the mandate asks for: where an
 * authoritative value does not exist, **omit the presentation element** rather
 * than drawing its frame. Answering that needs one fact the resolved string
 * alone does not carry — did any binding contribute anything? — so it is asked
 * of the resolver rather than inferred from the output. Nothing here inspects
 * the rendered text for placeholder words, and nothing here post-processes: a
 * `.replace(/N\/A/g, '')` over finished output is what this exists instead of.
 *
 * Static text is always kept. An author who typed a sentence with no binding
 * in it said exactly what they meant, and that is not this module's business.
 */
import { resolveBindable, type ResolveContext } from './bindingResolver';

/** Matches `bindingResolver`'s own `BINDING_RE`, which is private to it. */
const BINDING_RE_G = /\{\{\s*([^}]+?)\s*\}\}/g;

/**
 * True when `raw` is worth drawing: it is static text, or at least one of its
 * bindings resolved to something.
 *
 * Implemented as a comparison against the same string with every binding
 * removed, because that is exactly the question — "is the result
 * indistinguishable from the boilerplate alone?" — and it needs no second
 * opinion about what a value looks like.
 */
export function boundValueResolved(raw: unknown, ctx: ResolveContext): boolean {
  if (raw === null || raw === undefined) return false;
  const s = String(raw);
  if (!s.includes('{{')) return s.trim().length > 0;

  const withValues = resolveBindable(s, ctx).trim();
  if (withValues.length === 0) return false;

  const boilerplate = s.replace(BINDING_RE_G, '').replace(/\s+/g, ' ').trim();
  return withValues.replace(/\s+/g, ' ') !== boilerplate;
}
