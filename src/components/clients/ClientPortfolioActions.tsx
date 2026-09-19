import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PortfolioAnalysisPDFGenerator } from './PortfolioAnalysisPDFGenerator';
import { ComparisonViewer } from '@/components/reports/ComparisonViewer';
import { toast } from 'sonner';
import {
  TrendingUp,
  GitCompare,
  Loader2,
  FileText,
  CheckCircle2,
  Building2,
  History,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

interface ClientProperty {
  id: string;
  address: string;
  property_type: string;
  value: number | null;
}

interface InvestmentReport {
  id: string;
  property_address: string;
  status: string;
  created_at: string;
  client_property_id: string;
}

interface ClientPortfolioActionsProps {
  clientId: string;
  clientName: string;
  properties: ClientProperty[];
}

export function ClientPortfolioActions({
  clientId,
  clientName,
  properties,
}: ClientPortfolioActionsProps) {
  const [showComparisonDialog, setShowComparisonDialog] = useState(false);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [showComparisonViewer, setShowComparisonViewer] = useState(false);
  
  // Comparison settings
  const [analysisDepth, setAnalysisDepth] = useState('Standard');
  const [investorProfile, setInvestorProfile] = useState('Balanced');
  const [timeHorizon, setTimeHorizon] = useState('5-10 years');
  const [riskTolerance, setRiskTolerance] = useState('Medium');

  // Fetch all completed investment reports for this client's properties
  const { data: allReports = [], isLoading: loadingReports } = useQuery({
    queryKey: ['client-all-property-reports', clientId],
    queryFn: async () => {
      const propertyIds = properties
        .filter(p => p.property_type === 'investment' || p.property_type === 'smsf')
        .map(p => p.id);
      
      if (propertyIds.length === 0) return [];

      // Through the server, not the table: the SELECT policy admits the
      // report's author and the client's owner, so a colleague opening this
      // client saw an empty list and a healthy screen.
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: { clientPropertyIds: propertyIds, isClientReport: true, status: 'completed', pageSize: 200 },
      });

      if (error) throw error;
      return ((data?.reports ?? []) as InvestmentReport[]);
    },
    enabled: properties.length > 0,
  });

  // Get unique properties with completed reports (latest report per property)
  const propertiesWithReports = properties
    .filter(p => p.property_type === 'investment' || p.property_type === 'smsf')
    .map(property => {
      const reports = allReports.filter(r => r.client_property_id === property.id);
      const latestReport = reports[0]; // Already sorted by created_at desc
      return {
        ...property,
        latestReport,
        reportCount: reports.length,
      };
    })
    .filter(p => p.latestReport);

  const hasEnoughForComparison = propertiesWithReports.length >= 2;
  const hasEnoughForPortfolio = propertiesWithReports.length >= 2;

  const handleSelectReport = (reportId: string, selected: boolean) => {
    if (selected) {
      if (selectedReportIds.length < 3) {
        setSelectedReportIds([...selectedReportIds, reportId]);
      } else {
        toast.error('Maximum 3 properties can be compared at once');
      }
    } else {
      setSelectedReportIds(selectedReportIds.filter(id => id !== reportId));
    }
  };

  const handleStartComparison = async () => {
    if (selectedReportIds.length < 2) {
      toast.error('Select at least 2 properties to compare');
      return;
    }

    setIsComparing(true);
    try {
      const { data, error } = await invokeSecureFunction('compare-investment-reports', {
        reportIds: selectedReportIds,
        analysisDepth,
        investorProfile,
        timeHorizon,
        riskTolerance,
      }, { timeoutMs: 150000 });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Comparison failed');

      // Fetch the full comparison data
      const { data: comparisonData, error: fetchError } = await supabase
        .from('property_comparisons')
        .select('*')
        .eq('id', data.comparisonId)
        .single();

      if (fetchError) throw fetchError;

      setComparisonResult(comparisonData);
      setShowComparisonDialog(false);
      setShowComparisonViewer(true);
      toast.success('Property comparison complete!');
    } catch (error: any) {
      console.error('Comparison error:', error);
      toast.error('Failed to compare properties: ' + error.message);
    } finally {
      setIsComparing(false);
    }
  };

  const openComparisonDialog = () => {
    // Pre-select latest reports from each property (up to 3)
    const preSelected = propertiesWithReports
      .slice(0, 3)
      .map(p => p.latestReport!.id);
    setSelectedReportIds(preSelected);
    setShowComparisonDialog(true);
  };

  if (properties.length === 0) return null;

  const investmentProperties = properties.filter(
    p => p.property_type === 'investment' || p.property_type === 'smsf'
  );

  if (investmentProperties.length === 0) return null;

  return (
    <>
      <Card className="bg-muted/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Portfolio Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {/* Portfolio Analysis */}
            <PortfolioAnalysisPDFGenerator
              clientId={clientId}
              clientName={clientName}
            />

            {/* Property Comparison */}
            <Button
              variant="outline"
              size="sm"
              onClick={openComparisonDialog}
              disabled={!hasEnoughForComparison || loadingReports}
            >
              <GitCompare className="h-4 w-4 mr-2" />
              Compare Properties
            </Button>

            {/* View Past Reports */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Navigate to portfolio reports with client filter
                window.location.href = `/portfolio-reports?clientId=${clientId}`;
              }}
            >
              <History className="h-4 w-4 mr-2" />
              View Past Reports
            </Button>
          </div>

          {!hasEnoughForComparison && propertiesWithReports.length < 2 && (
            <p className="text-xs text-muted-foreground">
              Generate investment reports for at least 2 properties to enable comparison.
            </p>
          )}

          {loadingReports && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading reports...
            </p>
          )}
        </CardContent>
      </Card>

      {/* Comparison Selection Dialog */}
      <Dialog open={showComparisonDialog} onOpenChange={setShowComparisonDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" />
              Compare Property Investments
            </DialogTitle>
            <DialogDescription>
              Select 2-3 properties to compare their investment potential
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {/* Property Selection */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Select Properties ({selectedReportIds.length}/3)</h4>
                {propertiesWithReports.map((property) => (
                  <div
                    key={property.id}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedReportIds.includes(property.latestReport!.id)
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => handleSelectReport(
                      property.latestReport!.id,
                      !selectedReportIds.includes(property.latestReport!.id)
                    )}
                  >
                    <Checkbox
                      checked={selectedReportIds.includes(property.latestReport!.id)}
                      onCheckedChange={(checked) => handleSelectReport(property.latestReport!.id, !!checked)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm truncate">{property.address}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-xs">
                          {property.property_type === 'smsf' ? 'SMSF' : 'Investment'}
                        </Badge>
                        <span>•</span>
                        <span>Report: {format(new Date(property.latestReport!.created_at), 'dd MMM yyyy')}</span>
                        {property.reportCount > 1 && (
                          <>
                            <span>•</span>
                            <span>{property.reportCount} versions</span>
                          </>
                        )}
                      </div>
                    </div>
                    <CheckCircle2 
                      className={`h-5 w-5 ${
                        selectedReportIds.includes(property.latestReport!.id)
                          ? 'text-primary'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  </div>
                ))}
              </div>

              <Separator />

              {/* Comparison Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Analysis Depth</label>
                  <Select value={analysisDepth} onValueChange={setAnalysisDepth}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Quick">Quick Overview</SelectItem>
                      <SelectItem value="Standard">Standard Analysis</SelectItem>
                      <SelectItem value="Deep Dive">Deep Dive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Investor Profile</label>
                  <Select value={investorProfile} onValueChange={setInvestorProfile}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Conservative">Conservative</SelectItem>
                      <SelectItem value="Balanced">Balanced</SelectItem>
                      <SelectItem value="Growth">Growth</SelectItem>
                      <SelectItem value="Aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Time Horizon</label>
                  <Select value={timeHorizon} onValueChange={setTimeHorizon}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-2 years">1-2 years</SelectItem>
                      <SelectItem value="3-5 years">3-5 years</SelectItem>
                      <SelectItem value="5-10 years">5-10 years</SelectItem>
                      <SelectItem value="10+ years">10+ years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Risk Tolerance</label>
                  <Select value={riskTolerance} onValueChange={setRiskTolerance}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => setShowComparisonDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStartComparison}
              disabled={selectedReportIds.length < 2 || isComparing}
            >
              {isComparing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Comparing...
                </>
              ) : (
                <>
                  <GitCompare className="h-4 w-4 mr-2" />
                  Compare {selectedReportIds.length} Properties
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Comparison Viewer */}
      <ComparisonViewer
        isOpen={showComparisonViewer}
        onClose={() => setShowComparisonViewer(false)}
        comparison={comparisonResult}
      />
    </>
  );
}
