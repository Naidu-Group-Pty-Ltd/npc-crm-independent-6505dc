/**
 * Ingestion registry — resolve an input to its source and produce a routing plan.
 *
 * This is the single entry point the editor's "Start from a reference" modal will
 * call to decide which pipeline (or render tier) handles a dropped/pasted/linked
 * input, before any heavy work runs.
 */
import { SOURCES } from './sources';
import { IngestionError, type IngestionInput, type IngestionPlan, type IngestionSource } from './types';

/** Find the source that handles `input`, or null when unsupported. */
export function resolveSource(input: IngestionInput): IngestionSource | null {
  return SOURCES.find((s) => s.accepts(input)) ?? null;
}

/** Produce the routing plan for `input`, or null when unsupported. */
export function planIngestion(input: IngestionInput): IngestionPlan | null {
  return resolveSource(input)?.plan(input) ?? null;
}

/** Like `planIngestion` but throws a typed error when the input is unsupported. */
export function planIngestionOrThrow(input: IngestionInput): IngestionPlan {
  const plan = planIngestion(input);
  if (!plan) {
    throw new IngestionError(
      'No ingestion source accepts this input (supported: PDF, image, URL, code).',
      'unsupported_input',
    );
  }
  return plan;
}
