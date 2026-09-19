import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { ArrowRight, ExternalLink, Layers, RefreshCw, MoreVertical, MapPin } from 'lucide-react';

const fmtMoney = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(0)}k`
      : `$${Math.round(n).toLocaleString('en-AU')}`;

interface PfCard {
  id: string;
  client_id: string;
  title: string;
  client_name: string | null;
  lender: string | null;
  loan_amount: number;
  finance_status: string;
  risk_level: string | null;
  settlement_date: string | null;
  property_address: string | null;
  property_suburb: string | null;
  property_state?: string | null;
  property_postcode?: string | null;
  kanban_position: number | null;
  last_partner_action_at: string | null;
}
interface Lane { status: string; label: string; cards: PfCard[]; total_loan: number; }

export default function FinancePortalPipeline() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    // After the first successful load, do not blank the board out with skeletons
    // on refresh — show a subtle "refreshing" indicator instead so the user
    // never sees the lanes disappear behind blank boxes.
    if (hasLoadedOnce) setRefreshing(true);
    else setLoading(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-pipeline', { operation: 'kanban_board' });
      if (error) {
        const msg = error.message || 'Failed to load pipeline board';
        setLoadError(msg);
        toast.error(msg);
        if (!hasLoadedOnce) setLanes([]);
      } else {
        setLoadError(null);
        setLanes(Array.isArray(data?.lanes) ? data.lanes : []);
        setHasLoadedOnce(true);
      }
    } catch (e: any) {
      console.error('[Pipeline] load failed', e);
      const msg = e?.message || 'Failed to load pipeline board';
      setLoadError(msg);
      toast.error(msg);
      if (!hasLoadedOnce) setLanes([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [invokeFinanceFunction, hasLoadedOnce]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // Move a card via either DnD (desktop) or the "Move to…" menu (mobile/touch).
  // Phase 2 #11 — native HTML5 drag-drop does not fire on touch devices, so we expose
  // an explicit menu fallback on every card.
  const moveCard = useCallback(async (cardId: string, targetStatus: string, targetIndex?: number) => {
    const sourceLane = lanes.find(l => l.cards.some(c => c.id === cardId));
    if (!sourceLane) return;
    const card = sourceLane.cards.find(c => c.id === cardId)!;
    const targetLane = lanes.find(l => l.status === targetStatus);
    if (!targetLane) return;

    const idx = targetIndex == null ? targetLane.cards.length : targetIndex;
    const filtered = targetLane.cards.filter(c => c.id !== cardId);
    const before = filtered[idx - 1]?.kanban_position;
    const after = filtered[idx]?.kanban_position;
    let pos: number;
    if (before != null && after != null) pos = (Number(before) + Number(after)) / 2;
    else if (before != null) pos = Number(before) + 1000;
    else if (after != null) pos = Number(after) - 1000;
    else pos = Date.now();

    setLanes(prev => {
      const next = prev.map(l => ({ ...l, cards: l.cards.filter(c => c.id !== cardId) }));
      const moved = { ...card, finance_status: targetStatus, kanban_position: pos };
      const lane = next.find(l => l.status === targetStatus)!;
      lane.cards.splice(Math.min(idx, lane.cards.length), 0, moved);
      return next;
    });

    const { error } = await invokeFinanceFunction('finance-portal-pipeline', {
      operation: 'kanban_move',
      purchase_file_id: cardId,
      target_status: targetStatus,
      target_position: pos,
    });
    if (error) {
      toast.error('Move failed — refreshing board');
      void load();
    } else {
      toast.success(`Moved to ${targetStatus.replace(/_/g, ' ')}`);
    }
  }, [lanes, invokeFinanceFunction, load]);

  const handleDrop = (targetStatus: string, targetIndex: number) => {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    void moveCard(id, targetStatus, targetIndex);
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="h-6 w-6 text-primary" /> Pipeline Kanban</h1>
          <p className="text-sm text-muted-foreground">Drag &amp; drop on desktop, or tap the <span className="inline-flex items-center px-1 py-px rounded border border-border align-middle"><MoreVertical className="h-3 w-3" /></span> menu on a card to move it.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading || refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading || refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-96 w-72 shrink-0" />)}
        </div>
      ) : loadError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-16 text-center">
            <Layers className="h-10 w-10 mx-auto text-destructive opacity-60 mb-3" />
            <p className="text-sm font-medium text-destructive">Pipeline board could not load</p>
            <p className="text-xs text-muted-foreground mt-1 break-words">{loadError}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={load}>
              <RefreshCw className="h-4 w-4 mr-2" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : lanes.every(l => l.cards.length === 0) ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Layers className="h-10 w-10 mx-auto text-muted-foreground opacity-50 mb-3" />
            <p className="text-sm font-medium">No purchase files in your pipeline yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              The Kanban shows purchase files for clients assigned to you. Open a client from
              <span className="font-medium"> My Clients</span> to create a purchase file — it will appear
              here and stay in sync with the Command Centre Deal Pipeline.
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button asChild variant="default" size="sm">
                <Link to="/finance/clients">Go to My Clients</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea horizontal className="w-full">
          <div className={`flex gap-4 pb-6 transition-opacity ${refreshing ? 'opacity-70' : ''}`}>

            {lanes.map((lane) => (
              <div
                key={lane.status}
                className="w-72 shrink-0 rounded-xl border border-border bg-card/40 flex flex-col"
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(lane.status, lane.cards.length); }}
              >
                <div className="p-3 border-b border-border flex items-center justify-between sticky top-0 bg-card/80 backdrop-blur z-10 rounded-t-xl">
                  <div>
                    <p className="text-xs uppercase tracking-wide font-semibold text-foreground">{lane.label}</p>
                    <p className="text-[10px] text-muted-foreground">{lane.cards.length} files · {fmtMoney(lane.total_loan)}</p>
                  </div>
                </div>
                <div className="p-2 flex-1 space-y-2 min-h-[200px]">
                  {lane.cards.map((card, idx) => (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(lane.status, idx); }}
                      className={`rounded-lg border border-border bg-background p-3 hover:border-primary/60 cursor-grab active:cursor-grabbing transition-all ${dragId === card.id ? 'opacity-40' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-sm font-medium leading-tight line-clamp-2 flex-1">{card.title}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <Link to={`/finance/purchase-files/${card.id}`} className="text-muted-foreground hover:text-primary p-1 -m-1" aria-label="Open file">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-primary p-1 -m-1 touch-manipulation"
                                aria-label="Move file"
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 max-h-[60vh] overflow-y-auto">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Move to…</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {lanes.filter(l => l.status !== card.finance_status).map(l => (
                                <DropdownMenuItem key={l.status} onClick={() => moveCard(card.id, l.status)}>
                                  <ArrowRight className="h-3 w-3 mr-2 text-muted-foreground" /> {l.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      {card.client_name && <p className="text-xs text-muted-foreground line-clamp-1">{card.client_name}</p>}
                      {(card.property_address || card.property_suburb) && (
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{[card.property_address || card.property_suburb, card.property_state, card.property_postcode].filter(Boolean).join(', ')}</span>
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        {card.lender && <Badge variant="outline" className="text-[10px]">{card.lender}</Badge>}
                        {card.loan_amount > 0 && <span className="text-xs font-medium text-success">{fmtMoney(card.loan_amount)}</span>}
                      </div>
                      {card.settlement_date && (
                        <p className="text-[10px] text-muted-foreground mt-1">Settle {new Date(card.settlement_date).toLocaleDateString('en-AU')}</p>
                      )}
                      {card.risk_level === 'high' && (
                        <Badge variant="destructive" className="text-[10px] mt-2">High risk</Badge>
                      )}
                    </div>
                  ))}
                  {lane.cards.length === 0 && (
                    <p className="text-xs text-muted-foreground italic text-center py-6">Drop here</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  );
}
