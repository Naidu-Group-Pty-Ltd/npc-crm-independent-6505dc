import type { AssessmentPayload } from '@/lib/ciAssessment/types';

/**
 * A starting point for a new client record, from what the assessment already
 * knows.
 *
 * The borrower here is usually a company; a client record is a person. So the
 * best person-shaped fact the payload holds is the first named director of the
 * primary borrowing entity, and the entity name itself is the fallback — an
 * adviser creating "Asteron Industrial Holdings" as a surname has something to
 * correct, which beats an empty form they have to leave the workflow to fill.
 *
 * Prefill only. Nothing is written until the user has seen and submitted the
 * form, so an import's guess never becomes a record by itself.
 */
export function prefillFromAssessment(payload: AssessmentPayload): { firstName: string; surname: string } {
  const entity = payload.ownership.entities[0];
  const director = (entity?.directors ?? '')
    .split(/[,;\n]/)[0]
    ?.trim();

  const source = director || entity?.entityName?.trim() || '';
  if (!source) return { firstName: '', surname: '' };

  const words = source.split(/\s+/);
  if (words.length === 1) return { firstName: '', surname: words[0] };
  return { firstName: words[0], surname: words.slice(1).join(' ') };
}
