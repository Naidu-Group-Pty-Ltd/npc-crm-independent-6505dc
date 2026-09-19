import type { TemplateImportPlan } from './types';
import { assertValidTemplateImportPlan } from './validatePlan';

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function firstJsonObject(value: string): string {
  const stripped = stripCodeFence(value);
  if (stripped.startsWith('{')) return stripped;
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

/** Parse untrusted model output and accept only a validated TemplateImportPlan. */
export function parseTemplateImportPlanResponse(response: unknown): TemplateImportPlan {
  let raw: unknown;
  try {
    raw = typeof response === 'string'
      ? JSON.parse(firstJsonObject(response))
      : response;
  } catch (error) {
    throw new Error(`Could not parse TemplateImportPlan JSON: ${(error as Error)?.message ?? 'invalid JSON'}`);
  }
  return assertValidTemplateImportPlan(raw as TemplateImportPlan);
}
