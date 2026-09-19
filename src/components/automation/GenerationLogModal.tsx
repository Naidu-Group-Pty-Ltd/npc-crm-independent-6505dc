import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { CheckCircle, XCircle, Clock, FileText } from 'lucide-react';

interface GenerationLogEntry {
  id: string;
  listing_id: string;
  listing_address: string;
  switch_id: string | null;
  switch_name: string | null;
  report_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface GenerationLogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GenerationLogModal = ({ open, onOpenChange }: GenerationLogModalProps) => {
  const [logs, setLogs] = useState<GenerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) {
      fetchLogs();
    }
  }, [open]);

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('auto_report_generation_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (!error) {
      setLogs(data || []);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="border-success/30 bg-success/15 text-success shadow-sm dark:text-success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="shadow-sm">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'pending':
      case 'processing':
        return (
          <Badge variant="outline" className="border-warning/35 bg-warning/10 text-warning shadow-sm">
            <Clock className="h-3 w-3 mr-1" />
            {status === 'pending' ? 'Pending' : 'Processing'}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-3xl border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)/0.92))] p-0 shadow-[0_24px_80px_rgba(15,23,42,0.16)] dark:border-white/10 dark:shadow-black/40 sm:w-auto">
        <DialogHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
          <DialogTitle className="flex items-center gap-3 text-xl tracking-tight text-foreground">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-[0_12px_28px_hsl(var(--primary)/0.14)]">
              <FileText className="h-5 w-5" />
            </span>
            Auto-Generation Log
          </DialogTitle>
          <DialogDescription className="text-sm leading-5">
            History of automatically generated investment reports
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 overscroll-contain px-5 py-5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:px-6">
          {loading ? (
            <div className="rounded-3xl border border-border/60 bg-background/60 py-10 text-center text-muted-foreground shadow-sm" role="status" aria-live="polite">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-primary/25 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.10),transparent_38%),hsl(var(--card)/0.82)] px-4 py-14 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-border/70 bg-background/75 text-muted-foreground shadow-sm">
                <FileText className="h-9 w-9 text-muted-foreground/60" />
              </div>
              <p className="font-semibold text-foreground">No generation logs yet</p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Auto-generated reports will appear here
              </p>
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain rounded-3xl border border-border/60 bg-background/55 shadow-sm [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="min-w-[220px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</TableHead>
                    <TableHead className="hidden min-w-[160px] text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:table-cell">Switch</TableHead>
                    <TableHead className="min-w-[160px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</TableHead>
                    <TableHead className="min-w-[120px] text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} className="border-border/50 transition-colors hover:bg-primary/5">
                      <TableCell className="max-w-[260px] align-top">
                        <div className="break-words text-sm font-medium leading-5 text-foreground">{log.listing_address}</div>
                        <div className="mt-2 sm:hidden">
                          {log.switch_name ? (
                            <Badge variant="outline" className="max-w-full truncate border-border/70 bg-card/70 text-xs shadow-sm">{log.switch_name}</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[180px] align-top sm:table-cell">
                        {log.switch_name ? (
                          <Badge variant="outline" className="max-w-full truncate border-border/70 bg-card/70 shadow-sm">{log.switch_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="max-w-[260px] space-y-2">
                          {getStatusBadge(log.status)}
                          {log.error_message && (
                            <p className="break-words rounded-2xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                              {log.error_message}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground sm:text-sm">
                        {format(new Date(log.created_at), 'MMM d, HH:mm')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
