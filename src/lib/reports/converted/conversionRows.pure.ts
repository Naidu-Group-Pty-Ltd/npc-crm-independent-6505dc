/**
 * How one earlier conversion reads on screen.
 *
 * Pulled out of the component because "which of these can be opened" and "what
 * do the chips say" are decisions with edge cases — a conversion that failed, a
 * conversion still at `review` that never produced a file, a conversion whose
 * stored object has since gone missing — and a decision with edge cases wants a
 * test, not a render.
 *
 * Nothing here formats a date: relative time needs a clock, and a clock in a
 * pure module is a module that cannot be tested.
 */
import { fidelityLabel } from './fidelityChoices';
import type { ConvertListRow } from './route.pure';

export type ConversionTone = 'success' | 'danger' | 'info' | 'neutral';

export interface ConversionRowView {
  /** Drives the status glyph and the badge. */
  tone: ConversionTone;
  /** One word for the state, in the user's language rather than the column's. */
  statusLabel: string;
  /** What to call this row. Falls back through what the row actually has. */
  title: string;
  /** Short outline chips, in reading order. Never empty strings. */
  chips: string[];
  /** True only when there is a link to give. */
  canOpen: boolean;
  /** The failure, trimmed for one line. Null unless the row failed. */
  error: string | null;
}

const STATUS_LABELS: Record<string, { label: string; tone: ConversionTone }> = {
  succeeded: { label: 'Converted', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  rendering: { label: 'Rendering', tone: 'info' },
  extracting: { label: 'Reading', tone: 'info' },
  review: { label: 'Awaiting review', tone: 'neutral' },
};

/** `1048576` → `1.0 MB`. Bytes are a detail; the magnitude is the point. */
export function formatBytes(bytes: number | null): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function describeConversionRow(row: ConvertListRow): ConversionRowView {
  const status = STATUS_LABELS[row.status] ?? { label: row.status || 'Unknown', tone: 'neutral' as const };

  const chips: string[] = [];
  if (row.formatName) chips.push(row.formatName);
  if (row.designSystemName) chips.push(row.designSystemName);
  if (row.pageCount) chips.push(`${row.pageCount} page${row.pageCount === 1 ? '' : 's'}`);

  // Bound out of how many the format wanted, which is the number that says
  // whether the right format was chosen. `0/7 bound` is a conversion somebody
  // should look at again.
  const wanted = row.boundChapters + row.unfilledChapters;
  if (wanted > 0) chips.push(`${row.boundChapters}/${wanted} bound`);

  // Only when there is one. A `+0 appendix` chip on every row is noise that
  // trains people to stop reading the chips.
  if (row.appendixSections > 0) {
    chips.push(`+${row.appendixSections} appendix`);
  }
  if (row.unstructured) chips.push('no headings');

  // Whether a model designed this one, and how much of it.
  //
  // Only on rows that reached a render, and only when a pass was attempted: a
  // row from before the design pass existed has a null model, and captioning it
  // "0 designed" would report a failure that never happened. `Not designed`
  // appears only when a pass ran and every chapter fell back — which is the
  // case worth knowing about.
  if (row.enrichmentModel) {
    chips.push(row.enrichedChapters > 0 ? `${row.enrichedChapters} designed` : 'Not designed');
  }
  const fidelity = fidelityLabel(row.fidelity);
  if (fidelity) chips.push(fidelity);
  // Only the scorer is worth a chip. A model-proposed binding is the norm; a
  // word-overlap one is the exception and deserves more scrutiny on review.
  if (row.bindingSource === 'scorer') chips.push('matched on wording');

  const size = formatBytes(row.bytes);
  if (size) chips.push(size);

  return {
    tone: status.tone,
    statusLabel: status.label,
    // The rendered filename first, because that is what landed in a downloads
    // folder. A conversion that never rendered has only the upload's name.
    title: row.fileName || row.sourceFilename || 'Untitled conversion',
    chips,
    // A URL, not a status. A row can be `succeeded` and still have no link if
    // its stored object has gone missing and re-signing failed — offering an
    // Open button that 404s is worse than offering none.
    canOpen: Boolean(row.url),
    error: row.status === 'failed' ? (row.error || 'No reason was recorded.') : null,
  };
}
