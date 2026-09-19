import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import {
  Lightbulb, AlertTriangle, CheckCircle2, Info, Brain,
  ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus,
  BarChart3, Zap, FileDown, Clock,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Block types parsed from :::type … ::: fences
// ──────────────────────────────────────────────
interface RichBlock {
  kind: 'markdown' | 'tip' | 'warning' | 'success' | 'note' | 'insight' | 'metric' | 'steps' | 'compare' | 'detail';
  content: string;
  meta?: string;
}

// ──────────────────────────────────────────────
// Parser (unchanged logic)
// ──────────────────────────────────────────────
function parseBlocks(raw: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const lines = raw.split('\n');
  let current: RichBlock | null = null;
  let buffer: string[] = [];

  const flushMarkdown = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push({ kind: 'markdown', content: text });
    buffer = [];
  };

  const validKinds = ['tip', 'warning', 'success', 'note', 'insight', 'metric', 'steps', 'compare', 'detail'] as const;
  type BlockKind = typeof validKinds[number];

  for (const line of lines) {
    const openMatch = line.match(/^:::(tip|warning|success|note|insight|metric|steps|compare|detail)\s*(.*)?$/);
    if (openMatch && !current) {
      flushMarkdown();
      const kind = openMatch[1] as BlockKind;
      const meta = openMatch[2]?.trim() || undefined;
      current = { kind, content: '', meta };
      continue;
    }

    if (line.trim() === ':::' && current) {
      current.content = current.content.trim();
      blocks.push(current);
      current = null;
      continue;
    }

    if (current) {
      current.content += (current.content ? '\n' : '') + line;
    } else {
      buffer.push(line);
    }
  }

  if (current) {
    buffer.push(`:::${current.kind}${current.meta ? ' ' + current.meta : ''}`);
    buffer.push(current.content);
  }
  flushMarkdown();

  return blocks;
}

// ──────────────────────────────────────────────
// Shared prose styling — obsidian code, gold inline chip
// ──────────────────────────────────────────────
const PROSE_CLASSES = cn(
  'prose prose-sm dark:prose-invert max-w-none break-words overflow-hidden',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:leading-relaxed [&_p]:text-foreground/90',
  '[&_a]:text-primary [&_a]:no-underline hover:[&_a]:underline',
  '[&_strong]:text-foreground [&_strong]:font-semibold',
  '[&_h1]:font-heading [&_h2]:font-heading [&_h3]:font-heading',
  '[&_h1]:tracking-tight [&_h2]:tracking-tight [&_h3]:tracking-tight',
  // Inline code — gold-tinted mono chip
  '[&_:not(pre)>code]:bg-primary/10 [&_:not(pre)>code]:text-primary',
  '[&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:rounded',
  '[&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:font-mono',
  '[&_:not(pre)>code]:before:content-none [&_:not(pre)>code]:after:content-none',
  // Fenced code — obsidian slab with gold caret line
  '[&_pre]:relative [&_pre]:bg-[hsl(var(--aurixa-obsidian))] [&_pre]:border [&_pre]:border-[hsl(var(--aurixa-hairline))]',
  '[&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:p-3 [&_pre]:pl-4',
  '[&_pre]:before:absolute [&_pre]:before:left-0 [&_pre]:before:top-2 [&_pre]:before:bottom-2 [&_pre]:before:w-[2px]',
  '[&_pre]:before:bg-gradient-to-b [&_pre]:before:from-primary/60 [&_pre]:before:to-primary/10 [&_pre]:before:rounded-full',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground/85 [&_pre_code]:text-[0.8rem]',
  // Tables — hairline, compact
  '[&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs [&_table]:border-collapse',
  '[&_th]:py-1.5 [&_th]:px-2 [&_th]:text-left [&_th]:font-mono [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-[10px] [&_th]:text-muted-foreground',
  '[&_th]:border-b [&_th]:border-[hsl(var(--aurixa-hairline))]',
  '[&_td]:py-1.5 [&_td]:px-2 [&_td]:border-b [&_td]:border-[hsl(var(--aurixa-hairline))]/60',
  // Blockquote — gold hairline, italic
  '[&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  // Lists
  '[&_ul]:space-y-1 [&_ol]:space-y-1',
  '[&_li]:marker:text-primary/60',
);

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className={PROSE_CLASSES}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

// ──────────────────────────────────────────────
// Callout blocks — shared shell with tone tints
// ──────────────────────────────────────────────
type CalloutTone = 'primary' | 'warning' | 'success' | 'muted' | 'insight';

const CALLOUT_TONE: Record<CalloutTone, { bar: string; bg: string; iconBg: string; iconColor: string }> = {
  primary:  { bar: 'bg-primary',            bg: 'bg-primary/[0.04]',      iconBg: 'bg-primary/10',    iconColor: 'text-primary' },
  warning:  { bar: 'bg-warning',            bg: 'bg-warning/[0.04]',      iconBg: 'bg-warning/10',    iconColor: 'text-warning' },
  success:  { bar: 'bg-success',            bg: 'bg-success/[0.04]',      iconBg: 'bg-success/10',    iconColor: 'text-success' },
  muted:    { bar: 'bg-muted-foreground/40',bg: 'bg-muted/30',            iconBg: 'bg-muted/60',      iconColor: 'text-muted-foreground' },
  insight:  { bar: 'bg-primary/60',         bg: 'bg-primary/[0.06]',      iconBg: 'bg-primary/15',    iconColor: 'text-primary' },
};

function Callout({
  tone, icon, eyebrow, italic, children,
}: {
  tone: CalloutTone;
  icon: React.ReactNode;
  eyebrow: string;
  italic?: boolean;
  children: React.ReactNode;
}) {
  const t = CALLOUT_TONE[tone];
  return (
    <div className={cn('my-2.5 relative overflow-hidden rounded-xl aurixa-hairline', t.bg)}>
      <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', t.bar)} />
      <div className="flex gap-3 p-3 pl-4">
        <div className={cn('shrink-0 h-7 w-7 rounded-full grid place-items-center', t.iconBg)}>
          <span className={t.iconColor}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn('text-[10px] uppercase tracking-[0.14em] font-mono mb-1', t.iconColor)}>{eyebrow}</p>
          <div className={cn('text-sm', italic && 'italic text-muted-foreground')}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

type StrProps = { content: string };

function TipBlock({ content }: StrProps)     { return <Callout tone="primary" eyebrow="Tip"      icon={<Lightbulb className="h-3.5 w-3.5" />}><MarkdownContent content={content} /></Callout>; }
function WarningBlock({ content }: StrProps) { return <Callout tone="warning" eyebrow="Warning"  icon={<AlertTriangle className="h-3.5 w-3.5" />}><MarkdownContent content={content} /></Callout>; }
function SuccessBlock({ content }: StrProps) { return <Callout tone="success" eyebrow="Success"  icon={<CheckCircle2 className="h-3.5 w-3.5" />}><MarkdownContent content={content} /></Callout>; }
function NoteBlock({ content }: StrProps)    { return <Callout tone="muted"   eyebrow="Note"     icon={<Info className="h-3.5 w-3.5" />}><MarkdownContent content={content} /></Callout>; }
function InsightBlock({ content }: StrProps) { return <Callout tone="insight" eyebrow="Insight"  icon={<Brain className="h-3.5 w-3.5" />} italic><MarkdownContent content={content} /></Callout>; }

// ──────────────────────────────────────────────
// Metric — glass tile with aurora tint
// ──────────────────────────────────────────────
function MetricBlock({ content }: StrProps) {
  const lines = content.split('\n').filter(l => l.trim());
  const data: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^(\w[\w\s]*?):\s*(.+)$/);
    if (match) data[match[1].trim().toLowerCase()] = match[2].trim();
  }

  const label = data.label || data.title || 'Metric';
  const value = data.value || data.amount || '—';
  const change = data.change || data.trend || null;
  const isPositive = change ? change.includes('+') || change.toLowerCase().includes('up') : false;
  const isNegative = change ? change.includes('-') || change.toLowerCase().includes('down') : false;

  return (
    <div className="my-2.5 aurixa-glass rounded-xl p-3.5 overflow-hidden relative">
      <div className="absolute inset-0 opacity-40 pointer-events-none"
           style={{ background: 'radial-gradient(120% 80% at 100% 0%, hsl(var(--aurixa-aurora-2) / 0.12), transparent 60%)' }} />
      <div className="relative">
        <p className="text-[10px] uppercase tracking-[0.14em] font-mono text-muted-foreground truncate">{label}</p>
        <div className="flex items-end gap-2 mt-1.5 flex-wrap">
          <span className="font-heading text-2xl font-semibold text-foreground leading-none break-all tracking-tight">{value}</span>
          {change && (
            <span className={cn(
              'inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full font-mono',
              isPositive && 'text-success bg-success/10',
              isNegative && 'text-destructive bg-destructive/10',
              !isPositive && !isNegative && 'text-muted-foreground bg-muted',
            )}>
              {isPositive ? <TrendingUp className="h-3 w-3" /> : isNegative ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {change}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Steps — vertical gold timeline
// ──────────────────────────────────────────────
function StepsBlock({ content }: StrProps) {
  const steps = content.split('\n').filter(l => l.trim());
  return (
    <div className="my-2.5 pl-1">
      <div className="relative pl-5 space-y-3 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-gradient-to-b before:from-primary/40 before:via-primary/20 before:to-transparent">
        {steps.map((step, i) => {
          const text = step.replace(/^\d+[\.\)]\s*|^[-*]\s*/, '').trim();
          if (!text) return null;
          return (
            <div key={i} className="relative">
              <div className="absolute -left-[1.25rem] top-1 h-3 w-3 rounded-full bg-background border-2 border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]" />
              <p className="text-sm leading-relaxed">
                <span className="font-mono text-[10px] text-primary/70 mr-2">{String(i + 1).padStart(2, '0')}</span>
                {text}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Compare — hairline tiles
// ──────────────────────────────────────────────
function CompareBlock({ content }: StrProps) {
  const options: { title: string; body: string }[] = [];
  const lines = content.split('\n');
  let current: { title: string; body: string } | null = null;

  for (const line of lines) {
    const optMatch = line.match(/^(?:Option\s+\w+|[\w\s]+?):\s*(.+)$/i);
    if (optMatch && !current?.body) {
      if (current) options.push(current);
      const colonIdx = line.indexOf(':');
      current = { title: line.slice(0, colonIdx).trim(), body: line.slice(colonIdx + 1).trim() };
    } else if (current) {
      current.body += '\n' + line;
    } else {
      current = { title: `Option ${options.length + 1}`, body: line.trim() };
    }
  }
  if (current) options.push(current);

  return (
    <div className="my-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((opt, i) => (
        <div key={i} className="aurixa-hairline rounded-xl bg-muted/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] font-mono text-primary mb-1.5">{opt.title}</p>
          <div className="text-sm">
            <MarkdownContent content={opt.body.trim()} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// Detail — collapsible hairline
// ──────────────────────────────────────────────
function DetailBlock({ content, meta }: { content: string; meta?: string }) {
  const [open, setOpen] = useState(false);
  const summary = meta || 'Show details';

  return (
    <div className="my-2.5 aurixa-hairline rounded-xl bg-muted/15 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-primary" /> : <ChevronRight className="h-3.5 w-3.5 text-primary" />}
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary/70">Details</span>
        <span className="truncate">{summary}</span>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-2 text-sm border-t border-[hsl(var(--aurixa-hairline))] animate-aurixa-unfold origin-top">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Inline chart (unchanged behaviour, refreshed skin)
// ──────────────────────────────────────────────
function InlineChart({ content }: StrProps) {
  const chartMatch = content.match(/```json\s*(\{[\s\S]*?"chart"[\s\S]*?\})\s*```/);
  if (!chartMatch) return null;

  try {
    const chartData = JSON.parse(chartMatch[1]);
    if (!chartData.chart) return null;
    const { type, title, labels, datasets } = chartData.chart;
    const maxVal = Math.max(...(datasets?.[0]?.data || [1]));
    const colors = datasets?.[0]?.backgroundColor || ['hsl(var(--primary))'];

    return (
      <div className="mt-3 aurixa-hairline rounded-xl bg-muted/15 p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <div className="h-6 w-6 rounded-full grid place-items-center bg-primary/10 text-primary">
            <BarChart3 className="h-3.5 w-3.5" />
          </div>
          <span className="font-heading text-sm font-semibold tracking-tight">{title || 'Chart'}</span>
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-mono uppercase tracking-wider">{type}</span>
        </div>
        {(type === 'bar' || type === 'line') && (
          <div className="space-y-1.5">
            {labels?.map((label: string, i: number) => (
              <div key={label} className="flex items-center gap-2 text-[10px]">
                <span className="w-20 truncate text-muted-foreground text-right font-mono">{label}</span>
                <div className="flex-1 h-3.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${maxVal > 0 ? (datasets[0].data[i] / maxVal) * 100 : 0}%`,
                      background: Array.isArray(colors)
                        ? `linear-gradient(90deg, ${colors[i % colors.length]}, hsl(var(--primary)))`
                        : colors,
                    }}
                  />
                </div>
                <span className="w-10 text-right font-mono font-medium">{datasets[0].data[i]}</span>
              </div>
            ))}
          </div>
        )}
        {(type === 'pie' || type === 'doughnut') && (
          <div className="flex flex-wrap gap-2.5">
            {labels?.map((label: string, i: number) => {
              const total = datasets[0].data.reduce((a: number, b: number) => a + b, 0);
              const pct = total > 0 ? Math.round((datasets[0].data[i] / total) * 100) : 0;
              return (
                <div key={label} className="flex items-center gap-1.5 text-[10px]">
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: Array.isArray(colors) ? colors[i % colors.length] : colors }}
                  />
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium">{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// Confidence indicator — refreshed
// ──────────────────────────────────────────────
function ConfidenceIndicator({ content }: StrProps) {
  const healthMatch = content.match(/health[_ ]score[:\s]*(\d+)/i);
  const confidenceMatch = content.match(/confidence[:\s]*(\d+(?:\.\d+)?)/i);
  const score = healthMatch ? parseInt(healthMatch[1]) : confidenceMatch ? parseFloat(confidenceMatch[1]) : null;
  if (score === null) return null;
  const normalizedScore = score > 1 ? score : score * 100;
  const tone =
    normalizedScore >= 80
      ? { text: 'text-success', bg: 'bg-success/10', bar: 'bg-success', label: 'High' }
      : normalizedScore >= 50
        ? { text: 'text-warning', bg: 'bg-warning/10', bar: 'bg-warning', label: 'Medium' }
        : { text: 'text-destructive', bg: 'bg-destructive/10', bar: 'bg-destructive', label: 'Low' };
  return (
    <div className={cn('mt-2.5 inline-flex items-center gap-2 rounded-full pl-2 pr-3 py-1', tone.bg)}>
      <div className="relative h-1 w-16 rounded-full bg-background/40 overflow-hidden">
        <div className={cn('absolute inset-y-0 left-0 rounded-full', tone.bar)} style={{ width: `${normalizedScore}%` }} />
      </div>
      <span className={cn('text-[10px] font-mono uppercase tracking-wider', tone.text)}>
        {tone.label} · {Math.round(normalizedScore)}%
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────
// Contextual badges — mono chips
// ──────────────────────────────────────────────
function ContextualBadges({ content }: StrProps) {
  const badges: { match: boolean; icon: React.ReactNode; label: string }[] = [
    { match: content.includes('Playbook "'), icon: <Zap className="h-3 w-3" />, label: 'Playbook Executed' },
    { match: content.includes('Weekly Digest'), icon: <TrendingUp className="h-3 w-3" />, label: 'Weekly Digest' },
    { match: (content.includes('Pipeline Summary') || content.includes('export')) && content.includes('| Client'), icon: <FileDown className="h-3 w-3" />, label: 'Exported Data' },
    { match: content.includes('engagement_score'), icon: <Brain className="h-3 w-3" />, label: 'Engagement Analysis' },
    { match: content.includes('Memory saved'), icon: <Brain className="h-3 w-3" />, label: 'Memory Saved' },
    { match: content.includes('Report queued'), icon: <FileDown className="h-3 w-3" />, label: 'Report Queued' },
    { match: content.includes('Scheduled for'), icon: <Clock className="h-3 w-3" />, label: 'Scheduled' },
  ];

  const active = badges.filter(b => b.match);
  if (active.length === 0) return null;

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {active.map((b, i) => (
        <div key={i} className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
          {b.icon} {b.label}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// Main exported renderer
// ──────────────────────────────────────────────
interface AgentMessageRendererProps {
  content: string;
}

export function AgentMessageRenderer({ content }: AgentMessageRendererProps) {
  const blocks = parseBlocks(content);

  return (
    <div className="min-w-0 overflow-hidden break-words">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'tip':      return <TipBlock key={i} content={block.content} />;
          case 'warning':  return <WarningBlock key={i} content={block.content} />;
          case 'success':  return <SuccessBlock key={i} content={block.content} />;
          case 'note':     return <NoteBlock key={i} content={block.content} />;
          case 'insight':  return <InsightBlock key={i} content={block.content} />;
          case 'metric':   return <MetricBlock key={i} content={block.content} />;
          case 'steps':    return <StepsBlock key={i} content={block.content} />;
          case 'compare':  return <CompareBlock key={i} content={block.content} />;
          case 'detail':   return <DetailBlock key={i} content={block.content} meta={block.meta} />;
          case 'markdown': return <MarkdownContent key={i} content={block.content} />;
          default:         return null;
        }
      })}

      <InlineChart content={content} />
      <ConfidenceIndicator content={content} />
      <ContextualBadges content={content} />
    </div>
  );
}
