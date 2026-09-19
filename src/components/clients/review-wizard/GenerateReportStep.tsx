import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { PortfolioReportDownloadButton } from '@/components/clients/PortfolioReportDownloadButton';
import { Badge } from '@/components/ui/badge';
import { PortfolioAnalysisPDFGenerator } from '../PortfolioAnalysisPDFGenerator';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText,
  Calendar,
  Home,
  Building2,
  Info,
  Landmark,
  MessageSquareText,
  Sparkles
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PortfolioAnalysisConfig, PortfolioAnalysisSettings } from './PortfolioAnalysisConfig';
import { VoiceNoteRecorder } from '../VoiceNoteRecorder';

interface GenerateReportStepProps {
  clientId: string;
  clientName: string;
  overallScore: number;
  riskLevel: string;
  totalValue: number;
  monthlyCashflow: number;
  propertyCount: number;
  highPriorityCount: number;
  reviewFrequency: 'quarterly' | 'bi_annual' | 'annual';
  onReviewFrequencyChange: (frequency: 'quarterly' | 'bi_annual' | 'annual') => void;
  includeOwnerOccupied: boolean;
  onIncludeOwnerOccupiedChange: (include: boolean) => void;
  includeBorrowingCapacity: boolean;
  onIncludeBorrowingCapacityChange: (include: boolean) => void;
  analysisConfig: PortfolioAnalysisSettings;
  onAnalysisConfigChange: (config: PortfolioAnalysisSettings) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  customInstructions: string;
  onCustomInstructionsChange: (instructions: string) => void;
  ownerOccupiedCount: number;
  investmentCount: number;
}

export function GenerateReportStep({
  clientId,
  clientName,
  overallScore,
  riskLevel,
  totalValue,
  monthlyCashflow,
  propertyCount,
  highPriorityCount,
  reviewFrequency,
  onReviewFrequencyChange,
  includeOwnerOccupied,
  onIncludeOwnerOccupiedChange,
  includeBorrowingCapacity,
  onIncludeBorrowingCapacityChange,
  analysisConfig,
  onAnalysisConfigChange,
  notes,
  onNotesChange,
  customInstructions,
  onCustomInstructionsChange,
  ownerOccupiedCount,
  investmentCount,
}: GenerateReportStepProps) {

  const getNextReviewDate = () => {
    const days = reviewFrequency === 'quarterly' ? 90 : reviewFrequency === 'bi_annual' ? 180 : 365;
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    }
    return `$${value.toLocaleString('en-AU')}`;
  };

  return (
    <div className="space-y-6">
      {/* Review Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Review Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-3xl font-bold text-primary">{overallScore}</div>
              <p className="text-xs text-muted-foreground">Overall Score</p>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <Badge className={
                riskLevel === 'low' ? 'bg-success/10 text-success' :
                riskLevel === 'medium' ? 'bg-brand-500/10 text-brand-600' :
                riskLevel === 'high' ? 'bg-warning/10 text-warning' :
                'bg-destructive/10 text-destructive'
              }>
                {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)} Risk
              </Badge>
              <p className="text-xs text-muted-foreground mt-2">Risk Level</p>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-xl font-bold">{formatCurrency(totalValue)}</div>
              <p className="text-xs text-muted-foreground">Portfolio Value</p>
            </div>
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className={`text-xl font-bold ${monthlyCashflow >= 0 ? 'text-success' : 'text-destructive'}`}>
                ${monthlyCashflow.toLocaleString('en-AU')}/mo
              </div>
              <p className="text-xs text-muted-foreground">Net Cash Flow</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm">
              <span className="text-muted-foreground">Properties reviewed: </span>
              <span className="font-medium">{propertyCount}</span>
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Action items: </span>
              <span className={`font-medium ${highPriorityCount > 0 ? 'text-destructive' : 'text-success'}`}>
                {highPriorityCount} high priority
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Owner-Occupied Toggle */}
      {ownerOccupiedCount > 0 && (
        <Card className="border-brand-200 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Home className="h-5 w-5 text-brand-600" />
              Owner-Occupied Properties
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>When disabled, owner-occupied properties are excluded from portfolio-level calculations (value, debt, equity, LVR, scores) but still shown in property list for reference.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label htmlFor="include-owner-occupied" className="text-sm font-medium">
                  Include in Portfolio Calculations
                </Label>
                <p className="text-xs text-muted-foreground">
                  {ownerOccupiedCount} owner-occupied, {investmentCount} investment properties
                </p>
              </div>
              <Switch
                id="include-owner-occupied"
                checked={includeOwnerOccupied}
                onCheckedChange={onIncludeOwnerOccupiedChange}
              />
            </div>
            
            {!includeOwnerOccupied && (
              <div className="p-3 bg-brand-100/50 dark:bg-brand-900/20 rounded-lg border border-brand-200 dark:border-brand-800">
                <div className="flex items-start gap-2">
                  <Building2 className="h-4 w-4 text-brand-600 mt-0.5" />
                  <p className="text-xs text-brand-700 dark:text-brand-300">
                    Portfolio metrics now reflect <strong>investment properties only</strong>. 
                    Owner-occupied properties will still appear in property lists but won't affect 
                    portfolio value, LVR, or score calculations.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Borrowing Capacity Toggle */}
      <Card className="border-info/30 bg-info/50 dark:border-info/30 dark:bg-info/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Landmark className="h-5 w-5 text-info" />
            Borrowing Capacity Section
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Control whether the Borrowing Capacity section is included in the final Portfolio Performance Report PDF export.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="include-borrowing-capacity" className="text-sm font-medium">
                Include in Report
              </Label>
              <p className="text-xs text-muted-foreground">
                Show borrowing capacity assessment in PDF export
              </p>
            </div>
            <Switch
              id="include-borrowing-capacity"
              checked={includeBorrowingCapacity}
              onCheckedChange={onIncludeBorrowingCapacityChange}
            />
          </div>
          
          {!includeBorrowingCapacity && (
            <div className="p-3 bg-info/50 dark:bg-info/20 rounded-lg border border-info/30 dark:border-info/30">
              <div className="flex items-start gap-2">
                <Landmark className="h-4 w-4 text-info mt-0.5" />
                <p className="text-xs text-info dark:text-info">
                  The Borrowing Capacity section will be <strong>excluded</strong> from the 
                  Portfolio Performance Report PDF. All other sections will remain.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Analysis Configuration */}
      <PortfolioAnalysisConfig
        settings={analysisConfig}
        onChange={onAnalysisConfigChange}
      />

      {/* Custom Instructions for Report */}
      <Card className="border-accent/30 bg-accent/50 dark:border-accent/30 dark:bg-accent/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-accent" />
            Custom Report Instructions
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Provide specific guidance on how the AI should phrase the report. For example, adjust the tone for the client's risk appetite, highlight specific concerns, or emphasise certain strategies.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Add any specific instructions to tailor the report's language and focus. The report structure stays the same — these instructions influence how findings are phrased and what's emphasised.
          </p>
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <Textarea
                placeholder="e.g. 'Client is very risk-averse — use cautious language and emphasise capital preservation over growth. Highlight the importance of maintaining low LVR across the portfolio.'"
                value={customInstructions}
                onChange={(e) => onCustomInstructionsChange(e.target.value)}
                rows={4}
                className="text-sm"
              />
            </div>
            <div className="flex-shrink-0 pt-1">
              <VoiceNoteRecorder
                noteType="report-instructions"
                onTranscriptReady={(text) => onCustomInstructionsChange(customInstructions ? `${customInstructions}\n\n${text}` : text)}
              />
            </div>
          </div>
          {customInstructions && (
            <p className="text-xs text-accent dark:text-accent">
              ✓ Custom instructions will be applied to the generated report
            </p>
          )}
        </CardContent>
      </Card>

      {/* Review Frequency */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Review Schedule
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Review Frequency</Label>
            <Select value={reviewFrequency} onValueChange={onReviewFrequencyChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quarterly">Quarterly (every 3 months)</SelectItem>
                <SelectItem value="bi_annual">Bi-Annual (every 6 months)</SelectItem>
                <SelectItem value="annual">Annual (every 12 months)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-sm">
              <span className="text-muted-foreground">Next review due: </span>
              <span className="font-medium">{getNextReviewDate()}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Additional Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Additional Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Add any additional notes or observations from this review..."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={4}
          />
        </CardContent>
      </Card>

      {/* Generate Portfolio Performance Report */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generate Performance Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Generate a comprehensive Portfolio Performance Analysis PDF using the investor profile settings configured above.
          </p>
          <PortfolioAnalysisPDFGenerator
            clientId={clientId}
            clientName={clientName}
            includeBorrowingCapacity={includeBorrowingCapacity}
            includeOwnerOccupied={includeOwnerOccupied}
            analysisConfig={analysisConfig}
            customInstructions={customInstructions}
          />
        </CardContent>
      </Card>

      {/*
        The typeset review, as a sibling card rather than a second button inside
        the generator's own dialog.

        It belongs here and not there because of when the row exists. Inside that
        dialog the analysis is still only in component state — the
        `portfolio_analysis_reports` row is not inserted until *Download & Save*
        runs — so a server route that reads the persisted row would have nothing
        to read. This card typesets the most recent saved report, which is the
        one the generator above has just written.
      */}
      <TypesetReviewCard clientId={clientId} />

    </div>
  );
}

/**
 * The server-rendered Portfolio Performance Review for this client's most
 * recent saved report.
 *
 * Its own component so the query it needs does not run on every render of the
 * step around it, and so the "no saved report yet" state is one branch rather
 * than three conditionals in the middle of a form.
 */
function TypesetReviewCard({ clientId }: { clientId: string }) {
  const { data: latest, isLoading } = useQuery({
    queryKey: ['portfolio-analysis-reports', clientId, 'latest'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'portfolio_analysis_reports',
          select: 'id, created_at, pdf_file_path',
          orderBy: 'created_at',
          order_asc: false,
          filters: { client_id: clientId },
        },
      });
      if (error) throw new Error(error.message);
      return ((data?.records ?? []) as Array<{
        id: string;
        created_at: string;
        pdf_file_path: string | null;
      }>)[0] ?? null;
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Typeset Review
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The same analysis, typeset server-side on your branding — a generated
          contents page, the full holdings matrix in landscape, and every figure
          the record holds. Reads the most recently saved report, so generate one
          above first if there is none.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Looking for a saved report…</p>
        ) : latest ? (
          <div className="flex flex-wrap items-center gap-3">
            <PortfolioReportDownloadButton
              reportId={latest.id}
              storedPath={latest.pdf_file_path}
              storedFileName={`Portfolio_Analysis_${format(new Date(latest.created_at), 'yyyy-MM-dd')}.pdf`}
            />
            <span className="text-xs text-muted-foreground">
              From the report of {format(new Date(latest.created_at), 'dd MMM yyyy')}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No saved report for this client yet. Generate one above, and it will
            appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
