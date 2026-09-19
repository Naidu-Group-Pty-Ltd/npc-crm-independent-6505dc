import { useEffect, useMemo, useState } from 'react';
import { Brain, Languages, Sparkles, AlertTriangle, Smile, Meh, Frown, Flame, FileText, MessageSquare, CheckSquare, HelpCircle, Loader2, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'angry';
export type EmailCategory = 'inquiry' | 'complaint' | 'opportunity' | 'admin' | 'fyi' | 'scheduling' | 'document_request' | 'other';

export interface EmailIntelligence {
  sentiment?: Sentiment;
  category?: EmailCategory;
  language?: string; // ISO code or display name
  urgencyLevel?: 'low' | 'medium' | 'high';
}

interface ThreadSummaryData {
  tldr: string;
  decisions: string[];
  openQuestions: string[];
  actionItems: { owner: string; task: string }[];
  nextStep: string;
}

interface Props {
  email: {
    id: string;
    sender: string;
    subject: string;
    body: string;
    received_at: string;
  };
  threadEmails: Array<{ sender: string; subject: string; body: string; received_at: string }>;
  intelligence: EmailIntelligence | null;
  onIntelligenceUpdate?: (next: EmailIntelligence) => void;
}

const toSafeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map(item => toSafeString(item).trim()).filter(Boolean);
};

const toActionItems = (value: unknown): { owner: string; task: string }[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      owner: toSafeString(item?.owner, 'Owner'),
      task: toSafeString(item?.task ?? item?.description ?? item),
    }))
    .filter(item => item.task);
};

const normalizeThreadSummary = (summary: unknown): ThreadSummaryData | null => {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const source = summary as Record<string, unknown>;
  return {
    tldr: toSafeString(source.tldr ?? source.summary),
    decisions: toStringArray(source.decisions),
    openQuestions: toStringArray(source.openQuestions ?? source.open_questions),
    actionItems: toActionItems(source.actionItems ?? source.action_items),
    nextStep: toSafeString(source.nextStep ?? source.next_step),
  };
};

const SENTIMENT_CONFIG: Record<Sentiment, { label: string; icon: typeof Smile; cls: string }> = {
  positive: { label: 'Positive', icon: Smile, cls: 'text-success border-success/30 bg-success/10' },
  neutral: { label: 'Neutral', icon: Meh, cls: 'text-muted-foreground border-border bg-muted/40' },
  negative: { label: 'Negative', icon: Frown, cls: 'text-warning border-warning/30 bg-warning/10' },
  angry: { label: 'Angry', icon: Flame, cls: 'text-destructive border-destructive/30 bg-destructive/10' },
};

const CATEGORY_LABEL: Record<EmailCategory, string> = {
  inquiry: 'Inquiry',
  complaint: 'Complaint',
  opportunity: 'Opportunity',
  admin: 'Admin',
  fyi: 'FYI',
  scheduling: 'Scheduling',
  document_request: 'Doc request',
  other: 'Other',
};

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
];

export function EmailIntelligencePanel({ email, threadEmails, intelligence, onIntelligenceUpdate }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translateLang, setTranslateLang] = useState('en');
  const [showTranslation, setShowTranslation] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [threadSummary, setThreadSummary] = useState<ThreadSummaryData | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Reset on email change
  useEffect(() => {
    setTranslation(null);
    setShowTranslation(false);
    setThreadSummary(null);
    setSummaryOpen(false);
  }, [email.id]);

  const sentimentInfo = intelligence?.sentiment ? SENTIMENT_CONFIG[intelligence.sentiment] : null;
  const categoryLabel = intelligence?.category ? CATEGORY_LABEL[intelligence.category] : null;
  const detectedLang = intelligence?.language;
  const isForeign = detectedLang && detectedLang.toLowerCase().slice(0, 2) !== 'en';

  const safeThreadEmails = Array.isArray(threadEmails) ? threadEmails : [];
  const actionItems = toActionItems(threadSummary?.actionItems);
  const openQuestions = toStringArray(threadSummary?.openQuestions);
  const decisions = toStringArray(threadSummary?.decisions);
  const threadSize = useMemo(() => safeThreadEmails.length + 1, [safeThreadEmails.length]);

  const runAnalyze = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'analyze',
        email: { sender: email.sender, subject: email.subject, body: email.body, received_at: email.received_at },
        emailId: email.id,
      });
      if (error) throw error;
      if (data?.intelligence) {
        onIntelligenceUpdate?.(data.intelligence);
        toast.success('Email analyzed');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to analyze');
    } finally {
      setAnalyzing(false);
    }
  };

  const runTranslate = async () => {
    if (translation && showTranslation) {
      setShowTranslation(false);
      return;
    }
    if (translation && !showTranslation) {
      setShowTranslation(true);
      return;
    }
    setTranslating(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'translate',
        text: email.body,
        language: translateLang,
      });
      if (error) throw error;
      if (data?.translated) {
        setTranslation(data.translated);
        setShowTranslation(true);
      } else {
        throw new Error('No translation returned');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to translate');
    } finally {
      setTranslating(false);
    }
  };

  const runThreadSummary = async () => {
    setSummarizing(true);
    setSummaryOpen(true);
    try {
      const { data, error } = await invokeSecureFunction('email-copilot', {
        action: 'thread_summary',
        email: { sender: email.sender, subject: email.subject, body: email.body, received_at: email.received_at },
          threadEmails: safeThreadEmails,
      });
      if (error) throw error;
      const nextSummary = normalizeThreadSummary(data?.summary);
      if (nextSummary) {
        setThreadSummary(nextSummary);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to summarize thread');
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-gradient-to-br from-muted/40 to-background overflow-hidden">
      {/* Top row: badges + actions */}
      {/* `flex-wrap` alone does not save this row. A flex item's default
          `min-width: auto` refuses to shrink below its content, so the two
          groups keep their max-content widths, the line cannot break inside
          them, and the cluster runs off the pane's right edge — which is how
          it was reported: "Translate/Thread is cut off, and the cutoff
          disappears when the side panel is collapsed". Both groups declare
          `min-w-0` so the row can actually wrap, and the whole strip is
          allowed to shrink with the pane. */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 border-b border-border/60">
        <div className="flex min-w-0 items-center gap-2 flex-wrap">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">Intelligence</span>

          {sentimentInfo && (
            <Badge variant="outline" className={`gap-1 ${sentimentInfo.cls}`}>
              <sentimentInfo.icon className="h-3 w-3" />
              {sentimentInfo.label}
            </Badge>
          )}
          {categoryLabel && (
            <Badge variant="outline" className="gap-1">
              <FileText className="h-3 w-3" />
              {categoryLabel}
            </Badge>
          )}
          {detectedLang && (
            <Badge variant="outline" className="gap-1">
              <Languages className="h-3 w-3" />
              {detectedLang}
            </Badge>
          )}
          {!intelligence && (
            <span className="text-xs text-muted-foreground">Not analyzed yet</span>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 text-xs gap-1"
            onClick={runAnalyze}
            disabled={analyzing}
          >
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {intelligence ? 'Re-analyze' : 'Analyze'}
          </Button>

          <div className="flex items-center gap-1">
            <Select value={translateLang} onValueChange={setTranslateLang}>
              <SelectTrigger className="h-7 w-[110px] max-w-full shrink text-xs px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code} className="text-xs">{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={showTranslation ? 'secondary' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={runTranslate}
              disabled={translating}
              title={isForeign ? 'Foreign language detected — translate it' : 'Translate this email'}
            >
              {translating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
              {showTranslation ? 'Hide translation' : translation ? 'Show translation' : 'Translate'}
            </Button>
          </div>

          {threadSize > 1 && (
            <Button
              size="sm"
              variant={summaryOpen ? 'secondary' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={() => {
                if (summaryOpen) {
                  setSummaryOpen(false);
                } else if (threadSummary) {
                  setSummaryOpen(true);
                } else {
                  runThreadSummary();
                }
              }}
              disabled={summarizing}
            >
              {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
              Thread summary ({threadSize})
              {summaryOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
        </div>
      </div>

      {/* Foreign language nudge */}
      {isForeign && !translation && !translating && (
        <div className="px-4 py-2 bg-warning/5 border-b border-warning/20 flex items-center gap-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          <span>This email appears to be in <strong>{detectedLang}</strong>. Click Translate to read it in {LANGUAGES.find(l => l.code === translateLang)?.label}.</span>
        </div>
      )}

      {/* Translation panel */}
      {showTranslation && translation && (
        <div className="px-4 py-3 border-b border-border/60 bg-background">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5" />
              Translation ({LANGUAGES.find(l => l.code === translateLang)?.label || translateLang})
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs gap-1"
              onClick={() => { setTranslation(null); runTranslate(); }}
              disabled={translating}
            >
              <RefreshCw className="h-3 w-3" />
              Retranslate
            </Button>
          </div>
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground">{translation}</div>
        </div>
      )}

      {/* Thread summary panel */}
      {summaryOpen && (
        <div className="px-4 py-3 bg-background">
          {summarizing && !threadSummary ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : threadSummary ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">TL;DR</div>
                <p className="text-foreground leading-relaxed">{threadSummary.tldr}</p>
              </div>

              {actionItems.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <CheckSquare className="h-3 w-3" /> Action items
                  </div>
                  <ul className="space-y-1">
                    {actionItems.map((a, i) => (
                      <li key={i} className="flex gap-2 text-foreground">
                        <span className="text-primary">•</span>
                        <span><strong className="text-primary">{a.owner}:</strong> {a.task}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {openQuestions.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <HelpCircle className="h-3 w-3" /> Open questions
                  </div>
                  <ul className="space-y-1">
                    {openQuestions.map((q, i) => (
                      <li key={i} className="flex gap-2 text-foreground"><span className="text-warning">•</span>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              {decisions.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">Decisions made</div>
                  <ul className="space-y-1">
                    {decisions.map((d, i) => (
                      <li key={i} className="flex gap-2 text-foreground"><span className="text-success">✓</span>{d}</li>
                    ))}
                  </ul>
                </div>
              )}

              {threadSummary.nextStep && (
                <div className="pt-2 border-t border-border/40">
                  <div className="text-xs font-medium text-muted-foreground mb-1">Suggested next step</div>
                  <p className="text-foreground italic">{threadSummary.nextStep}</p>
                </div>
              )}

              <div className="pt-1 flex justify-end">
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={runThreadSummary} disabled={summarizing}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">No thread summary yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
