import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Check, Loader2, Send, User, CheckCircle2, AlertCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SendToClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string;
  reportTitle: string;
  reportTier?: string;
  storagePath?: string | null;
  /**
   * Produces — or, when one already exists for this exact version, reuses —
   * the FINAL document, and answers the storage path the portal row points
   * at. Both callers (the Investment page, the Cash Flow analysis) answer
   * with the same document their own "Generate PDF" downloads; nothing is
   * drawn here, and nothing here can change what the document contains.
   *
   * This used to take the Cash Flow chart switches, which reached only the
   * in-browser jsPDF generator — so the send shipped a different document
   * from the one the adviser had generated (RS-5c.2). The switches went
   * with it: a control that changes nothing is worse than no control.
   */
  onGeneratePDF?: () => Promise<string | null>;
}

interface ClientOption {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  pipeline_status: string | null;
}

interface ClientNoteEntry {
  notes: string;
  noteVisibility: 'internal' | 'both';
}

const tierLabels: Record<string, string> = {
  compass: "Investor's Compass",
  briefing: 'Executive Briefing',
  snapshot: 'Snapshot',
  cashflow: 'Cash Flow Analysis',
};

export function SendToClientModal({
  isOpen,
  onClose,
  reportId,
  reportTitle,
  reportTier,
  storagePath,
  onGeneratePDF,
}: SendToClientModalProps) {
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [clientNotes, setClientNotes] = useState<Record<string, ClientNoteEntry>>({});
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [expandedNoteClient, setExpandedNoteClient] = useState<string | null>(null);

  const needsGeneration = !storagePath && !!onGeneratePDF;

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients-for-send'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction<{ success: boolean; clients: ClientOption[] }>('get-client-data', {
        listMode: true,
        listOptions: {
          select: 'id, primary_first_name, primary_surname, primary_email, pipeline_status',
          orderBy: 'primary_first_name',
          orderAsc: true,
        },
      });
      if (error) throw error;
      return data?.clients || [];
    },
    enabled: isOpen,
  });

  const filtered = clients.filter((c) => {
    const name = `${c.primary_first_name} ${c.primary_surname}`.toLowerCase();
    return name.includes(search.toLowerCase()) || (c.primary_email || '').toLowerCase().includes(search.toLowerCase());
  });

  const toggleClient = (clientId: string) => {
    setSelectedClientIds(prev => {
      if (prev.includes(clientId)) {
        // Remove client and their notes
        const newNotes = { ...clientNotes };
        delete newNotes[clientId];
        setClientNotes(newNotes);
        if (expandedNoteClient === clientId) setExpandedNoteClient(null);
        return prev.filter(id => id !== clientId);
      } else {
        // Add client with empty notes
        setClientNotes(prev => ({
          ...prev,
          [clientId]: { notes: '', noteVisibility: 'internal' },
        }));
        return [...prev, clientId];
      }
    });
  };

  const updateClientNote = (clientId: string, field: keyof ClientNoteEntry, value: string) => {
    setClientNotes(prev => ({
      ...prev,
      [clientId]: { ...prev[clientId], [field]: value },
    }));
  };

  const getClientName = (clientId: string) => {
    const c = clients.find(cl => cl.id === clientId);
    return c ? `${c.primary_first_name} ${c.primary_surname}` : 'Client';
  };

  const handleSend = async () => {
    if (selectedClientIds.length === 0) {
      toast.error('Please select at least one client');
      return;
    }

    setSending(true);
    try {
      // If no PDF exists yet, generate it first (once for all clients)
      let finalStoragePath = storagePath;
      if (!finalStoragePath && onGeneratePDF) {
        toast.info('Preparing the PDF before sending…');
        finalStoragePath = await onGeneratePDF();
        if (!finalStoragePath) {
          toast.error('PDF generation failed. Please try again.');
          setSending(false);
          return;
        }
      }

      if (!finalStoragePath) {
        toast.error('Unable to generate PDF. Please try downloading the PDF first.');
        setSending(false);
        return;
      }

      let successCount = 0;
      let errorCount = 0;

      for (const clientId of selectedClientIds) {
        const entry = clientNotes[clientId] || { notes: '', noteVisibility: 'internal' };
        try {
          const { error } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_portal_reports',
            clientId,
            data: {
              report_title: reportTitle,
              report_type: 'investment',
              report_tier: reportTier || null,
              storage_path: finalStoragePath,
              source_report_id: reportId,
              notes: entry.notes || null,
              client_visible_notes: entry.noteVisibility === 'both' && entry.notes ? entry.notes : null,
              published_at: new Date().toISOString(),
            },
          });
          if (error) throw error;
          successCount++;
        } catch {
          errorCount++;
        }
      }

      if (errorCount === 0) {
        setSent(true);
        toast.success(`Report sent to ${successCount} client${successCount > 1 ? 's' : ''}`);
      } else {
        toast.warning(`Sent to ${successCount}, failed for ${errorCount} client${errorCount > 1 ? 's' : ''}`);
      }

      setTimeout(() => {
        setSent(false);
        setSelectedClientIds([]);
        setClientNotes({});
        setSearch('');
        setExpandedNoteClient(null);
        onClose();
      }, 1500);
    } catch (err: any) {
      toast.error('Failed to send: ' + (err.message || 'Unknown error'));
    } finally {
      setSending(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedClientIds([]);
      setClientNotes({});
      setSearch('');
      setSent(false);
      setExpandedNoteClient(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send Report to Client{selectedClientIds.length > 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Publish this {tierLabels[reportTier || ''] || 'investment'} report to one or more client portals.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <p className="text-sm font-medium text-foreground">Report sent successfully!</p>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto flex-1 pr-1">
            {/* Report info */}
            <div className="rounded-md border bg-muted/50 p-3 space-y-1">
              <p className="text-sm font-medium text-foreground truncate">{reportTitle}</p>
              <div className="flex gap-2">
                <Badge variant="secondary" className="text-xs">Investment Report</Badge>
                {reportTier && (
                  <Badge variant="outline" className="text-xs">{tierLabels[reportTier] || reportTier}</Badge>
                )}
              </div>
            </div>

            {/* The document is produced — or reused — at send time */}
            {needsGeneration && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    The final PDF is produced when you send — the same document
                    “Generate PDF” downloads — or reused when it has already been
                    generated for this exact version.
                  </p>
                </div>
              </div>
            )}

            {/* Client search & selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Select Clients</Label>
                {selectedClientIds.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedClientIds.length} selected
                  </Badge>
                )}
              </div>
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search clients..."
                iconClassName="left-2.5"
              />

              <ScrollArea className="h-40 rounded-md border">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No clients found</p>
                ) : (
                  <div className="p-1 space-y-0.5">
                    {filtered.map((client) => {
                      const isSelected = selectedClientIds.includes(client.id);
                      return (
                        <button
                          key={client.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => toggleClient(client.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors',
                            isSelected
                              ? 'bg-primary/10 border border-primary/30'
                              : 'hover:bg-muted'
                          )}
                        >
                          {/* The row IS the control. A <Checkbox> here is a second
                              <button> inside this one — invalid nesting that React
                              reports on every open and that a browser may dispatch
                              to either element — so the tick is drawn, not mounted,
                              and the row's own aria-pressed carries the state. */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex h-5 w-5 sm:h-4 sm:w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                              isSelected && 'bg-primary text-primary-foreground',
                            )}
                          >
                            {isSelected && <Check className="h-4 w-4" />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {client.primary_first_name} {client.primary_surname}
                            </p>
                            {client.primary_email && (
                              <p className="text-xs text-muted-foreground truncate">{client.primary_email}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Per-client notes */}
            {selectedClientIds.length > 0 && (
              <div className="space-y-2">
                <Label>Notes per Client (optional)</Label>
                <div className="space-y-1.5">
                  {selectedClientIds.map((clientId) => {
                    const entry = clientNotes[clientId] || { notes: '', noteVisibility: 'internal' };
                    const isExpanded = expandedNoteClient === clientId;
                    const clientName = getClientName(clientId);
                    return (
                      <div key={clientId} className="rounded-md border bg-muted/30 overflow-hidden">
                        {/* Two controls side by side — expand, and remove — rather
                            than a remove button nested inside the expand button. */}
                        <div className="flex items-center gap-1 pr-2 hover:bg-muted/50 transition-colors">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedNoteClient(isExpanded ? null : clientId)}
                            className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-medium truncate">{clientName}</span>
                              {entry.notes && (
                                <Badge variant="outline" className="text-[10px] h-4 shrink-0">has note</Badge>
                              )}
                            </span>
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${clientName}`}
                            onClick={() => toggleClient(clientId)}
                            className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1 space-y-2 border-t">
                            <Textarea
                              placeholder={entry.noteVisibility === 'both' ? "This note will be visible to the client..." : "Add a note for internal tracking..."}
                              value={entry.notes}
                              onChange={(e) => updateClientNote(clientId, 'notes', e.target.value)}
                              rows={2}
                              className="text-sm"
                            />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant={entry.noteVisibility === 'internal' ? 'default' : 'outline'}
                                size="sm"
                                className="text-xs h-6"
                                onClick={() => updateClientNote(clientId, 'noteVisibility', 'internal')}
                              >
                                🔒 Internal
                              </Button>
                              <Button
                                type="button"
                                variant={entry.noteVisibility === 'both' ? 'default' : 'outline'}
                                size="sm"
                                className="text-xs h-6"
                                onClick={() => updateClientNote(clientId, 'noteVisibility', 'both')}
                              >
                                👁 Client Visible
                              </Button>
                            </div>
                            {entry.noteVisibility === 'both' && entry.notes && (
                              <p className="text-[10px] text-brand-600">This note will be displayed to {clientName} on their portal.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={handleSend} disabled={sending || selectedClientIds.length === 0}>
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {!storagePath ? 'Preparing & Sending…' : 'Sending…'}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-1" />
                    {!storagePath
                      ? `Prepare & Send${selectedClientIds.length > 1 ? ` to ${selectedClientIds.length}` : ''}`
                      : `Send to ${selectedClientIds.length} Client${selectedClientIds.length !== 1 ? 's' : ''}`
                    }
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
