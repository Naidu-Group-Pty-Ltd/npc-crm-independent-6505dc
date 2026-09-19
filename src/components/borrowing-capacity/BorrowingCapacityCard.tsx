import { useBorrowingCapacity } from '@/hooks/useBorrowingCapacity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  DollarSign, 
  Loader2, 
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Calculator,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { SnapshotDownloadButton } from './SnapshotDownloadButton';
import { fetchAndGenerateBorrowingCapacityPDF } from './BorrowingCapacityPDFReport';
import { BorrowingCapacitySegmentCard } from './BorrowingCapacitySegmentCard';

interface BorrowingCapacityCardProps {
  clientId: string;
  clientName?: string;
  onOpenCalculator?: () => void;
}

export function BorrowingCapacityCard({ clientId, clientName, onOpenCalculator }: BorrowingCapacityCardProps) {
  const {
    latestAssessment,
    isLoading,
    isCalculating,
    calculate,
    getDisplayResult,
    getSegmentReconciliation,
    getPortfolioCapacity,
  } = useBorrowingCapacity({ clientId });

  const result = getDisplayResult();
  const segmentReconciliation = getSegmentReconciliation();
  const portfolioCapacity = getPortfolioCapacity();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getBandConfig = (band: string) => {
    switch (band) {
      case 'green':
        return {
          color: 'bg-success/10 text-success border-success/20',
          icon: CheckCircle,
          label: 'Strong Position',
          progressColor: 'bg-success',
        };
      case 'amber':
        return {
          color: 'bg-warning/10 text-warning border-warning/20',
          icon: AlertTriangle,
          label: 'Moderate Capacity',
          progressColor: 'bg-warning',
        };
      case 'red':
      default:
        return {
          color: 'bg-destructive/10 text-destructive border-destructive/20',
          icon: AlertTriangle,
          label: 'Limited Capacity',
          progressColor: 'bg-destructive',
        };
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Borrowing Capacity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Calculate borrowing power based on income, expenses, and existing commitments.
          </p>
          <Button 
            onClick={() => calculate({})}
            disabled={isCalculating}
            size="sm"
            className="w-full"
          >
            {isCalculating ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Calculator className="h-4 w-4 mr-2" />
            )}
            Calculate Capacity
          </Button>
        </CardContent>
      </Card>
    );
  }

  const bandConfig = getBandConfig(result.band);
  const BandIcon = bandConfig.icon;


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Borrowing Capacity
            </CardTitle>
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SnapshotDownloadButton
                      appearance="menu"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      triggerLabel="Export Snapshot PDF"
                      request={{ clientId: clientId!, clientName: clientName || 'Client' }}
                      legacy={() => fetchAndGenerateBorrowingCapacityPDF(
                        clientId, clientName || 'Client', undefined, undefined, { returnBlob: true },
                      )}
                      label="Export Snapshot PDF"
                    />
                  </TooltipTrigger>
                  <TooltipContent>Export Snapshot PDF</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main Capacity Figure */}
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">
              {formatCurrency(result.capacity)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Maximum Borrowing Power
            </p>
          </div>

          {/* Serviceability Band Badge */}
          <div className="flex justify-center">
            <Badge className={bandConfig.color}>
              <BandIcon className="h-3 w-3 mr-1" />
              {bandConfig.label}
            </Badge>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="p-2 rounded-lg bg-secondary/50">
              <p className="text-xs text-muted-foreground">Monthly Surplus</p>
              <p className={`text-sm font-semibold ${result.surplus >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(result.surplus)}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-secondary/50">
              <p className="text-xs text-muted-foreground">DTI Ratio</p>
              <p className={`text-sm font-semibold ${result.dtiRatio < 6 ? 'text-success' : result.dtiRatio < 8 ? 'text-warning' : 'text-destructive'}`}>
                {result.dtiRatio.toFixed(1)}x
              </p>
            </div>
          </div>

          {/* Stress Tested Capacity */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                Stress-Tested Capacity
              </span>
              <span className="font-medium">{formatCurrency(result.stressTested)}</span>
            </div>
            <Progress
              value={(result.stressTested / result.capacity) * 100}
              className="h-2"
            />
          </div>

          {/* Last Calculated */}
          {result.lastCalculated && (
            <p className="text-xs text-muted-foreground text-center">
              Last calculated {formatDistanceToNow(new Date(result.lastCalculated), { addSuffix: true })}
            </p>
          )}

          {/* Open Full Calculator Button */}
          {onOpenCalculator && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onOpenCalculator}
            >
              View Full Calculator
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Phase 3 — Hybrid portfolio segment breakdown (commercial/industrial) */}
      <BorrowingCapacitySegmentCard
        reconciliation={segmentReconciliation}
        residentialCapacity={result.capacity}
        portfolioCapacity={portfolioCapacity}
      />
    </div>
  );
}
