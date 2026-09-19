import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Send, Loader2, CheckCircle, Calendar, BarChart3, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { cn } from '@/lib/utils';

const reportDialogShell = "max-h-[90vh] overflow-hidden rounded-3xl border-border dark:border-white/10 bg-background dark:bg-background/95 p-0 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/50 backdrop-blur-xl sm:max-w-2xl";
const reportSectionCard = "overflow-hidden rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/35 shadow-inner shadow-sm dark:shadow-black/20";
const reportControl = "h-11 rounded-2xl border-border dark:border-white/10 bg-background dark:bg-black/45 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/25 transition-colors hover:border-brand-300/35 focus-visible:ring-2 focus-visible:ring-brand-300/70";

export const WeeklyReportConfig: React.FC<{ triggerClassName?: string }> = ({ triggerClassName }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [reportPeriod, setReportPeriod] = useState('7');
  const [isSending, setIsSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  useEffect(() => {
    const savedEmail = localStorage.getItem('weeklyReportEmail');
    const savedLastSent = localStorage.getItem('weeklyReportLastSent');
    if (savedEmail) setRecipientEmail(savedEmail);
    if (savedLastSent) setLastSent(savedLastSent);
  }, []);

  const handleSendReport = async () => {
    if (!recipientEmail) {
      toast.error('Please enter a recipient email');
      return;
    }

    setIsSending(true);
    try {
      const { data, error } = await invokeSecureFunction('send-weekly-call-report', {
        recipientEmail,
        daysBack: parseInt(reportPeriod),
      });

      if (error) throw error;

      localStorage.setItem('weeklyReportEmail', recipientEmail);
      const now = new Date().toISOString();
      localStorage.setItem('weeklyReportLastSent', now);
      setLastSent(now);

      toast.success(`Report sent to ${recipientEmail}`);
      logActivityDirect({
        actionType: 'weekly_report_config_changed',
        entityType: 'call_log',
        entityName: 'Weekly Report',
        metadata: { recipient: recipientEmail, daysBack: parseInt(reportPeriod) }
      });
      setIsOpen(false);
    } catch (error: any) {
      console.error('Error sending report:', error);
      toast.error(error.message || 'Failed to send report');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName || ''}`}>
          <FileText className="h-4 w-4 shrink-0" />
          Weekly Report
        </Button>
      </DialogTrigger>
      <DialogContent className={reportDialogShell}>
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl" />
        <DialogHeader className="relative border-b border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_34%),linear-gradient(90deg,rgba(24,24,27,0.94),rgba(0,0,0,0.78),rgba(120,53,15,0.16))] px-6 py-5">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-100">
            <ShieldCheck className="h-3 w-3" />
            Reporting Workflow
          </div>
          <DialogTitle className="flex items-center gap-3 text-2xl text-foreground dark:text-foreground">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-500/10 text-brand-200 shadow-inner shadow-brand-950/40">
              <FileText className="h-5 w-5" />
            </span>
            Weekly Performance Report
          </DialogTitle>
        </DialogHeader>

        <div className="relative space-y-5 px-6 py-5">
          <Card className={reportSectionCard}>
            <CardHeader className="border-b border-border dark:border-white/10 bg-gradient-to-r from-brand-500/10 via-transparent to-info/10 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-foreground dark:text-foreground">
                <BarChart3 className="h-4 w-4 text-brand-300" />
                Report Contents
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground dark:text-muted-foreground">
                Summary of call performance metrics
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 text-sm text-muted-foreground dark:text-muted-foreground">
              <ul className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Total call volume & average duration</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Quality scores & grades</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Sentiment analysis breakdown</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Call outcomes summary</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Top call intents</li>
                <li className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-3 py-2">Alerts triggered count</li>
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipientEmail" className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Recipient Email</Label>
              <Input
                id="recipientEmail"
                type="email"
                placeholder="admin@example.com"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className={reportControl}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reportPeriod" className="text-xs uppercase tracking-[0.16em] text-muted-foreground dark:text-muted-foreground">Report Period</Label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger className={reportControl}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {lastSent && (
            <div className="flex items-center gap-2 rounded-2xl border border-success/20 bg-success/10 p-3 text-xs text-success shadow-inner shadow-success/30">
              <CheckCircle className="h-3.5 w-3.5 text-success" />
              Last sent: {new Date(lastSent).toLocaleString('en-AU')}
            </div>
          )}

          <Button
            onClick={handleSendReport}
            disabled={isSending || !recipientEmail}
            className="w-full gap-2 rounded-2xl bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 font-semibold text-black shadow-lg shadow-brand-500/20 transition-all hover:-translate-y-0.5 hover:from-brand-200 hover:via-brand-300 hover:to-brand-400 hover:shadow-brand-500/30 disabled:translate-y-0 disabled:opacity-50"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating & Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Send Report Now
              </>
            )}
          </Button>

          <p className="rounded-2xl border border-border dark:border-white/10 bg-white/[0.03] px-4 py-3 text-center text-xs text-muted-foreground dark:text-muted-foreground">
            <Calendar className="mr-1 inline h-3 w-3 text-brand-300" />
            For automated weekly reports, contact your administrator
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
