/**
 * The disclaimer a template prints belongs to the deployment, not to the copy.
 *
 * ## What went wrong
 *
 * `disclaimer` blocks carry the firm's closing page. Every other field on that
 * block has always been a binding — `{{org.name}}`, `{{org.abn}}`,
 * `{{org.phone}}`, `{{org.address}}` — but the text itself was a baked literal,
 * so the Report Settings page could be edited and the documents would not move.
 * v7 fixed that in the catalogue: all 543 `template_library_entries` bind
 * `{{org.disclaimer}}` and `{{org.disclaimerFontSize}}`, each with a fallback.
 *
 * `report_templates` is a different table and it is the one documents are drawn
 * from. Its rows are **copies**, taken at a moment in time:
 * `20260814190000_activate_production_masters_eight_formats` inserted
 * `e.schema` verbatim on 14 Aug, and v7 landed on 15. So the catalogue was
 * corrected and the twelve activated templates kept the pre-v7 text — measured
 * on 16 Aug: 13 disclaimer blocks in `report_templates`, 11 of them baked, 10
 * of those on an active template, including two of the three formats an
 * operator had actually chosen a template for.
 *
 * The block renderer cannot rescue that. It resolves `disclaimerText` and only
 * reaches `disclaimerFallback` when the result is empty — which is right, and
 * is exactly why a literal wins for ever once it is in the row.
 *
 * ## The rule
 *
 * A copy binds the deployment's disclaimer, and whatever literal it arrived
 * with becomes the fallback. Nothing is thrown away: a deployment with no
 * disclaimer set, or one that has switched it off, still prints the text it
 * printed before, because that text is now the fallback rather than the value.
 *
 * Applying this at copy time is what stops the defect coming back. A row
 * activated from a stale library, restored from an old export, or hand-built by
 * an operator who pasted the standard wording all end up bound.
 */

/** What the block reads for the text, and where a literal is preserved. */
const TEXT_PROP = 'disclaimerText';
const TEXT_FALLBACK_PROP = 'disclaimerFallback';
/** The setting's own vocabulary is `small | medium | large`, not points. */
const SIZE_PROP = 'fontSize';
const SIZE_FALLBACK_PROP = 'fontSizeFallback';

export const ORG_DISCLAIMER_BINDING = '{{org.disclaimer}}';
export const ORG_DISCLAIMER_SIZE_BINDING = '{{org.disclaimerFontSize}}';

/**
 * `small` renders at 8.5pt, which is what a numeric `fontSize` already produced.
 *
 * The masters used to pass `8`. That matches none of the three size tokens, so
 * `disclaimer.html.ts` fell through to 8.5 — meaning `small` preserves the size
 * those templates print at today rather than changing it.
 */
const DEFAULT_SIZE_FALLBACK = 'small';

const isBinding = (v: unknown): boolean => typeof v === 'string' && v.includes('{{');
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Bind one `disclaimer` block to the deployment's disclaimer.
 *
 * Returns the block unchanged when it is already bound, so this is safe to run
 * over a whole catalogue repeatedly.
 */
function bindBlock(block: Record<string, unknown>): Record<string, unknown> {
  const props = (block.props && typeof block.props === 'object')
    ? { ...(block.props as Record<string, unknown>) }
    : {};

  let changed = false;

  if (!isBinding(props[TEXT_PROP])) {
    // A literal is demoted to the fallback rather than dropped — but never over
    // a fallback that is already there, which would lose the authored one.
    if (isNonEmpty(props[TEXT_PROP]) && !isNonEmpty(props[TEXT_FALLBACK_PROP])) {
      props[TEXT_FALLBACK_PROP] = props[TEXT_PROP];
    }
    props[TEXT_PROP] = ORG_DISCLAIMER_BINDING;
    changed = true;
  }

  if (!isBinding(props[SIZE_PROP])) {
    if (!isNonEmpty(props[SIZE_FALLBACK_PROP])) {
      // A numeric size carries no token, so the fallback is the token that
      // renders at the same point size rather than the number itself.
      props[SIZE_FALLBACK_PROP] = isNonEmpty(props[SIZE_PROP])
        ? props[SIZE_PROP]
        : DEFAULT_SIZE_FALLBACK;
    }
    props[SIZE_PROP] = ORG_DISCLAIMER_SIZE_BINDING;
    changed = true;
  }

  return changed ? { ...block, props } : block;
}

/**
 * Bind every `disclaimer` block in a template schema.
 *
 * Identity-returns the schema when nothing needed changing, so a caller can use
 * the result unconditionally without rewriting rows that are already correct.
 */
export function bindOrganisationDisclaimer<T>(schema: T): T {
  if (!schema || typeof schema !== 'object') return schema;
  const root = schema as unknown as Record<string, unknown>;
  const pages = root.pages;
  if (!Array.isArray(pages)) return schema;

  let touched = false;
  const nextPages = pages.map((page) => {
    if (!page || typeof page !== 'object') return page;
    const blocks = (page as Record<string, unknown>).blocks;
    if (!Array.isArray(blocks)) return page;

    let pageTouched = false;
    const nextBlocks = blocks.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const b = block as Record<string, unknown>;
      if (b.type !== 'disclaimer') return block;
      const bound = bindBlock(b);
      if (bound !== block) pageTouched = true;
      return bound;
    });

    if (!pageTouched) return page;
    touched = true;
    return { ...(page as Record<string, unknown>), blocks: nextBlocks };
  });

  return touched ? ({ ...root, pages: nextPages } as unknown as T) : schema;
}

/** Whether a schema still carries a disclaimer block that is not bound. */
export function hasUnboundDisclaimer(schema: unknown): boolean {
  return bindOrganisationDisclaimer(schema) !== schema;
}
