import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Sparkles, 
  Loader2, 
  TrendingUp, 
  AlertTriangle, 
  Lightbulb,
  Target,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface ClientAIInsightsProps {
  clientId: string;
}

interface AIInsight {
  summary: string;
  strengths: string[];
  opportunities: string[];
  risks: string[];
  recommendations: string[];
}

export function ClientAIInsights({ clientId }: ClientAIInsightsProps) {
  const [insights, setInsights] = useState<AIInsight | null>(null);

  // No client data is loaded here any more. It was fetched to build the
  // prompt, the prompt is now built on the server from the database, and
  // nothing this component renders ever read it — so the `get-client-data`
  // call it made on every mount of the AI tab bought nothing.

  const generateInsightsMutation = useMutation({
    /**
     * Audit item 10 — "Generate AI Insights" answered
     * `Failed to generate insights: Not found` for everyone, every time.
     *
     * The 404 came from `report-qa`, and it was correct. That function's
     * `chat` action carries `access: 'write'`, meaning it authorises against
     * a Report Q&A CONVERSATION; this card has none, so the pre-dispatch gate
     * refused with a deliberate 404 — a caller must not be able to tell a
     * conversation it cannot reach from one that does not exist. The card had
     * been asking the wrong endpoint a question it could never answer.
     *
     * Two more things were wrong even had it worked. A card on the Clients
     * page required the unrelated `report_qa` module permission, and it spent
     * Report Q&A's shared paid quota. And the entire prompt was composed
     * here, in the browser, which made that endpoint a free-text model proxy.
     *
     * `generate-portfolio-analysis` is the endpoint that already answers this
     * question: it authorises the CLIENT, reads the portfolio server-side and
     * meters the call. So the request is now a client id and a mode, and the
     * numbers the model sees come from the database rather than from whatever
     * this component happened to have loaded.
     */
    mutationFn: async () => {
      // 120s, not the 60s default. The assignment behind this is a REASONING
      // model whose thinking is billed as completion tokens: the ledger shows
      // its 8,000-token full answers at 72-78s and a 5,072-token comparison at
      // 48s, so a 4,000-token insights answer can plausibly cross 60s — and an
      // answer the browser stopped waiting for is an answer nobody receives,
      // billed anyway.
      const { data, error } = await invokeSecureFunction('generate-portfolio-analysis', {
        clientId,
        mode: 'insights',
      }, { timeoutMs: 120000 });

      if (error) throw new Error(error.message);
      if (!data?.success || !data.insights) {
        throw new Error(data?.error || 'Could not generate insights');
      }

      return data.insights as AIInsight;
    },
    onSuccess: (data) => {
      setInsights(data);
      toast.success('AI analysis complete');
    },
    onError: (error) => {
      toast.error('Failed to generate insights: ' + error.message);
    }
  });

  if (!insights) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Portfolio Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Get AI-powered analysis of this client's investment portfolio including strengths, 
            opportunities, risks, and recommendations.
          </p>
          <Button 
            onClick={() => generateInsightsMutation.mutate()}
            disabled={generateInsightsMutation.isPending}
            className="w-full gap-2"
          >
            {generateInsightsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing Portfolio...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate AI Insights
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Portfolio Insights
          </CardTitle>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => generateInsightsMutation.mutate()}
            disabled={generateInsightsMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 ${generateInsightsMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-3 bg-secondary rounded-lg">
              <p className="text-sm">{insights.summary}</p>
            </div>

            {/* Strengths */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-success">
                <TrendingUp className="h-4 w-4" />
                Strengths
              </div>
              <ul className="space-y-1">
                {insights.strengths.map((strength, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-success mt-1">•</span>
                    {strength}
                  </li>
                ))}
              </ul>
            </div>

            {/* Opportunities */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-info">
                <Lightbulb className="h-4 w-4" />
                Opportunities
              </div>
              <ul className="space-y-1">
                {insights.opportunities.map((opp, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-info mt-1">•</span>
                    {opp}
                  </li>
                ))}
              </ul>
            </div>

            {/* Risks */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" />
                Risks
              </div>
              <ul className="space-y-1">
                {insights.risks.map((risk, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-warning mt-1">•</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-accent">
                <Target className="h-4 w-4" />
                Recommendations
              </div>
              <ul className="space-y-2">
                {insights.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm p-2 bg-accent/5 rounded-lg border border-accent/20">
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
