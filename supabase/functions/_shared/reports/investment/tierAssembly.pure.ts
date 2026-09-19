/**
 * Put a derived report's sections in the order its tier declares.
 *
 * ## The defect this exists to end
 *
 * `condense-investment-report` composes the Briefing's financial tables, score
 * breakdown and SWOT from the record — seven sections the model is deliberately
 * not asked to write — and then appends them:
 *
 * ```ts
 * condensedContent = `${condensedContent.trimEnd()}\n\n${composed.join('\n\n')}`;
 * ```
 *
 * `trimToDeclaredSections` filters; it never reorders. So the document a client
 * reads carries every model-written section first and the composed ones after
 * them — including after `Market Data Sources`, which the registry places at
 * order **90**, last, as an appendix. The registry declares the composed
 * chapters at orders **11–17**, before `Top 3 Opportunities` (18), `Top 3
 * Risks` (19) and `Recommendation` (20).
 *
 * The financial tables a recommendation rests on therefore print *after* the
 * recommendation and *after* the sources note.
 *
 * ## The rule
 *
 * **The registry declares the order; assembly obeys it.** The tier's section
 * list is already the one structure definition in this product
 * (`sectionRegistry.pure.ts`), and it carries an `order` on every placement.
 * Nothing else may decide where a section goes.
 *
 * ## Why this runs AFTER the trim rather than replacing it
 *
 * `trimToDeclaredSections` drops a heading the tier does not declare, together
 * with its body — which is what stops a condensed report carrying the parent's
 * own 36 headings. `partitionByRegistry` behaves differently on the same input:
 * an unrecognised heading is *absorbed* into whichever section is open, and
 * reported rather than dropped. That is right for reading a stored document and
 * wrong for enforcing a structure guide.
 *
 * So the trim keeps its job and this takes the trimmed text, whose headings are
 * all declared already. Absorption cannot arise, and the two functions are not
 * competing definitions of "what belongs in this tier".
 *
 * ## Nothing is lost
 *
 * A section this cannot place — an authored one the tier does not declare
 * (unreachable after a trim, but not assumed away), or a composed one handed in
 * for a tier with no slot for it — is appended and NAMED in the result rather
 * than dropped. Losing a client's content to fix its order would be a worse
 * defect than the one this closes.
 */

import {
  type PartitionedSection,
  type ReportTier,
  type SectionId,
  partitionByRegistry,
  sectionsForTier,
} from './sectionRegistry.pure.ts';

/** A section composed from the record, addressed by the id it stands for. */
export interface ComposedPlacement {
  id: SectionId;
  /** Complete markdown including its own `## heading` line. */
  markdown: string;
}

export interface AssembledDocument {
  markdown: string;
  /** Composed sections placed in their declared slot, in that order. */
  placed: SectionId[];
  /** Authored sections kept, in declared order. */
  authored: SectionId[];
  /**
   * Sections appended because the tier declares no slot for them. Empty is the
   * expected state; a non-empty list is a registry/caller disagreement worth
   * seeing in the log, not a reason to drop anything.
   */
  unplaced: SectionId[];
}

const heading = (level: 1 | 2, text: string): string => `${level === 1 ? '#' : '##'} ${text}`;

/**
 * Re-emit `authoredMarkdown`'s sections in tier order, substituting a composed
 * section wherever one is supplied for that id.
 *
 * The input is expected to be trimmed to the tier's declared headings already.
 * Composed sections replace an authored section of the same id outright — that
 * is the point of composing one: the record's version is the version.
 */
export function assembleInDeclaredOrder(
  authoredMarkdown: string,
  composed: readonly ComposedPlacement[],
  tier: ReportTier,
): AssembledDocument {
  const part = partitionByRegistry(authoredMarkdown || '');
  // A repeat is an OCCURRENCE, never a merge — the same rule
  // `sectionStorage.pure.ts` keys on `(report_id, ordinal)` for, and for the
  // same measured reason: one production briefing carries `marketPosition`
  // four times. Keying a plain `Map` by id would keep the last copy and drop
  // the rest, which is losing a client's content to fix its order.
  const byId = new Map<SectionId, PartitionedSection[]>();
  for (const s of part.sections) {
    const at = byId.get(s.id);
    if (at) at.push(s);
    else byId.set(s.id, [s]);
  }
  const composedById = new Map(composed.map((c) => [c.id, c.markdown]));

  // `surface: 'document'` sections are drawn by the template and never appear
  // as a heading in `report_content`; listing them here would open empty slots.
  const declared = sectionsForTier(tier).filter((s) => s.surface === 'markdown');

  const out: string[] = [];
  const placed: SectionId[] = [];
  const authored: SectionId[] = [];

  if (part.preamble.trim()) out.push(part.preamble.trim());

  for (const slot of declared) {
    const fromRecord = composedById.get(slot.id);
    if (fromRecord !== undefined) {
      out.push(fromRecord.trim());
      placed.push(slot.id);
      continue;
    }
    const written = byId.get(slot.id) ?? [];
    for (const w of written) {
      // The document's own spelling of the heading, not the registry label —
      // the trim preserved it and rewriting it here would be a second, silent
      // editorial change riding on an ordering fix.
      const body = w.body.trim();
      out.push(body ? `${heading(part.level, w.heading)}\n\n${body}` : heading(part.level, w.heading));
      authored.push(slot.id);
    }
  }

  // Whatever the declared list could not account for, in the order it arrived.
  const unplaced: SectionId[] = [];
  const declaredIds = new Set(declared.map((s) => s.id));
  for (const s of part.sections) {
    if (declaredIds.has(s.id) || composedById.has(s.id)) continue;
    const body = s.body.trim();
    out.push(body ? `${heading(part.level, s.heading)}\n\n${body}` : heading(part.level, s.heading));
    unplaced.push(s.id);
  }
  for (const c of composed) {
    if (declaredIds.has(c.id)) continue;
    out.push(c.markdown.trim());
    unplaced.push(c.id);
  }

  return {
    markdown: out.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n',
    placed,
    authored,
    unplaced,
  };
}
