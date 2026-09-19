import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, Clock, Loader2, FileText, AlertCircle, PlayCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getAuthenticatedSupabaseClient } from '@/hooks/useAuthenticatedSupabase';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { PropertyListing } from '@/lib/airtable';
import { addBackgroundJob } from '@/components/BackgroundJobTracker';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useAuth } from '@/hooks/useAuth';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ReportGenerationStatus } from '@/components/billing/ReportGenerationStatus';
import { TokenCostEstimate } from '@/components/billing/TokenCostEstimate';
import { estimateTokens } from '@/lib/missionControl';

interface BulkGenerationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProperties: PropertyListing[];
  onComplete?: () => void;
}

interface JobStatus {
  id: string;
  status: string;
  total_reports: number;
  completed_reports: number;
  failed_reports: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ItemStatus {
  id: string;
  property_address: string;
  status: string;
  error_message: string | null;
  processing_time_seconds: number | null;
  report_id: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
}

export function BulkGenerationModal({ 
  open, 
  onOpenChange, 
  selectedProperties,
  onComplete 
}: BulkGenerationModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [items, setItems] = useState<ItemStatus[]>([]);
  const [runInBackground, setRunInBackground] = useState(false);
  const { toast } = useToast();
  const { addNotification } = useNotifications();
  const { user } = useAuth();
  const { logActivity } = useActivityLogger();

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setJobId(null);
      setJobStatus(null);
      setItems([]);
      setIsGenerating(false);
    }
  }, [open]);

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    const pollInterval = setInterval(async () => {
      await fetchJobStatus();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [jobId]);

  const fetchJobStatus = async () => {
    if (!jobId) return;

    try {
      // Fetch job status
      const { data: job } = await supabase
        .from('bulk_generation_jobs' as any)
        .select('*')
        .eq('id', jobId)
        .single();

      if (!job) return;
      
      if (typeof job === 'object' && 'status' in job!) {
        const typedJob = job! as any;
        setJobStatus(job! as unknown as JobStatus);

        // If job is completed or failed, stop generating state
        if (typedJob.status === 'completed' || typedJob.status === 'failed') {
          setIsGenerating(false);
          
          // Log bulk generation completion
          logActivity({
            actionType: 'bulk_generation_completed',
            entityType: 'bulk_generation_job',
            entityId: jobId,
            metadata: { 
              status: typedJob.status,
              completed_reports: typedJob.completed_reports,
              failed_reports: typedJob.failed_reports,
              total_reports: typedJob.total_reports
            }
          });
          
          // Show completion notification
          if (typedJob.status === 'completed') {
            toast({
              title: "Bulk Generation Complete",
              description: `Successfully generated ${typedJob.completed_reports} of ${typedJob.total_reports} reports`,
            });
          }
        }
      }

      // Fetch items status
      const { data: itemsData } = await supabase
        .from('bulk_generation_items' as any)
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (itemsData && Array.isArray(itemsData)) {
        setItems(itemsData as unknown as ItemStatus[]);
      }
    } catch (error) {
      console.error('Error fetching job status:', error);
    }
  };

  const startGeneration = async (background = false) => {
    setIsGenerating(true);
    setRunInBackground(background);

    try {
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Prepare properties for API
      const properties = selectedProperties.map(p => ({
        id: p.id,
        address: p.address || p.location,
        title: p.title,
        suburb: p.suburb,
        state: p.state,
        zipCode: p.zipCode,
      }));

      // Preflight token check (bulk = per-item estimate × count)
      const { runPreflight } = await import('@/lib/preflightTokens');
      const ok = await runPreflight({
        kind: 'report.investment.compass',
        functionName: 'generate-bulk-reports',
        label: 'Bulk reports',
        estimate: { aiNarrative: true, multiplier: properties.length },
      });
      if (!ok) { setIsGenerating(false); return; }

      // Call the edge function
      const { data, error } = await invokeSecureFunction('generate-bulk-reports', {
        properties,
        userId: user.id,
      });

      if (error) {
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to start bulk generation');
      }

      setJobId(data.jobId);
      
      // Log bulk generation activity
      logActivity({
        actionType: 'bulk_generation_started',
        entityType: 'bulk_generation_job',
        entityId: data.jobId,
        entityName: `Bulk: ${selectedProperties.length} properties`,
        metadata: { 
          propertyCount: selectedProperties.length,
          background,
          addresses: properties.map(p => p.address),
          propertyIds: properties.map(p => p.id),
        }
      });
      
      if (background) {
        addBackgroundJob({
          id: data.jobId,
          type: 'bulk_generation'
        });
        
        addNotification({
          type: 'info',
          title: 'Bulk Generation Started',
          message: `Processing ${selectedProperties.length} properties in the background. We'll notify you when it's complete.`
        });
        
        onOpenChange(false);
      } else {
        toast({
          title: "Bulk Generation Started",
          description: `Processing ${properties.length} properties...`,
        });

        // Fetch initial status
        setTimeout(() => fetchJobStatus(), 1000);
      }

    } catch (error) {
      console.error('Error starting bulk generation:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to start bulk generation',
        variant: "destructive",
      });
      setIsGenerating(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-info animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-success">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      case 'processing':
        return <Badge variant="secondary" className="bg-info">Processing</Badge>;
      default:
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  const progressPercentage = jobStatus 
    ? Math.round(((jobStatus.completed_reports + jobStatus.failed_reports) / jobStatus.total_reports) * 100)
    : 0;

  const handleClose = () => {
    if (jobStatus?.status === 'completed' || jobStatus?.status === 'failed') {
      onComplete?.();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Bulk Report Generation</DialogTitle>
          <DialogDescription>
            {!jobId 
              ? `Generate investment reports for ${selectedProperties.length} properties`
              : `Processing ${jobStatus?.total_reports || 0} properties`
            }
          </DialogDescription>
        </DialogHeader>

        {!jobId ? (
          // Initial confirmation screen
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-4 bg-muted/50">
              <h4 className="font-semibold mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Selected Properties ({selectedProperties.length})
              </h4>
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {selectedProperties.map((property, index) => (
                    <div key={property.id} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground">{index + 1}.</span>
                      <div>
                        <div className="font-medium">{property.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {property.address || property.location}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <p>
                This will generate {selectedProperties.length} investment reports. 
                Estimated time: {Math.ceil(selectedProperties.length * 0.8)} - {Math.ceil(selectedProperties.length * 1.2)} minutes.
              </p>
            </div>

            {/* Token cost + balance status (scales with selection) */}
            <ReportGenerationStatus
              estimate={estimateTokens('report.bulk-item') * Math.max(1, selectedProperties.length)}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Projected token cost ({selectedProperties.length} × ~{estimateTokens('report.bulk-item').toLocaleString('en-AU')} per report)
              </span>
              <TokenCostEstimate
                estimate={estimateTokens('report.bulk-item') * Math.max(1, selectedProperties.length)}
              />
            </div>

            <div className="flex gap-3">
              <Button onClick={() => startGeneration(false)} disabled={isGenerating} size="lg" className="flex-1">
                {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Generation
              </Button>
              <Button onClick={() => startGeneration(true)} disabled={isGenerating} variant="outline" size="lg" className="flex-1">
                <PlayCircle className="h-4 w-4 mr-2" />
                Run in Background
              </Button>
            </div>
          </div>
        ) : (
          // Progress screen
          <div className="space-y-4">
            {/* Overall Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Overall Progress</span>
                <span className="text-muted-foreground">
                  {jobStatus?.completed_reports || 0} completed, {jobStatus?.failed_reports || 0} failed
                </span>
              </div>
              <Progress value={progressPercentage} />
              <div className="text-xs text-muted-foreground text-center">
                {progressPercentage}% complete
              </div>
            </div>

            {/* Individual Items */}
            <div>
              <h4 className="font-semibold mb-2 text-sm">Properties</h4>
              <ScrollArea className="h-[300px] rounded-lg border border-border">
                <div className="p-4 space-y-3">
                  {items.map((item) => (
                    <div 
                      key={item.id}
                      className="flex items-start gap-3 pb-3 border-b border-border last:border-0"
                    >
                      <div className="mt-0.5">
                        {getStatusIcon(item.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {item.property_address}
                        </div>
                        {item.error_message && (
                          <div className="text-xs text-destructive mt-1">
                            {item.error_message}
                          </div>
                        )}
                        {(item.attempts ?? 0) > 1 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Attempt {item.attempts}{item.max_attempts ? ` of ${item.max_attempts}` : ''}
                          </div>
                        )}
                        {item.processing_time_seconds && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Completed in {item.processing_time_seconds}s
                          </div>
                        )}
                      </div>
                      <div>
                        {getStatusBadge(item.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end">
              {(jobStatus?.status === 'completed' || jobStatus?.status === 'failed') ? (
                <>
                  {(jobStatus?.failed_reports || 0) > 0 && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!jobId) return;
                        // Use the staff-JWT client so retry_failed_bulk_items can
                        // drop anon EXECUTE (RLS-W2); retrying is a staff action.
                        const { error } = await getAuthenticatedSupabaseClient().rpc('retry_failed_bulk_items' as any, { p_job_id: jobId });
                        if (error) {
                          toast({ title: 'Retry failed', description: error.message, variant: 'destructive' });
                          return;
                        }
                        toast({ title: 'Retrying failed reports', description: 'They will be processed shortly.' });
                        setIsGenerating(true);
                        await fetchJobStatus();
                      }}
                    >
                      Retry Failed ({jobStatus?.failed_reports})
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleClose}>
                    Close
                  </Button>
                  <Button onClick={() => {
                    handleClose();
                    window.location.href = '/generated-reports';
                  }}>
                    View Reports
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={handleClose}>
                  Continue in Background
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
