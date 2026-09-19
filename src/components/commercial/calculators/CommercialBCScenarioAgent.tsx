import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, Sparkles, TrendingUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface CommercialScenarioProposal {
  name: string;
  reasoning: string;
  estimatedImpact: string;
  executionRisk?: 'low' | 'medium' | 'high';
  evidenceRequired?: string[];
  adjustments: Record<string, unknown>;
}

export interface CommercialBCSnapshot {
  assetCategory?: string;
  assetSubtype?: string;
  state?: string;
  purpose?: string;
  leaseStatus?: string;
  purchasePrice?: number;
  estimatedValue?: number;
  proposedLoan?: number;
  availableEquity?: number;
  sponsorLiquidity?: number;
  businessEbitda?: number;
  businessDebt?: number;
  marketRent?: number;
  vacancy?: number;
  rate?: number;
  buffer?: number;
  term?: number;
  maxLvr?: number;
  minDscr?: number;
  minIcr?: number;
  profile?: string;
  gstTreatment?: string;
  riskRating?: string;
  borrowingCapacity?: number;
  dscr?: number;
  icr?: number;
  noi?: number;
  client?: { id?: string; name?: string };
  missingPropertyWarning?: string;
  missingPropertyFields?: string[];
}

const stripBlankSnapshot = (snapshot: CommercialBCSnapshot) => Object.fromEntries(
  Object.entries(snapshot).filter(([, value]) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0))
) as CommercialBCSnapshot;

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

interface Props {
  snapshot: CommercialBCSnapshot;
  clientId?: string;
  onApply: (proposal: CommercialScenarioProposal) => void;
}

const fmt = (n?: number) =>
  typeof n === 'number' && Number.isFinite(n)
    ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n)
    : '—';

const riskColor: Record<string, 'default' | 'secondary' | 'destructive'> = {
  low: 'default',
  medium: 'secondary',
  high: 'destructive',
};

export function CommercialBCScenarioAgent({ snapshot, clientId, onApply }: Props) {
  const storageKey = `commercial-bc-scenario-chat:${clientId || 'anon'}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [proposals, setProposals] = useState<CommercialScenarioProposal[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // load history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.messages)) setMessages(parsed.messages);
        if (Array.isArray(parsed?.proposals)) setProposals(parsed.proposals);
      } else {
        setMessages([]);
        setProposals([]);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  // persist
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ messages, proposals })); } catch { /* ignore */ }
  }, [storageKey, messages, proposals]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, proposals, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextHistory: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);
    try {
      const { data, error } = await invokeSecureFunction('commercial-bc-scenario-agent', {
        prompt: text,
        history: messages,
        snapshot: stripBlankSnapshot(snapshot),
        clientId,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Agent error');
      const assistantText: string = data.assistantText || 'Drafted scenarios below.';
      const newProposals: CommercialScenarioProposal[] = Array.isArray(data.scenarios) ? data.scenarios : [];
      setMessages([...nextHistory, { role: 'assistant', content: assistantText }]);
      setProposals(newProposals);
    } catch (err: any) {
      const msg = err?.message || 'Scenario agent failed';
      setMessages([...nextHistory, { role: 'assistant', content: `⚠️ ${msg}` }]);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, snapshot, clientId]);

  const clearChat = () => { setMessages([]); setProposals([]); };

  const handleApply = (p: CommercialScenarioProposal) => {
    onApply(p);
    toast.success(`Applied scenario: ${p.name}`);
  };

  return (
    <Card className="border-primary/30 bg-primary/[0.04]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" /> AI Scenario Agent
            </CardTitle>
            <CardDescription>
              Describe (type or voice) what you want to explore. The agent proposes 2–3 scenarios using the current snapshot — apply one to cascade into the calculator.
            </CardDescription>
          </div>
          {messages.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearChat}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ScrollArea className="h-44 rounded-md border bg-background/40 p-3">
          <div ref={scrollRef} className="space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="text-muted-foreground italic">
                Try: "Lift borrowing capacity if we drop purchase price to $3M and consolidate the $1.2M business loan", or
                "Stress-test rates +1.5% and see the safest lender profile".
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}>
                <span className="font-medium mr-1">{m.role === 'user' ? 'You:' : 'Agent:'}</span>{m.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Drafting scenarios…
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="What scenario do you want to model?"
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            className="min-h-[44px]"
          />
          <div className="flex flex-col gap-2">
            <VoiceToTextButton size="sm" onTranscript={(t) => setInput(prev => (prev ? `${prev} ${t}` : t))} disabled={loading} />
            <Button size="sm" onClick={send} disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {proposals.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Proposed scenarios
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
              {proposals.map((p, i) => (
                <Card key={i} className="border-border/60 bg-background/60">
                  <CardContent className="pt-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm leading-tight">{p.name}</div>
                      {p.executionRisk && (
                        <Badge variant={riskColor[p.executionRisk] || 'secondary'} className="text-[10px]">
                          {p.executionRisk} risk
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.reasoning}</div>
                    <div className="flex items-center gap-1 text-xs">
                      <TrendingUp className="h-3 w-3 text-primary" />
                      <span className="font-medium">{p.estimatedImpact}</span>
                    </div>
                    {p.evidenceRequired && p.evidenceRequired.length > 0 && (
                      <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                        {p.evidenceRequired.slice(0, 4).map((e, j) => <li key={j}>{e}</li>)}
                      </ul>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      Adjusts: {Object.keys(p.adjustments || {}).slice(0, 6).join(', ') || '—'}
                    </div>
                    <Button size="sm" className="w-full" onClick={() => handleApply(p)}>
                      Apply scenario
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Snapshot: {fmt(snapshot.borrowingCapacity)} capacity · DSCR {snapshot.dscr?.toFixed(2) ?? '—'} · ICR {snapshot.icr?.toFixed(2) ?? '—'} · LVR profile {snapshot.profile ?? '—'}.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
