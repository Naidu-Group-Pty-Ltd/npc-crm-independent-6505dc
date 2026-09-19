import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlarmClock, Archive, MoreHorizontal, Send, X, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { SmartSnoozeDialog } from './SmartSnoozeDialog';
import { TemplatesPicker } from './TemplatesPicker';

interface Props {
  selected: Set<string>;
  onClear: () => void;
}

export function BulkActionsBar({ selected, onClear }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [msgBody, setMsgBody] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docDesc, setDocDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ids = Array.from(selected);
  const count = ids.length;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['finance-portal-purchase-files'] });
    onClear();
  };

  const doArchive = async () => {
    if (!confirm(`Archive ${count} purchase file(s)?`)) return;
    const { data, error } = await invokeFinanceFunction('finance-portal-bulk-actions', {
      operation: 'bulk_archive', file_ids: ids,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Archived ${data?.processed ?? 0} file(s)`);
    refresh();
  };

  const doSendMessage = async () => {
    if (!msgBody.trim()) { toast.error('Message body required'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-bulk-actions', {
        operation: 'bulk_send_message', file_ids: ids, body: msgBody,
      });
      if (error) throw new Error(error.message);
      toast.success(`Message sent to ${data?.processed ?? 0} client(s)`);
      setMsgOpen(false); setMsgBody('');
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSubmitting(false); }
  };

  const doRequestDoc = async () => {
    if (!docTitle.trim()) { toast.error('Document title required'); return; }
    setSubmitting(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-bulk-actions', {
        operation: 'bulk_request_doc', file_ids: ids, title: docTitle, description: docDesc,
      });
      if (error) throw new Error(error.message);
      toast.success(`Requested "${docTitle}" on ${data?.processed ?? 0} file(s)`);
      setDocOpen(false); setDocTitle(''); setDocDesc('');
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-30 print:hidden"
          >
            <div className="flex items-center gap-2 bg-card border border-border rounded-full shadow-xl px-3 py-1.5">
              <span className="text-sm font-medium px-2">
                {count} selected
              </span>
              <div className="h-5 w-px bg-border" />
              <Button size="sm" variant="ghost" className="gap-1.5 h-8" onClick={() => setSnoozeOpen(true)}>
                <AlarmClock className="h-3.5 w-3.5" /> Snooze
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 h-8" onClick={() => setMsgOpen(true)}>
                <Send className="h-3.5 w-3.5" /> Message
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 h-8" onClick={() => setDocOpen(true)}>
                <FileText className="h-3.5 w-3.5" /> Request doc
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={doArchive} className="text-destructive">
                    <Archive className="h-4 w-4 mr-2" /> Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onClear}>
                    <X className="h-4 w-4 mr-2" /> Clear selection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SmartSnoozeDialog
        open={snoozeOpen}
        onOpenChange={setSnoozeOpen}
        fileIds={ids}
        onDone={refresh}
      />

      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send same message to {count} client(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Message body</Label>
              <TemplatesPicker kind="message" onPick={({ body }) => setMsgBody(body)} />
            </div>
            <Textarea
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              rows={6}
              maxLength={5000}
              placeholder="Hi {{client_first_name}}, just checking in…"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMsgOpen(false)}>Cancel</Button>
            <Button onClick={doSendMessage} disabled={submitting}>
              {submitting ? 'Sending…' : `Send to ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={docOpen} onOpenChange={setDocOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request same document from {count} client(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Document title</Label>
                <TemplatesPicker kind="doc_request" onPick={({ body, title }) => { if (title) setDocTitle(title); setDocDesc(body); }} />
              </div>
              <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Payslips x2" />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Textarea value={docDesc} onChange={(e) => setDocDesc(e.target.value)} rows={3} maxLength={2000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocOpen(false)}>Cancel</Button>
            <Button onClick={doRequestDoc} disabled={submitting}>
              {submitting ? 'Requesting…' : `Request on ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
