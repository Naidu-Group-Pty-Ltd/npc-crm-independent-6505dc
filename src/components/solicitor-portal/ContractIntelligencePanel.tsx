import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, FileSearch, Loader2, Sparkles, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { LegalMatterDocument } from '@/lib/legalDocuments';
import {
  ANALYSIS_STATUS_LABELS,
  analyseContract,
  getAiPolicyStatus,
  deleteAnalysis,
  listContractAnalyses,
  riskFlagClasses,
  setAnalysisStatus,
  type ContractAnalysis,
} from '@/lib/solicitorIntelligence';

/**
 * Contract intelligence for a single matter (Phase 7).
 *
 * Runs the AI contract analyser over pasted text or an uploaded matter document
 * and renders the structured result. Every analysis lands as a DRAFT — a
 * practitioner must explicitly confirm it before it counts as reviewed, and the
 * panel never writes extracted values back onto the matter automatically.
 */
export function ContractIntelligencePanel({
  matterId,
  documents,
  canEdit,
  canDelete,
}: {
  matterId: string;
  documents: LegalMatterDocument[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [analyses, setAnalyses] = useState<ContractAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [documentId, setDocumentId] = useState<string>('');
  const [policy, setPolicy] = useState<{configured:boolean;enabled:boolean;available:boolean;consent_version?:string;provider?:string}|null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const analysableDocuments = useMemo(
    () => documents.filter((d) => d.current_version_id && d.malware_scan_status === 'clean' && ['reviewed','retained','legal_hold'].includes(d.lifecycle_status || '')),
    [documents],
  );

  const refresh = useCallback(async () => {
    const [{ data, error },policyResult] = await Promise.all([listContractAnalyses(matterId),getAiPolicyStatus()]);
    setLoading(false);
    if (error) return;
    setAnalyses((data?.records ?? []) as ContractAnalysis[]);
    setPolicy(policyResult.data?.policy||null);
  }, [matterId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async () => {
    if (!policy?.available) { toast.error('Your practice has not enabled external AI processing.'); return; }
    if (!documentId) { toast.error('Choose a clean, reviewed immutable contract version.'); return; }
    setRunning(true);
    const { error } = await analyseContract({
      matterId,
      documentId,
    });
    setRunning(false);
    if (error) { toast.error(error.message || 'The analyser could not process that contract'); return; }
    toast.success('Draft analysis ready for your review');
    setDialogOpen(false);
    setDocumentId('');
    await refresh();
  };

  const review = async (id: string, status: 'confirmed' | 'dismissed') => {
    setBusyId(id);
    const { error } = await setAnalysisStatus(id, status);
    setBusyId(null);
    if (error) { toast.error(error.message || 'Could not update that analysis'); return; }
    toast.success(status === 'confirmed' ? 'Analysis confirmed' : 'Analysis dismissed');
    await refresh();
  };

  const remove = async (id: string) => {
    setBusyId(id);
    const { error } = await deleteAnalysis(id);
    setBusyId(null);
    if (error) { toast.error(error.message || 'Could not delete that analysis'); return; }
    toast.success('Analysis deleted');
    await refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Contract intelligence
            </CardTitle>
            <CardDescription>
              A structured first-pass review of the contract of sale — summary, special conditions and
              risk flags. Always confirm against the executed document before you rely on it.
            </CardDescription>
          </div>
          {canEdit ? (
            <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!policy?.available}>
              <FileSearch className="mr-2 h-4 w-4" aria-hidden /> Analyse contract
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {policy && !policy.available ? <div role="status" className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"><p className="font-medium">External AI processing is disabled</p><p className="mt-1 text-muted-foreground">Your practice administrator must record firm consent and enable an approved provider before documents can be analysed.</p></div> : null}
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : analyses.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
              <p className="text-sm font-medium text-foreground">No contract review yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload and review an immutable contract version, explicitly permit external processing,
                then run an assistive analysis for practitioner review.
              </p>
              {canEdit ? (
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
                  Analyse a contract
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {analyses.map((a) => (
                <AnalysisCard
                  key={a.id}
                  analysis={a}
                  busy={busyId === a.id}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onReview={review}
                  onDelete={remove}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex h-[90vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Analyse contract</DialogTitle>
            <DialogDescription>
              Choose a clean, reviewed immutable document with explicit AI permission. The result is
              assistive, saved for review, and never applied to the matter automatically.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="-mx-6 flex-1 px-6">
            <div className="space-y-4 py-1">
              <div className="space-y-2">
                <Label htmlFor="analysis-document">Matter document</Label>
                <Select value={documentId} onValueChange={setDocumentId}>
                  <SelectTrigger id="analysis-document">
                    <SelectValue placeholder="Choose an approved document" />
                  </SelectTrigger>
                  <SelectContent>
                    {analysableDocuments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label || d.file_name || 'Untitled document'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only the selected immutable version and its SHA-256 provenance are sent. Raw content is never written to application logs.
                </p>
              </div>


            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={running}>Cancel</Button>
            <Button onClick={() => void run()} disabled={running || !documentId || !policy?.available}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}
              Run analysis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalysisCard({
  analysis, busy, canEdit, canDelete, onReview, onDelete,
}: {
  analysis: ContractAnalysis;
  busy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReview: (id: string, status: 'confirmed' | 'dismissed') => void;
  onDelete: (id: string) => void;
}) {
  const confidence = analysis.confidence !== null && analysis.confidence !== undefined
    ? `${Math.round(analysis.confidence * 100)}% confidence`
    : null;

  return (
    <div className={cn(
      'rounded-lg border p-4',
      analysis.status === 'confirmed' ? 'border-success/40 bg-success/5'
        : analysis.status === 'dismissed' ? 'border-border/60 bg-muted/30 opacity-80'
          : 'border-border',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {analysis.source_label || 'Contract analysis'}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(analysis.created_at).toLocaleString('en-AU')}
            {confidence ? ` · ${confidence}` : ''}
          </p>
          {analysis.governance ? <p className="mt-1 text-xs text-muted-foreground">Assistive AI · {analysis.governance.provider} · {analysis.governance.model} · prompt v{analysis.governance.ai_prompt_versions?.version || '—'} · source {analysis.governance.input_hash.slice(0,12)}…</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{ANALYSIS_STATUS_LABELS[analysis.status]}</Badge>
          {canEdit && analysis.status !== 'confirmed' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview(analysis.id, 'confirmed')}>
              <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Confirm
            </Button>
          ) : null}
          {canEdit && analysis.status === 'draft' ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview(analysis.id, 'dismissed')}>
              <X className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Dismiss
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label="Supersede analysis"
              onClick={() => onDelete(analysis.id)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      {analysis.status === 'draft' ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Assistive draft, not legal advice. Verify every clause reference and date against the immutable source before acting.
        </p>
      ) : null}

      {analysis.summary ? (
        <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{analysis.summary}</p>
      ) : null}

      {analysis.risk_flags?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Risk flags</p>
          <ul className="space-y-2">
            {analysis.risk_flags.map((r, i) => (
              <li key={i} className={cn('rounded-md border p-2.5', riskFlagClasses(r.severity))}>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="mt-0.5 text-xs opacity-90">{r.detail}</p>
                {r.recommended_action ? (
                  <p className="mt-1 text-xs font-medium opacity-90">Next: {r.recommended_action}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.special_conditions?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Special conditions ({analysis.special_conditions.length})
          </p>
          <ul className="space-y-2">
            {analysis.special_conditions.map((c, i) => (
              <li key={i} className="rounded-md border border-border/70 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {c.reference ? <Badge variant="outline" className="font-mono text-[11px]">{c.reference}</Badge> : null}
                  <p className="text-sm font-medium text-foreground">{c.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p>
                {(c.obligation_on || c.deadline) ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.obligation_on ? `Obligation: ${c.obligation_on}` : ''}
                    {c.obligation_on && c.deadline ? ' · ' : ''}
                    {c.deadline ? `Deadline: ${c.deadline}` : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.key_dates?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key dates</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {analysis.key_dates.map((d, i) => (
              <li key={i} className="rounded-md border border-border/70 px-2.5 py-2 text-xs">
                <span className="font-medium text-foreground">{d.label}</span>
                <span className="text-muted-foreground">{d.date ? ` — ${d.date}` : d.basis ? ` — ${d.basis}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.parties?.length ? (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parties named</p>
          <div className="flex flex-wrap gap-1.5">
            {analysis.parties.map((p, i) => (
              <Badge key={i} variant="outline" className="font-normal">
                {p.role ? `${p.role}: ` : ''}{p.name}
              </Badge>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
