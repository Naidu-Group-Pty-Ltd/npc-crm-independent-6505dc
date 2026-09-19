import { useState, useEffect } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { History, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, FileText, ChevronRight, GitCompare, RotateCcw, Eye, FileStack, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { ReportVersionComparison } from './ReportVersionComparison';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VersionHistoryProps {
  reportId: string;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVersionRestored?: () => void;
}

interface Version {
  version_number: number;
  created_at: string;
  quality_score: number;
  validation_count: number;
  changelog: string;
  content_preview?: string;
  changes_summary: {
    property_specs_changed: boolean;
    financial_data_changed: boolean;
    validation_flags_changed: boolean;
    content_length: number;
    data_sources_count: number;
  };
}

export function ReportVersionHistory({ reportId, currentVersion, open, onOpenChange, onVersionRestored }: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null);
  const [comparisonVersionA, setComparisonVersionA] = useState<number | null>(null);
  const [comparisonVersionB, setComparisonVersionB] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [showRollbackDialog, setShowRollbackDialog] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<{ version: number; content: string } | null>(null);

  useEffect(() => {
    if (open) {
      fetchVersionHistory();
    }
  }, [open, reportId]);

  const fetchVersionHistory = async () => {
    try {
      setLoading(true);
      
      // Use RPC via edge function
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'rpc',
        table: 'report_structure_templates', // Not used for RPC but required
        rpcName: 'get_report_changelog',
        rpcParams: {
          p_report_id: reportId,
          p_version_from: null,
          p_version_to: null
        }
      });

      if (error) {
        console.error('Error fetching version history:', error);
        toast.error('Failed to load version history');
        return;
      }

      setVersions((data?.data || []) as unknown as Version[]);
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to load version history');
    } finally {
      setLoading(false);
    }
  };

  const getQualityScoreColor = (score: number): string => {
    if (score >= 90) return 'text-success dark:text-success';
    if (score >= 75) return 'text-info dark:text-info';
    if (score >= 60) return 'text-brand-600 dark:text-brand-400';
    return 'text-destructive dark:text-destructive';
  };

  const getQualityTrend = (currentScore: number, previousScore: number | null): JSX.Element | null => {
    if (previousScore === null) return null;
    
    if (currentScore > previousScore) {
      return <TrendingUp className="h-4 w-4 text-success" />;
    } else if (currentScore < previousScore) {
      return <TrendingDown className="h-4 w-4 text-destructive" />;
    }
    return null;
  };

  const handleCompareSelect = (versionNumber: number) => {
    if (!comparisonVersionA) {
      setComparisonVersionA(versionNumber);
      toast.info('Select a second version to compare');
    } else if (!comparisonVersionB) {
      setComparisonVersionB(versionNumber);
      setShowComparison(true);
    } else {
      // Reset and start new comparison
      setComparisonVersionA(versionNumber);
      setComparisonVersionB(null);
      toast.info('Select a second version to compare');
    }
  };

  const handleRollback = async () => {
    if (!rollbackVersion) return;

    try {
      setRollbackLoading(true);

      // Fetch the version data to rollback to via edge function
      const { data: versionResult, error: fetchError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'getVersion',
        reportId,
        data: { versionNumber: rollbackVersion }
      });

      if (fetchError) throw new Error(fetchError.message);
      const versionData = versionResult?.version;
      if (!versionData) throw new Error('Version not found');

      // Update the main report with the version data
      const { error: updateError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId,
        data: {
          report_content: versionData.report_content,
          sources_content: versionData.sources_content,
          property_specs: versionData.property_specs,
          validation_flags: versionData.validation_flags,
          data_sources: versionData.data_sources,
          financial_calculations: versionData.financial_calculations,
          investment_score: versionData.investment_score,
          location_intelligence: versionData.location_intelligence,
          demographics_data: versionData.demographics_data,
          economic_data: versionData.economic_data,
          calculation_version: versionData.calculation_version,
          current_version: rollbackVersion,
          updated_at: new Date().toISOString(),
        }
      });

      if (updateError) throw new Error(updateError.message);

      toast.success(`Rolled back to version ${rollbackVersion}`, {
        description: 'The report has been restored to the selected version.'
      });
      setShowRollbackDialog(false);
      setRollbackVersion(null);
      fetchVersionHistory();
      
      if (onVersionRestored) {
        onVersionRestored();
      } else {
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error('Rollback error:', error);
      toast.error('Failed to rollback report version');
    } finally {
      setRollbackLoading(false);
    }
  };

  const fetchContentPreview = async (versionNumber: number) => {
    try {
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'getVersion',
        reportId,
        data: { versionNumber }
      });

      if (error) throw new Error(error.message);
      
      const preview = data?.version?.report_content?.substring(0, 1000) || '';
      setPreviewVersion({ version: versionNumber, content: preview });
    } catch (error) {
      console.error('Error fetching preview:', error);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>Loading version history...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </DialogTitle>
          <DialogDescription>
            Track changes and improvements across {versions.length} version{versions.length !== 1 ? 's' : ''}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="timeline" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-4">
            <ScrollArea className="h-[500px] pr-4">
              {versions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 space-y-4">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">No version history yet</p>
                    <p className="text-sm text-muted-foreground">
                      Version history will appear here when you regenerate this report
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {versions.map((version, index) => {
                    const previousVersion = versions[index + 1];
                    const isCurrent = version.version_number === currentVersion;
                    
                    return (
                      <Card key={version.version_number} className={isCurrent ? 'border-primary' : ''}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">
                                Version {version.version_number}
                              </CardTitle>
                              {isCurrent && (
                                <Badge variant="default">Current</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`text-2xl font-bold ${getQualityScoreColor(version.quality_score)}`}>
                                {version.quality_score}
                              </div>
                              {previousVersion && getQualityTrend(version.quality_score, previousVersion.quality_score)}
                            </div>
                          </div>
                          <CardDescription className="text-xs">
                            {format(new Date(version.created_at), 'PPp')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {/* Quality Metrics */}
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Validation Issues:</span>
                              <div className="flex items-center gap-1">
                                {version.validation_count === 0 ? (
                                  <>
                                    <CheckCircle className="h-3 w-3 text-success" />
                                    <span className="font-medium text-success">None</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="h-3 w-3 text-brand-600" />
                                    <span className="font-medium">{version.validation_count}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Data Sources:</span>
                              <span className="font-medium">{version.changes_summary.data_sources_count}</span>
                            </div>
                          </div>

                          {/* Changelog */}
                          {version.changelog && (
                            <div className="pt-2">
                              <p className="text-sm text-muted-foreground italic">
                                {version.changelog}
                              </p>
                            </div>
                          )}

                          {/* Change Indicators */}
                          {previousVersion && (
                            <div className="pt-2 space-y-1">
                              <Separator className="mb-2" />
                              <p className="text-xs font-medium text-muted-foreground">Changes from previous version:</p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {version.changes_summary.property_specs_changed && (
                                  <div className="flex items-center gap-1">
                                    <ChevronRight className="h-3 w-3 text-info" />
                                    <span>Property specs updated</span>
                                  </div>
                                )}
                                {version.changes_summary.financial_data_changed && (
                                  <div className="flex items-center gap-1">
                                    <ChevronRight className="h-3 w-3 text-info" />
                                    <span>Financial data updated</span>
                                  </div>
                                )}
                                {version.changes_summary.validation_flags_changed && (
                                  <div className="flex items-center gap-1">
                                    <ChevronRight className="h-3 w-3 text-info" />
                                    <span>Validation results changed</span>
                                  </div>
                                )}
                                <div className="flex items-center gap-1">
                                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-muted-foreground">
                                    Content: {version.changes_summary.content_length.toLocaleString('en-AU')} chars
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2 mt-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => fetchContentPreview(version.version_number)}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Preview content</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="flex-1"
                              onClick={() => handleCompareSelect(version.version_number)}
                              disabled={comparisonVersionA === version.version_number || comparisonVersionB === version.version_number}
                            >
                              <GitCompare className="h-4 w-4 mr-1" />
                              {comparisonVersionA === version.version_number || comparisonVersionB === version.version_number ? 'Selected' : 'Compare'}
                            </Button>
                            
                            {!isCurrent && (
                              <Button 
                                variant="default" 
                                size="sm" 
                                className="flex-1"
                                onClick={() => {
                                  setRollbackVersion(version.version_number);
                                  setShowRollbackDialog(true);
                                }}
                              >
                                <RotateCcw className="h-4 w-4 mr-1" />
                                Restore
                              </Button>
                            )}
                          </div>
                          
                          {/* Content Preview */}
                          {previewVersion?.version === version.version_number && (
                            <div className="mt-3 p-3 bg-muted/50 rounded-lg border">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-muted-foreground">Content Preview</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-2 text-xs"
                                  onClick={() => setPreviewVersion(null)}
                                >
                                  Close
                                </Button>
                              </div>
                              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                                {previewVersion.content}...
                              </pre>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quality Score Trend</CardTitle>
                <CardDescription>How report quality has evolved over time</CardDescription>
              </CardHeader>
              <CardContent>
                {versions.length > 0 ? (
                  <div className="space-y-2">
                    {versions.slice().reverse().map((version, index) => (
                      <div key={version.version_number} className="flex items-center gap-4">
                        <div className="w-20 text-sm text-muted-foreground">
                          v{version.version_number}
                        </div>
                        <div className="flex-1">
                          <div className="h-8 bg-muted rounded-md overflow-hidden">
                            <div 
                              className={`h-full transition-all ${
                                version.quality_score >= 90 ? 'bg-success' :
                                version.quality_score >= 75 ? 'bg-info' :
                                version.quality_score >= 60 ? 'bg-brand-600' :
                                'bg-destructive'
                              }`}
                              style={{ width: `${version.quality_score}%` }}
                            />
                          </div>
                        </div>
                        <div className="w-16 text-right font-medium">
                          {version.quality_score}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No data available for comparison
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Comparison status indicator */}
        {(comparisonVersionA || comparisonVersionB) && (
          <div className="fixed bottom-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg">
            <div className="flex items-center gap-2 text-sm">
              <GitCompare className="h-4 w-4" />
              <span>
                {comparisonVersionA && !comparisonVersionB && `Version ${comparisonVersionA} selected - select another`}
                {comparisonVersionA && comparisonVersionB && `Comparing v${comparisonVersionA} with v${comparisonVersionB}`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-primary-foreground hover:text-primary-foreground/80"
                onClick={() => {
                  setComparisonVersionA(null);
                  setComparisonVersionB(null);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      {/* Version Comparison Modal */}
      <ReportVersionComparison
        reportId={reportId}
        versionA={comparisonVersionA || 0}
        versionB={comparisonVersionB || 0}
        open={showComparison && !!comparisonVersionA && !!comparisonVersionB}
        onOpenChange={(open) => {
          setShowComparison(open);
          if (!open) {
            setComparisonVersionA(null);
            setComparisonVersionB(null);
          }
        }}
      />

      {/* Rollback Confirmation Dialog */}
      <AlertDialog open={showRollbackDialog} onOpenChange={setShowRollbackDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Restore Version {rollbackVersion}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will restore the report to version {rollbackVersion}. The restoration includes:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>All report content and narrative</li>
                <li>Financial calculations and metrics</li>
                <li>Property specifications</li>
                <li>Investment score data</li>
              </ul>
              <div className="p-3 bg-muted rounded-lg mt-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <FileStack className="h-4 w-4" />
                  Your current version will remain in history
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  You can always restore to any previous version later.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollbackLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRollback}
              disabled={rollbackLoading}
            >
              {rollbackLoading ? (
                <>
                  <Clock className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore Version {rollbackVersion}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
