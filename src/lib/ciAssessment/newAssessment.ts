/**
 * What "New assessment" creates.
 *
 * ## Create on the click, open on the Type step
 *
 * "New assessment" creates the draft and opens it on its Type step, which asks
 * the two questions every assessment starts with: its name and its
 * transaction type. Started from a building in the property register, the
 * draft carries that building from the first moment: its figures fill the
 * blanks, its kind sets the starting type, and the register lists the
 * assessment.
 *
 * It asked first for a while. A dialog took the name, the type and optionally
 * the building and the client, and created nothing until it was confirmed.
 * That was the answer to drafts piling up, when every click that went no
 * further left an "Untitled assessment" behind that nobody could delete. It
 * answered the wrong half of the problem. A draft can be deleted now
 * (`deletion.pure.ts`: an untouched draft goes with one plain confirmation),
 * and the dialog asked, before the work began, the very questions the Type
 * step asks at its start. So the click creates again.
 *
 * What still never creates a record is a LINK. A refresh, the Back button or
 * an old bookmark is not somebody asking for a new assessment, so
 * `legacyCalculatorLinks.ts` sends every link to the page where one click
 * does.
 *
 * Pure, so the rules — which segment a type implies, what a register property
 * fills, what the record is called when nobody names it — are test cases.
 */

import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { applyRegisterProperty, type RegisterPropertyLink } from './registerProperty';
import type { PrefillChange } from './propertyPrefill';
import {
  assessmentTypeDefinition, emptyAssessmentPayload,
  type AssessmentPayload, type AssessmentType,
} from './types';

export type Segment = 'commercial' | 'industrial';

/**
 * The segment an assessment is filed under.
 *
 * A type that names its segment decides it. A type that fits either (a
 * refinance, a mixed-use deal) takes the operator's choice, then the building
 * it concerns, then commercial.
 */
export function segmentFor(
  type: AssessmentType,
  choice: Segment | null,
  propertyIsIndustrial: boolean | null,
): Segment {
  const definition = assessmentTypeDefinition(type);
  if (definition.segment === 'industrial') return 'industrial';
  if (definition.segment === 'commercial') return 'commercial';
  if (choice) return choice;
  if (propertyIsIndustrial) return 'industrial';
  return 'commercial';
}

/**
 * What a record is called until somebody names it.
 *
 * The server refuses an empty name, so an unnamed draft needs one. The Type
 * step shows this as an empty field rather than as a name to delete
 * (`isUntitled`).
 */
export const UNTITLED_ASSESSMENT = 'Untitled assessment';

/** Whether a title is the placeholder name, not one anybody chose. */
export function isUntitled(title: string | null | undefined): boolean {
  return (title ?? '').trim() === UNTITLED_ASSESSMENT;
}

/** The name a record gets when nobody has named it yet. */
export function defaultTitle(type: AssessmentType, propertyLabel: string | null): string {
  const label = propertyLabel?.trim();
  const definition = assessmentTypeDefinition(type);
  return label ? `${label} — ${definition.label.toLowerCase()}` : UNTITLED_ASSESSMENT;
}

/**
 * The type a new assessment starts as, before the Type step is answered.
 *
 * An industrial building starts as an industrial investment. Anything else,
 * including no building at all, starts as a commercial investment, which is
 * the first card on the Type step.
 */
export function startingType(propertyIsIndustrial: boolean): AssessmentType {
  return propertyIsIndustrial ? 'industrial_investment' : 'commercial_investment';
}

export interface NewAssessmentInput {
  title: string;
  assessmentType: AssessmentType;
  segmentChoice: Segment | null;
  /** The register property the assessment concerns, with its prefill. */
  property?: { prefill: CalculatorPrefill; link: RegisterPropertyLink; industrial: boolean } | null;
}

export interface NewAssessmentPlan {
  title: string;
  segment: Segment;
  assessmentType: AssessmentType;
  payload: AssessmentPayload;
  /** What the register property filled, for the confirmation toast. */
  applied: PrefillChange[];
}

export function planNewAssessment(input: NewAssessmentInput): NewAssessmentPlan {
  const segment = segmentFor(input.assessmentType, input.segmentChoice, input.property?.industrial ?? null);

  let payload = emptyAssessmentPayload(input.assessmentType);
  // An "either" type filed as industrial is an industrial building: the
  // classification is what drives the industrial-only fields and metrics.
  if (segment === 'industrial' && payload.property.classification === 'commercial') {
    payload = {
      ...payload,
      property: { ...payload.property, classification: 'industrial', assetClass: 'warehouse' },
    };
  }

  let applied: PrefillChange[] = [];
  if (input.property) {
    const outcome = applyRegisterProperty(payload, input.property.prefill, input.property.link);
    payload = outcome.payload;
    applied = outcome.applied;
  }

  const title = input.title.trim().slice(0, 300)
    || defaultTitle(input.assessmentType, input.property?.link.label ?? null);

  return { title, segment, assessmentType: input.assessmentType, payload, applied };
}
