/**
 * The three fidelity levels, in the words a person choosing one needs.
 *
 * Separate from `enrich.pure.ts` because that module is the contract with a
 * model and this is the contract with a reader — and because the copy is the
 * hard part. "Restructure / connective / rewrite" tells somebody nothing about
 * whether their client's figures are safe, which is the only question anyone
 * actually has. Every entry answers it in the same place, and `figures` says
 * the same thing three times on purpose: the reassurance is worth more than the
 * brevity.
 *
 * Pure data, so the converter screen and the history panel cannot describe the
 * same level differently.
 */
import type { ConversionFidelity } from './enrich.pure';

export interface FidelityChoice {
  value: ConversionFidelity;
  /** The dropdown label. */
  label: string;
  /** One line under it. What the design pass may do with the words. */
  body: string;
  /** What happens to the numbers. Identical intent at every level. */
  figures: string;
}

export const FIDELITY_CHOICES: readonly FidelityChoice[] = [
  {
    value: 'restructure',
    label: 'Keep the words',
    body: 'The same sentences, given the right form — figures become a KPI strip, a comparison '
      + 'becomes a chart, a caveat becomes a callout. Nothing new is written.',
    figures: 'Every figure is checked against your document.',
  },
  {
    value: 'connective',
    label: 'Add connecting lines',
    body: 'As above, and each chapter may gain one opening sentence and short sub-headings so it '
      + 'reads as one argument rather than a list of parts. Your existing sentences are untouched.',
    figures: 'Every figure is checked against your document.',
  },
  {
    value: 'rewrite',
    label: 'Rewrite in house voice',
    body: 'The prose is rewritten plainly and directly, keeping every claim the chapter makes. '
      + 'Use this on a template whose writing you were going to replace anyway.',
    figures: 'Every figure is checked against your document.',
  },
];

export function fidelityLabel(value: string | null | undefined): string {
  return FIDELITY_CHOICES.find((c) => c.value === value)?.label ?? '';
}
