import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReviewStep } from './types';

interface ReviewWizardStepsProps {
  steps: ReviewStep[];
  currentStep: ReviewStep;
  currentStepIndex: number;
  onStepClick: (step: ReviewStep) => void;
}

const stepLabels: Record<ReviewStep, string> = {
  data_completeness: 'Data Quality',
  metrics_review: 'Metrics',
  scorecard: 'Scorecard',
  borrowing_capacity: 'Borrowing Power',
  flags_scenarios: 'Flags & Scenarios',
  recommendations: 'Recommendations',
  generate_report: 'Complete'
};

export function ReviewWizardSteps({ 
  steps, 
  currentStep, 
  currentStepIndex,
  onStepClick 
}: ReviewWizardStepsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 border-b bg-muted/30 px-4 py-3 sm:grid-cols-4 lg:grid-cols-7">
      {steps.map((step, index) => {
        const isCompleted = index < currentStepIndex;
        const isCurrent = step === currentStep;
        const isClickable = index <= currentStepIndex;

        return (
          <button
            key={step}
            onClick={() => isClickable && onStepClick(step)}
            disabled={!isClickable}
            className={cn(
              "min-w-0 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isClickable && "cursor-pointer hover:text-primary",
              !isClickable && "cursor-not-allowed opacity-50",
              isCurrent && "text-primary",
              isCompleted && "text-success"
            )}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : isCurrent ? (
              <CircleDot className="h-4 w-4" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
            <span className="leading-tight">{stepLabels[step]}</span>
          </button>
        );
      })}
    </div>
  );
}
