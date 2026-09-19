import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, KanbanSquare, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { SolicitorEmptyState } from '@/components/solicitor-portal/SolicitorEmptyState';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import {
  MATTER_STATUS_CLASSES, MATTER_STATUS_LABELS, countdownLabel, formatMatterDate,
  formatPropertyAddress, type LegalMatter, type LegalMatterStatus,
} from '@/lib/legalMatters';
import {
  PIPELINE_STAGES, RISK_LEVEL_CLASSES, RISK_LEVEL_LABELS, fetchPipelineBoard,
  formatCompactCurrency, moveMatter, type MatterRiskAssessment,
} from '@/lib/solicitorIntelligence';

const TERMINAL_STATUSES = new Set<LegalMatterStatus>(['settled', 'post_settlement', 'terminated']);

/**
 * Matter pipeline board (Phase 7).
 *
 * One lane per matter status with drag-and-drop stage transitions. Every move
 * is written through the intelligence edge function, which re-checks the
 * caller's permissions and records a status-history entry — the board is a view
 * over the same audited state machine, not a shortcut around it.
 */
export default function SolicitorPipeline() {
  const [matters, setMatters] = useState<LegalMatter[]>([]);
  const [risk, setRisk] = useState<MatterRiskAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LegalMatterStatus | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await fetchPipelineBoard(mineOnly);
    setLoading(false);
    if (error) { toast.error(error.message || 'Could not load the pipeline'); return; }
    setMatters((data?.matters ?? []) as LegalMatter[]);
    setRisk((data?.risk ?? []) as MatterRiskAssessment[]);
  }, [mineOnly]);

  useEffect(() => { void load(); }, [load]);

  const riskById = useMemo(
    () => new Map(risk.map((r) => [r.matter_id, r])),
    [risk],
  );

  const lanes = useMemo(() => PIPELINE_STAGES.map((stage) => {
    const inStage = matters
      .filter((m) => m.status === stage)
      .sort((a, b) => ((a as any).kanban_position ?? 0) - ((b as any).kanban_position ?? 0)
        || String(a.settlement_date || '9999').localeCompare(String(b.settlement_date || '9999')));
    return {
      stage,
      matters: inStage,
      value: inStage.reduce((sum, m) => sum + (Number(m.purchase_price) || 0), 0),
    };
  }), [matters]);

  const handleDrop = async (stage: LegalMatterStatus) => {
    const matterId = dragging;
    setDragging(null);
    setDropTarget(null);
    if (!matterId) return;
    const matter = matters.find((m) => m.id === matterId);
    if (!matter || matter.status === stage || TERMINAL_STATUSES.has(matter.status)) return;

    const previous = matters;
    setMatters((rows) => rows.map((m) => (m.id === matterId ? { ...m, status: stage } : m)));

    const position = lanes.find((l) => l.stage === stage)?.matters.length ?? 0;
    const { error } = await moveMatter(matterId, stage, position);
    if (error) {
      setMatters(previous);
      toast.error(error.message || 'Could not move that matter');
      return;
    }
    toast.success(`Moved to ${MATTER_STATUS_LABELS[stage]}`);
    await load();
  };

  return (
    <SolicitorPortalShell
      title="Matter pipeline"
      description="Every matter your practice is running, laid out by stage. Drag a card to progress it."
      actions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="pipeline-mine" checked={mineOnly} onCheckedChange={setMineOnly} />
            <Label htmlFor="pipeline-mine" className="text-sm text-muted-foreground">My matters only</Label>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} aria-hidden /> Refresh
          </Button>
        </div>
      }
    >
      {loading && matters.length === 0 ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : matters.length === 0 ? (
        <SolicitorEmptyState
          icon={<KanbanSquare className="h-6 w-6" aria-hidden />}
          title="No matters on the board"
          description="Matters appear here as soon as NPC shares a client file with your practice."
          actionLabel="Refresh board"
          onAction={() => void load()}
          secondaryLabel="Back to dashboard"
          onSecondaryAction={() => navigate('/solicitor')}
          hint="Drag cards between stages to progress a matter"
        />
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
          <div className="flex min-w-max gap-3">
            {lanes.map(({ stage, matters: laneMatters, value }) => (
              <section
                key={stage}
                aria-label={MATTER_STATUS_LABELS[stage]}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(stage); }}
                onDragLeave={() => setDropTarget((s) => (s === stage ? null : s))}
                onDrop={(e) => { e.preventDefault(); void handleDrop(stage); }}
                className={cn(
                  'w-72 shrink-0 rounded-xl border bg-card/60 p-3 transition-colors',
                  dropTarget === stage ? 'border-primary bg-primary/5' : 'border-border/70',
                )}
              >
                <header className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {MATTER_STATUS_LABELS[stage]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {laneMatters.length} matter{laneMatters.length === 1 ? '' : 's'}
                      {value > 0 ? ` · ${formatCompactCurrency(value)}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0', MATTER_STATUS_CLASSES[stage])}>
                    {laneMatters.length}
                  </Badge>
                </header>

                <div className="space-y-2">
                  {laneMatters.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                      Drop a matter here
                    </p>
                  ) : laneMatters.map((m) => {
                    const assessment = riskById.get(m.id);
                    const isTerminal = TERMINAL_STATUSES.has(m.status);
                    return (
                      <article
                        key={m.id}
                        draggable={!isTerminal}
                        onDragStart={() => setDragging(m.id)}
                        onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                        className={cn(
                          'rounded-lg border border-border/70 bg-card p-3 shadow-sm transition-opacity',
                          !isTerminal && 'cursor-grab active:cursor-grabbing',
                          dragging === m.id && 'opacity-50',
                        )}
                      >
                        <Link
                          to={`/solicitor/matters/${m.id}`}
                          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{formatPropertyAddress(m)}</p>
                        </Link>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {m.settlement_date ? (
                            <Badge variant="outline" className="font-normal">
                              {formatMatterDate(m.settlement_date)}
                              {countdownLabel(m.settlement_date) ? ` · ${countdownLabel(m.settlement_date)}` : ''}
                            </Badge>
                          ) : null}
                          {assessment && assessment.level !== 'ok' ? (
                            <Badge variant="outline" className={cn('gap-1', RISK_LEVEL_CLASSES[assessment.level])}>
                              <AlertTriangle className="h-3 w-3" aria-hidden />
                              {RISK_LEVEL_LABELS[assessment.level]}
                            </Badge>
                          ) : null}
                        </div>

                        {assessment?.signals?.length ? (
                          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                            {assessment.signals[0].detail}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </SolicitorPortalShell>
  );
}
