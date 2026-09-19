import { Calculator, FileSearch, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface CashFlowEmptyStateProps {
  variant: 'noReports' | 'noResults';
  onConfigureReports: () => void;
  onClearFilters?: () => void;
}

export function CashFlowEmptyState({ variant, onConfigureReports, onClearFilters }: CashFlowEmptyStateProps) {
  const isNoResults = variant === 'noResults';

  return (
    <Card className="overflow-hidden border-dashed bg-gradient-to-b from-background to-muted/20 py-12">
      <CardContent className="flex flex-col items-center justify-center px-6 text-center">
        <div className={`mb-4 rounded-3xl p-4 ${isNoResults ? 'bg-brand-50 text-brand-700' : 'bg-primary/10 text-primary'}`}>
          {isNoResults ? <FileSearch className="h-12 w-12" /> : <Calculator className="h-12 w-12" />}
        </div>
        <div className="max-w-xl space-y-2">
          <h3 className="text-xl font-semibold">
            {isNoResults ? 'No reports match the active filters' : 'No Reports Ready for Cash Flow Analysis'}
          </h3>
          <p className="text-muted-foreground">
            {isNoResults
              ? 'Try clearing search, date, or build-type filters to reveal more cash-flow-ready reports from the loaded library.'
              : 'Reports need purchase price and weekly rent data configured via Manual Data Overrides before they can be analyzed.'}
          </p>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {isNoResults && onClearFilters && (
            <Button variant="outline" onClick={onClearFilters}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
          )}
          <Button onClick={onConfigureReports}>
            Configure Reports
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
