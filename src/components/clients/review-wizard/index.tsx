import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useReviewWizard } from './useReviewWizard';
import { ReviewWizardSteps } from './ReviewWizardSteps';
import { DataCompletenessStep } from './DataCompletenessStep';
import { MetricsReviewStep } from './MetricsReviewStep';
import { ScorecardStep } from './ScorecardStep';
import { BorrowingCapacityStep } from './BorrowingCapacityStep';
import { FlagsScenariosStep } from './FlagsScenariosStep';
import { RecommendationsStep } from './RecommendationsStep';
import { GenerateReportStep } from './GenerateReportStep';
import type { ReviewWizardProps } from './types';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

export function ReviewWizard({
  clientId,
  clientName,
  properties,
  clientData,
  isOpen,
  onClose,
  onComplete
}: ReviewWizardProps) {
  const wizard = useReviewWizard(clientId, clientName, properties, clientData);

  const handleSaveDraft = async () => {
    await wizard.saveReview('draft');
  };

  const handleComplete = async () => {
    const reviewId = await wizard.saveReview('completed');
    if (reviewId) {
      onComplete(reviewId);
      onClose();
    }
  };

  const renderStep = () => {
    switch (wizard.currentStep) {
      case 'data_completeness':
        return <DataCompletenessStep {...wizard.dataCompleteness} />;
      case 'metrics_review':
        return <MetricsReviewStep {...wizard.metrics} />;
      case 'scorecard':
        return <ScorecardStep {...wizard.scorecard} />;
      case 'borrowing_capacity':
        return <BorrowingCapacityStep clientId={clientId} clientName={clientName} />;
      case 'flags_scenarios':
        return <FlagsScenariosStep flags={wizard.flags} scenarios={wizard.scenarios} />;
      case 'recommendations':
        return <RecommendationsStep recommendations={wizard.recommendations} />;
      case 'generate_report':
        const ownerOccupiedCount = properties.filter(p => 
          p.property_type?.toLowerCase() === 'owner_occupied' || 
          p.property_type?.toLowerCase() === 'owner-occupied' ||
          p.property_type?.toLowerCase() === 'ppor'
        ).length;
        const rentalCount = properties.filter(p => 
          p.property_type?.toLowerCase() === 'rental'
        ).length;
        const investmentCount = properties.length - ownerOccupiedCount - rentalCount;
        
        return (
          <GenerateReportStep
            clientId={clientId}
            clientName={clientName}
            overallScore={wizard.scorecard.overallScore}
            riskLevel={wizard.scorecard.riskLevel}
            totalValue={wizard.metrics.portfolioTotals.totalValue}
            monthlyCashflow={wizard.metrics.portfolioTotals.totalMonthlyCashflow}
            propertyCount={properties.length}
            highPriorityCount={wizard.recommendations.filter(r => r.priority === 'high').length}
            reviewFrequency={wizard.reviewFrequency}
            onReviewFrequencyChange={wizard.setReviewFrequency}
            includeOwnerOccupied={wizard.includeOwnerOccupied}
            onIncludeOwnerOccupiedChange={wizard.setIncludeOwnerOccupied}
            includeBorrowingCapacity={wizard.includeBorrowingCapacity}
            onIncludeBorrowingCapacityChange={wizard.setIncludeBorrowingCapacity}
            analysisConfig={wizard.analysisConfig}
            onAnalysisConfigChange={wizard.setAnalysisConfig}
            notes={wizard.notes}
            onNotesChange={wizard.setNotes}
            customInstructions={wizard.customInstructions}
            onCustomInstructionsChange={wizard.setCustomInstructions}
            ownerOccupiedCount={ownerOccupiedCount}
            investmentCount={investmentCount}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        bareLayout
        className="fixed left-1/2 top-1/2 grid h-[min(90vh,980px)] w-[calc(100vw-3rem)] max-w-[1320px] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:left-[calc(50%+8rem)] sm:w-[min(78vw,1320px)] sm:max-w-[calc(100vw-19rem)] [&>button]:hidden"
      >
        <DialogHeader className="min-w-0 border-b bg-background px-6 py-5">
          <div className="flex items-center justify-between">
            <DialogTitle className="min-w-0 truncate pr-4">{PORTFOLIO_REPORT_LABEL}: {clientName}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Close ${PORTFOLIO_REPORT_LABEL}`} className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="min-w-0 bg-background">
          <ReviewWizardSteps
            steps={wizard.steps}
            currentStep={wizard.currentStep}
            currentStepIndex={wizard.currentStepIndex}
            onStepClick={wizard.goToStep}
          />
        </div>

        <ScrollArea key={wizard.currentStep} className="min-h-0">
          <div className="min-w-0 px-6 py-5">
            {renderStep()}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between gap-3 border-t bg-background px-6 py-4">
          {wizard.currentStep === 'generate_report' ? <>
            <Button variant="outline" onClick={wizard.goPrev} disabled={!wizard.canGoPrev}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={handleSaveDraft} disabled={wizard.isSaving}>Save as Draft</Button>
              <Button onClick={handleComplete} disabled={wizard.isSaving}>{wizard.isSaving ? 'Completing…' : 'Complete Review'}</Button>
            </div>
          </> : <>
            <Button
              variant="outline"
              onClick={wizard.goPrev}
              disabled={!wizard.canGoPrev}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button onClick={wizard.goNext} disabled={!wizard.canGoNext}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export * from './types';
