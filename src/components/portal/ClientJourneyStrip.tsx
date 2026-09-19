import { cn } from '@/lib/utils';
import { Check, FileText, ShieldCheck, BadgeCheck, Users } from 'lucide-react';
import type { AmlPortalOverview, AmlPortalJourneyStatus } from '@/lib/aml/amlPortalApi';
import { findJourneyStep } from '@/lib/aml/portalStepPresentation';

/**
 * The client's view of the four-stage journey — deliberately built from the
 * portal-safe overview payload ALONE. No risk vocabulary, no gate names, no
 * partner detail: the client sees where they are and what happens next, in
 * their own language.
 *
 * The pay-off line ("your whole purchase team reuses this") is the product
 * promise from the owner's flow diagram: verify once, never repeat it for the
 * broker, builder, developer or conveyancer.
 *
 * ## Why it reads the journey now
 *
 * It used to derive its own four states from `case.status`, which is a
 * different question from the one the detailed stepper below it answers. Two
 * formulas, one page: the strip could say the client's information was still
 * being gathered while every step underneath it was green. There is one
 * canonical journey and this renders a coarser view of the same thing —
 * `case.status` remains the fallback for a server that has not sent one.
 *
 * ## The copy
 *
 * "We check it — securely, in-house" was retired. The identity check runs with
 * a verification provider, and a sentence that tells the customer otherwise is
 * wrong in exactly the place they are deciding whether to trust us with a
 * photograph of their face. The replacement is accurate without naming the
 * provider, which is not the customer's to know from here.
 */

type StripState = 'done' | 'active' | 'todo';

const STEPS = [
  { icon: FileText, label: 'Tell us about you', sub: 'a few guided questions' },
  { icon: ShieldCheck, label: 'We verify your identity', sub: 'securely with our verification provider' },
  { icon: BadgeCheck, label: 'Your adviser checks it', sub: 'nothing more to do' },
  { icon: Users, label: 'Your team reuses it', sub: 'broker · builder · conveyancer' },
] as const;

/** `complete` is done; anything a client is part-way through is active. */
function stateFor(status: AmlPortalJourneyStatus | undefined, started: boolean): StripState {
  if (status === 'complete') return 'done';
  if (status === 'in_progress' || status === 'action_required') return 'active';
  return started ? 'active' : 'todo';
}

export function ClientJourneyStrip({ overview }: { overview: AmlPortalOverview }) {
  const status = overview.case?.status ?? 'not_started';
  const consented = overview.consent?.satisfied ?? false;
  const journey = overview.journey;

  // Fallbacks for a server that predates the journey — the same tokens this
  // strip has always used, so it degrades to its previous behaviour rather
  // than to a blank row.
  const submitted = ['submitted', 'under_review', 'complete'].includes(status);
  const caseComplete = status === 'complete';

  const consentStep = findJourneyStep(journey, 'consent');
  const questionnaireStep = findJourneyStep(journey, 'questionnaire');
  const documentsStep = findJourneyStep(journey, 'documents');
  const verificationStep = findJourneyStep(journey, 'verification');
  const adviserStep = findJourneyStep(journey, 'review');

  // Stage one covers everything the client fills in: consents, their answers,
  // and any documents asked of them. It is done when all three are.
  const gatheringSteps = [consentStep, questionnaireStep, documentsStep].filter(Boolean);
  const gathering: AmlPortalJourneyStatus | undefined = gatheringSteps.length === 0
    ? undefined
    : gatheringSteps.every((s) => s!.status === 'complete')
      ? 'complete'
      : gatheringSteps.some((s) => s!.status === 'action_required')
        ? 'action_required'
        : 'in_progress';

  const complete = adviserStep ? adviserStep.status === 'complete' : caseComplete;
  const sharingConsented = !(overview.consent?.outstanding ?? []).includes('compliance_sharing')
    && consented;

  const states: StripState[] = journey
    ? [
      stateFor(gathering, consented),
      stateFor(verificationStep?.status, gathering === 'complete'),
      stateFor(adviserStep?.status, submitted),
      complete && sharingConsented ? 'done' : complete ? 'active' : 'todo',
    ]
    : [
      submitted ? 'done' : 'active',
      caseComplete ? 'done' : submitted ? 'active' : 'todo',
      caseComplete ? 'done' : 'todo',
      caseComplete && sharingConsented ? 'done' : caseComplete ? 'active' : 'todo',
    ];
  const doneCount = states.filter((s) => s === 'done').length;

  return (
    <div
      className="rounded-xl border border-primary/20 bg-primary/5 p-4"
      aria-label="Your compliance journey"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-sm font-semibold">Your compliance journey</span>
        <span className="text-xs text-muted-foreground">
          Complete this once — everyone helping with your purchase can reuse it.
        </span>
      </div>

      <ol className="relative grid grid-cols-4 gap-1">
        <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-4 h-0.5 rounded-full bg-border" />
        <div
          aria-hidden
          className="absolute left-[12.5%] top-4 h-0.5 rounded-full bg-primary transition-all duration-700"
          style={{ width: `${(Math.max(doneCount - 0.5, 0) / 4) * 100}%`, maxWidth: '75%' }}
        />
        {STEPS.map((step, i) => {
          const state = states[i];
          const Icon = step.icon;
          return (
            <li key={step.label} className="relative z-10 flex flex-col items-center text-center">
              <span
                aria-hidden
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 bg-background transition-colors',
                  state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  state === 'active' && 'border-primary text-primary',
                  state === 'todo' && 'border-border text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className={cn(
                'mt-1.5 text-[11px] font-medium leading-tight',
                state === 'todo' ? 'text-muted-foreground' : 'text-foreground',
              )}>
                {step.label}
              </span>
              <span className="hidden text-[10px] text-muted-foreground sm:block">{step.sub}</span>
              <span className="sr-only">
                {state === 'done' ? 'complete' : state === 'active' ? 'current step' : 'upcoming'}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
