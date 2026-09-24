/**
 * "New assessment": create the draft, then open it on its Type step.
 *
 * Every "New assessment" button uses this one action: the landing's header,
 * its empty list, a register row and a building's own page. There is nothing
 * to confirm first. The Type step, the page the assessment opens on, asks the
 * name and the transaction type at its top. Why creating on the click is right
 * now, where it once was not, is recorded in `newAssessment.ts`.
 *
 * Started from a building, the draft carries it from the first moment. It is
 * named after the building, its figures fill the blanks and an industrial
 * building starts as an industrial investment. If the building cannot be read,
 * nothing is created: the click asked for an assessment OF that building, and
 * an assessment silently without it is a different thing from the one asked
 * for.
 *
 * One start at a time, whichever button was pressed: a second click while the
 * first is still creating makes nothing, so a double-click cannot mint two
 * drafts.
 */

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { createAssessment } from '@/lib/ciAssessment/assessmentManagement';
import { planNewAssessment, startingType } from '@/lib/ciAssessment/newAssessment';
import type { RegisterDomain } from '@/lib/ciAssessment/registerProperty';
import { readRegisterProperty, type ResolvedRegisterProperty } from './useRegisterProperties';

/** The building an assessment is started from. */
export interface StartFrom {
  domain: RegisterDomain;
  propertyId: string;
}

/** What `starting` holds for a start with no building. */
export const STARTING_BLANK = 'blank';

/** The key a start is known by while it runs, so each button can show its own. */
export function startKey(from?: StartFrom | null): string {
  return from ? `${from.domain}:${from.propertyId}` : STARTING_BLANK;
}

/** The path a new assessment opens on: its first step. */
export function newAssessmentOpenPath(id: string): string {
  return `/commercial/assessments/${encodeURIComponent(id)}?step=type`;
}

export function useStartAssessment() {
  const navigate = useNavigate();
  /** The start under way, by `startKey`, or null. */
  const [starting, setStarting] = useState<string | null>(null);
  // A ref as well as state: two clicks inside one render would both read the
  // state as idle.
  const inFlight = useRef(false);

  const start = useCallback(async (from?: StartFrom | null) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(startKey(from));
    try {
      let building: ResolvedRegisterProperty | null = null;
      if (from) {
        const read = await readRegisterProperty(from.domain, from.propertyId);
        if (!read.data) {
          toast({
            title: 'Could not start the assessment',
            description: `The property could not be read, so nothing was created. ${read.error ?? ''}`.trim(),
            variant: 'destructive',
          });
          return;
        }
        building = read.data;
      }

      const plan = planNewAssessment({
        title: '',
        assessmentType: startingType(building?.option.industrial ?? false),
        segmentChoice: null,
        property: building
          ? { prefill: building.prefill, link: building.link, industrial: building.option.industrial }
          : null,
      });
      const result = await createAssessment({
        title: plan.title,
        segment: plan.segment,
        assessmentType: plan.assessmentType,
        payload: plan.payload,
      });
      if (result.error || !result.data?.id) {
        toast({
          title: 'Could not create the assessment',
          description: result.error ?? 'Try again.',
          variant: 'destructive',
        });
        return;
      }

      const filled = plan.applied.length;
      toast({
        title: 'Assessment created',
        description: building
          ? `${plan.title}: ${filled} detail${filled === 1 ? '' : 's'} filled from the property register.`
          : 'Name it and choose the transaction type to begin.',
      });
      navigate(newAssessmentOpenPath(String(result.data.id)));
    } finally {
      inFlight.current = false;
      setStarting(null);
    }
  }, [navigate]);

  return { start, starting };
}
