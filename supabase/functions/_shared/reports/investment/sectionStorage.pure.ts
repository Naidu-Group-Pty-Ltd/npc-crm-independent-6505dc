/**
 * Per-section storage for a stored report — the projection that makes a
 * document addressable by section id instead of only readable as one blob.
 *
 * ## What this is for
 *
 * `investment_reports.report_content` is the document a client received, and
 * it stays the source of truth. This module derives an ordered, addressable
 * index over it so a single section can be found, counted or replaced without
 * re-reading and re-writing the whole report. It is a **projection, never a
 * replacement**: nothing here is authoritative, and a report whose index
 * cannot be proven lossless is left unindexed rather than partially indexed.
 *
 * ## The three rules, and where each came from
 *
 * **A repeat is an occurrence, never a merge.** Phase 3's partition
 * deliberately left this decision to the storage step: production briefing
 * `89b451f6` carries 29 headings resolving to 21 sections, with
 * `marketPosition` four times and `tenYear` three. Folding them would merge
 * bodies written apart and silently reorder a client's document, so each
 * appearance is stored with its own ordinal and a 1-based `occurrence`, and
 * re-assembly walks them in order.
 *
 * **The index is written only when it proves lossless.** `conservesNonWhitespace`
 * compares the re-assembled document against the original ignoring whitespace
 * only; anything else — a dropped table row, a swallowed heading — fails, and
 * a failing report is recorded as unindexed. Whitespace is excluded because
 * the partition trims section bodies, which changes blank-line runs and
 * nothing else.
 *
 * **An unstructured report is a real answer, not a failure.** 58.6% of the
 * stored corpus writes its sections at H1 and 6.2% carries no heading at all;
 * a document that yields no sections is indexed as preamble-only, which is
 * exactly what it is.
 */

import {
  partitionByRegistry,
  type DocumentPartition,
  type SectionHeadingLevel,
  type SectionId,
} from './sectionRegistry.pure.ts';

export interface StoredSection {
  /** 0-based position among this report's sections, in document order. */
  ordinal: number;
  sectionId: SectionId;
  /** 1-based index among repeats of the same `sectionId`. Never merged. */
  occurrence: number;
  /** The heading exactly as the document spelled it, without its `#` marker. */
  heading: string;
  body: string;
}

export interface ReportSectionIndex {
  /** Anything before the first recognised section — a title block, usually. */
  preamble: string;
  sections: StoredSection[];
  /** Unrecognised headings at the section level, and what absorbed each. */
  absorbed: DocumentPartition['absorbed'];
  /** The heading level this document uses for its sections. */
  level: SectionHeadingLevel;
  /**
   * Whether re-assembling these sections reproduces the original document's
   * non-whitespace content exactly. An index that does not conserve must not
   * be stored.
   */
  conserves: boolean;
  /** Distinct section ids, and the total including repeats. */
  distinctSections: number;
  totalSections: number;
}

/** Non-whitespace characters only — the comparison the conservation proof uses. */
export function nonWhitespace(text: string): string {
  return (text || '').replace(/\s+/g, '');
}

/**
 * True when two documents carry identical non-whitespace content.
 *
 * Whitespace is the only permitted difference because the partition trims each
 * section body, which collapses blank-line runs at section boundaries and
 * changes nothing a reader would see. Any other difference — a lost row, a
 * duplicated heading, a reordered section — changes this comparison and fails.
 */
export function conservesNonWhitespace(original: string, rebuilt: string): boolean {
  return nonWhitespace(original) === nonWhitespace(rebuilt);
}

/**
 * Rebuild a document from its stored index. The inverse of `toSectionIndex`,
 * and the thing its conservation proof runs against.
 */
export function assembleSectionIndex(
  preamble: string,
  sections: readonly StoredSection[],
  level: SectionHeadingLevel,
): string {
  const marker = level === 1 ? '#' : '##';
  const parts: string[] = [];
  if (preamble.trim() !== '') parts.push(preamble.trim());
  for (const s of [...sections].sort((a, b) => a.ordinal - b.ordinal)) {
    parts.push(`${marker} ${s.heading}`);
    if (s.body.trim() !== '') parts.push(s.body.trim());
  }
  return parts.join('\n\n');
}

/**
 * Derive the addressable index for one stored report.
 *
 * Never throws on a malformed or empty document: an unpartitionable report
 * yields an index with no sections, which is a truthful description of it.
 */
export function toSectionIndex(markdown: string): ReportSectionIndex {
  const partition = partitionByRegistry(markdown || '');
  const seen = new Map<SectionId, number>();
  const sections: StoredSection[] = partition.sections.map((s, ordinal) => {
    const occurrence = (seen.get(s.id) ?? 0) + 1;
    seen.set(s.id, occurrence);
    return { ordinal, sectionId: s.id, occurrence, heading: s.heading, body: s.body };
  });

  const rebuilt = assembleSectionIndex(partition.preamble, sections, partition.level);
  return {
    preamble: partition.preamble,
    sections,
    absorbed: partition.absorbed,
    level: partition.level,
    conserves: conservesNonWhitespace(markdown || '', rebuilt),
    distinctSections: seen.size,
    totalSections: sections.length,
  };
}

/**
 * Find one section's occurrences in an index, in document order.
 *
 * Returns every appearance rather than the first, because a section id that
 * appears four times is four pieces of a client's document and a caller that
 * silently took the first would be re-introducing the merge this module
 * refuses.
 */
export function occurrencesOf(index: ReportSectionIndex, sectionId: SectionId): StoredSection[] {
  return index.sections.filter((s) => s.sectionId === sectionId);
}
