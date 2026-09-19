import { useEffect, useRef, useState } from 'react';
import { Building2, Factory, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TextField } from './AssessmentFields';

import {
  ASSESSMENT_TYPE_DEFINITIONS,
  type AssessmentPayload,
  type AssessmentType,
} from '@/lib/ciAssessment/types';

interface Props {
  payload: AssessmentPayload;
  title: string;
  onTitleChange: (title: string) => void;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
  /**
   * The name is governed separately from the figures, and defaults to being
   * editable when they are not.
   *
   * A completed assessment's inputs are frozen because a calculation run
   * snapshots them — but its *name* is a label, and an assessment is usually
   * called "Test" while it is being built and only earns its real name once
   * the deal is understood. Locking the two together left a finished
   * assessment permanently misnamed in the list.
   */
  titleDisabled?: boolean;
}

/**
 * Step 1 — what kind of transaction this is.
 *
 * The choice is consequential rather than cosmetic: it selects which income
 * source drives serviceability, whether a purchase price is required, and
 * whether the transaction is routed straight to specialist review. That is why
 * each option states its own consequence rather than just naming itself.
 */
export function StepAssessmentType({
  payload, title, onTitleChange, onChange, disabled, titleDisabled = false,
}: Props) {
  /**
   * The title is persisted through an autosave + reload round-trip, so writing
   * on every keystroke made the field feel frozen (each character raced the
   * reload that replaced it). Keep a local draft, commit it on a debounce and
   * on blur, and only accept the incoming value when the field is idle.
   */
  const [draftTitle, setDraftTitle] = useState(title);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!dirtyRef.current) setDraftTitle(title);
  }, [title]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const commitTitle = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    dirtyRef.current = false;
    if (next !== title) onTitleChange(next);
  };

  const handleTitleChange = (next: string) => {
    dirtyRef.current = true;
    setDraftTitle(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commitTitle(next), 800);
  };

  const select = (type: AssessmentType) => {
    const definition = ASSESSMENT_TYPE_DEFINITIONS.find((entry) => entry.key === type);
    onChange({
      ...payload,
      assessmentType: type,
      property: {
        ...payload.property,
        classification: definition?.segment === 'industrial' ? 'industrial' : payload.property.classification,
      },
    });
  };

  return (
    <div className="ci-step-panel">
      <h2 className="ci-step-heading">Assessment type</h2>
      <p className="ci-step-description">
        This choice determines which income drives serviceability, which fields are required, and
        whether the transaction needs specialist review before the result can be relied on.
      </p>

      <div className="mb-6 max-w-xl">
        <TextField
          label="Assessment name"
          value={draftTitle}
          onChange={handleTitleChange}
          onBlur={() => commitTitle(draftTitle)}
          disabled={titleDisabled}
          placeholder="e.g. 45 Industrial Drive — Wetherill Park"
          help={
            titleDisabled
              ? 'This assessment is archived. Restore it to change its name.'
              : 'How this assessment appears in your list. You can change it at any time, including after the assessment is complete.'
          }
        />
      </div>


      <div
        role="radiogroup"
        aria-label="Assessment type"
        className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
      >
        {ASSESSMENT_TYPE_DEFINITIONS.map((definition) => {
          const active = payload.assessmentType === definition.key;
          const Icon = definition.segment === 'industrial' ? Factory : Building2;
          return (
            <button
              key={definition.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => select(definition.key)}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-primary/50',
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="text-sm font-semibold text-foreground">{definition.label}</span>
              </span>
              <span className="text-xs leading-5 text-muted-foreground">{definition.description}</span>
              {definition.requiresSpecialistReview ? (
                <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-warning">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Specialist review required
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
