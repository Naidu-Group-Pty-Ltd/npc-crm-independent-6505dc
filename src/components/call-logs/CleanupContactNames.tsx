import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { UserCheck, Loader2, CheckCircle, AlertCircle, RefreshCw, DatabaseZap, ShieldCheck } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { cn } from '@/lib/utils';


const cleanupDialogShell =
  'overflow-hidden border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/98 via-card dark:via-background/95 to-background dark:to-black/95 p-0 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/50 sm:max-w-2xl';
const cleanupSectionCard =
  'relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-gradient-to-br from-card dark:from-background/95 via-card dark:via-background/80 to-background dark:to-black/90 shadow-xl shadow-sm dark:shadow-black/25 before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-success/35 before:to-transparent';
const cleanupTriggerBase =
  'group gap-2 border-success/20 bg-success/10 text-success shadow-lg shadow-sm dark:shadow-black/20 transition-all hover:-translate-y-0.5 hover:border-success/40 hover:bg-success/15 hover:text-success hover:shadow-success/10 focus-visible:ring-2 focus-visible:ring-success/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black';

interface CleanupResult {
  id: string;
  status: string;
  name?: string;
}

interface CleanupResponse {
  success: boolean;
  message?: string;
  error?: string;
  processed: number;
  updated: number;
  skipped: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalRecords: number;
  results: CleanupResult[];
}

export const CleanupContactNames: React.FC<{ onComplete?: () => void; triggerClassName?: string }> = ({ onComplete, triggerClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [updatedCount, setUpdatedCount] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString('en-AU')}] ${message}`]);
  };

  const runCleanup = async () => {
    setIsRunning(true);
    setProgress(0);
    setProcessedCount(0);
    setUpdatedCount(0);
    setCurrentBatch(0);
    setLogs([]);

    addLog('Starting contact name cleanup...');
    addLog(forceUpdate ? 'Mode: Force update all records' : 'Mode: Update only missing/empty names');

    let offset = 0;
    const batchSize = 50;
    let hasMore = true;
    let totalUpdated = 0;
    let totalProcessed = 0;

    try {
      while (hasMore) {
        setCurrentBatch(prev => prev + 1);
        addLog(`Processing batch ${Math.floor(offset / batchSize) + 1}...`);

        const { data, error } = await invokeSecureFunction<CleanupResponse>('cleanup-call-log-names', {
          batchSize,
          offset,
          forceUpdate,
        });

        if (error) {
          addLog(`Error: ${error.message}`);
          toast.error(`Cleanup failed: ${error.message}`);
          break;
        }

        if (!data?.success) {
          addLog(`Error: ${data?.error || 'Unknown error'}`);
          toast.error(`Cleanup failed: ${data?.error}`);
          break;
        }

        totalProcessed += data.processed;
        totalUpdated += data.updated;
        setProcessedCount(totalProcessed);
        setUpdatedCount(totalUpdated);
        setTotalRecords(data.totalRecords);

        // Calculate progress
        const progressPercent = data.totalRecords > 0 
          ? Math.round((totalProcessed / data.totalRecords) * 100) 
          : 100;
        setProgress(progressPercent);

        addLog(`Batch complete: ${data.updated} updated, ${data.skipped} skipped`);

        // Log some sample updates
        const updates = data.results?.filter(r => r.status === 'updated').slice(0, 3) || [];
        updates.forEach(u => {
          if (u.name) addLog(`  → Updated: ${u.name}`);
        });

        hasMore = data.hasMore;
        if (data.nextOffset !== null) {
          offset = data.nextOffset;
        } else {
          hasMore = false;
        }

        // Small delay between batches to prevent rate limiting
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      addLog(`✓ Cleanup complete! Updated ${totalUpdated} of ${totalProcessed} records.`);
      toast.success(`Cleanup complete! Updated ${totalUpdated} contact names.`);

      // Log activity
      logActivityDirect({
        actionType: 'settings_updated',
        entityType: 'call_log',
        entityName: 'Contact Name Cleanup',
        metadata: { 
          action: 'cleanup_contact_names',
          totalProcessed, 
          totalUpdated,
          forceUpdate,
        }
      });

      // Trigger refresh if callback provided
      if (onComplete) {
        onComplete();
      }

    } catch (error: any) {
      addLog(`Error: ${error.message}`);
      toast.error(`Cleanup failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName || ''}`}>
          <UserCheck className="h-4 w-4 shrink-0" />
          Cleanup Names
        </Button>
      </DialogTrigger>
      <DialogContent className={cleanupDialogShell}>
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-success/60 to-transparent" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-success/10 blur-3xl" />
        <DialogHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.94),rgba(0,0,0,0.78),rgba(6,78,59,0.18))] px-6 py-5">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
            <ShieldCheck className="h-3 w-3" />
            Data Quality Utility
          </div>
          <DialogTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-success/25 bg-success/10 text-success shadow-inner shadow-success/40">
              <UserCheck className="h-5 w-5" />
            </span>
            Cleanup Contact Names
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <Card className={cleanupSectionCard}>
            <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-success/10 via-transparent to-info/10 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground"><DatabaseZap className="h-4 w-4 text-success" />What This Does</CardTitle>
              <CardDescription className="text-xs text-muted-foreground dark:text-muted-foreground">
                Syncs contact names from GoHighLevel CRM
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 text-sm text-muted-foreground dark:text-muted-foreground">
              <ul className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Looks up each call's phone number in GHL</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Updates customer name with GHL contact's full name</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Links GHL contact ID for future reference</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Applies proper name capitalization (Mc, Mac, O', etc.)</li>
              </ul>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between rounded-3xl border border-border dark:border-white/10 bg-white/[0.03] p-4 shadow-inner shadow-sm dark:shadow-black/20">
            <div className="space-y-0.5">
              <Label htmlFor="force-update" className="text-sm font-semibold text-foreground dark:text-foreground">
                Force Update All
              </Label>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                Re-sync all records, even those with existing names
              </p>
            </div>
            <Switch
              id="force-update"
              checked={forceUpdate}
              onCheckedChange={setForceUpdate}
              disabled={isRunning}
            />
          </div>

          {isRunning && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-foreground dark:text-foreground">
                <span>Processing batch {currentBatch}...</span>
                <span className="text-muted-foreground dark:text-muted-foreground">
                  {processedCount} / {totalRecords || '?'} records
                </span>
              </div>
              <Progress value={progress} className="h-2 overflow-hidden rounded-full bg-card/10 dark:bg-white/10" />
              <div className="flex items-center gap-4 text-sm">
                <Badge variant="outline" className="gap-1 rounded-full border-success/20 bg-success/10 text-success">
                  <CheckCircle className="h-3 w-3 text-success" />
                  {updatedCount} updated
                </Badge>
                <Badge variant="outline" className="gap-1 rounded-full border-border dark:border-white/10 bg-white/[0.03] text-muted-foreground dark:text-foreground">
                  <AlertCircle className="h-3 w-3 text-muted-foreground" />
                  {processedCount - updatedCount} skipped
                </Badge>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <Card className={cleanupSectionCard}>
              <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-info/10 via-transparent to-success/10 pb-2">
                <CardTitle className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Activity Log</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[150px] p-3">
                  <div className="space-y-1 font-mono text-xs">
                    {logs.map((log, i) => (
                      <div key={i} className="text-muted-foreground dark:text-muted-foreground">
                        {log}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Button
            onClick={runCleanup}
            disabled={isRunning}
            className="w-full gap-2 rounded-2xl bg-gradient-to-r from-success via-success to-success font-semibold text-black shadow-lg shadow-success/20 transition-all hover:-translate-y-0.5 hover:from-success hover:via-success hover:to-success hover:shadow-success/30 disabled:translate-y-0 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Start Cleanup
              </>
            )}
          </Button>

          <p className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs text-muted-foreground dark:text-muted-foreground">
            This may take a few minutes for large datasets. Do not close this dialog.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
