/**
 * Renders a Market Q&A answer.
 *
 * The previous renderer was a single `<p className="whitespace-pre-wrap">`,
 * which is why the answer had to stay short to be readable at all. This one
 * renders the sectioned markdown the research pipeline now produces, resolves
 * the inline `[[id]]` markers into numbered source chips, and surfaces the
 * structured evidence — figures, per-audience implications, timeline, the
 * contrarian read and what would change it — beneath the prose.
 *
 * Semantic design tokens only (see FRONTEND_TOOLING.md).
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, Building2, CalendarClock, Eye, Landmark, Scale, TrendingUp, Users, Wallet } from 'lucide-react';
import { stripLabelledIdentifiers } from '@/utils/stripTechnicalIdentifiers';
import { cn } from '@/lib/utils';
import type { MarketQAImplications, MarketQAKeyFigure, MarketQARetrievedItem, MarketQATimelineEntry } from '@/types/marketUpdates';

interface Props {
  content: string;
  retrieved?: MarketQARetrievedItem[];
  keyFigures?: MarketQAKeyFigure[];
  implications?: MarketQAImplications;
  timeline?: MarketQATimelineEntry[];
  watchItems?: string[];
  contrarianView?: string;
  /** Suppresses the structured sections while the prose is still arriving. */
  streaming?: boolean;
}

const AUDIENCES: Array<{ key: keyof MarketQAImplications; label: string; icon: typeof Users }> = [
  { key: 'investors', label: 'Investors', icon: TrendingUp },
  { key: 'owner_occupiers', label: 'Owner occupiers', icon: Building2 },
  { key: 'first_home_buyers', label: 'First home buyers', icon: Users },
  { key: 'developers', label: 'Developers', icon: Landmark },
  { key: 'brokers', label: 'Brokers', icon: Wallet },
];

/**
 * Swap `[[uuid]]` markers for markdown links carrying the source's position,
 * title and URL, so the renderer can draw them as numbered chips. Markers that
 * do not resolve to a retrieved source are removed rather than shown raw — an
 * unresolvable citation is a grounding gap, not something to render at the user.
 */
function linkCitations(content: string, retrieved: MarketQARetrievedItem[]): string {
  const positions = new Map(retrieved.map((item, index) => [item.id, index + 1]));
  return content.replace(/\[\[([^\]]+)\]\]/g, (_whole, id: string) => {
    const position = positions.get(id.trim());
    if (!position) return '';
    const item = retrieved[position - 1];
    const title = (item.title ?? '').replace(/"/g, "'");
    return `[${position}](${item.source_url} "${item.source_name}: ${title}")`;
  });
}

function Section({ title, icon: Icon, tone = 'muted', children }: { title: string; icon: typeof Eye; tone?: 'muted' | 'primary' | 'destructive'; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className={cn(
        'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide',
        tone === 'primary' ? 'text-primary' : tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
      )}>
        <Icon className="h-3.5 w-3.5" aria-hidden />{title}
      </h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function MarketQAAnswer({ content, retrieved = [], keyFigures = [], implications, timeline = [], watchItems = [], contrarianView, streaming }: Props) {
  const prose = useMemo(() => stripLabelledIdentifiers(linkCitations(content ?? '', retrieved)), [content, retrieved]);
  const audiences = AUDIENCES.filter(a => (implications?.[a.key] ?? '').trim().length > 0);
  const figures = keyFigures.filter(f => f.label && f.value);
  const showStructured = !streaming;

  return (
    <div className="min-w-0">
      <div className="text-sm leading-relaxed text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
            h2: ({ children }) => <h3 className="mt-4 border-t border-border/60 pt-3 text-[11px] font-semibold uppercase tracking-wide text-primary first:mt-0 first:border-0 first:pt-0">{children}</h3>,
            h3: ({ children }) => <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h4>,
            p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
            ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
            ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
            li: ({ children }) => <li className="marker:text-muted-foreground">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
            blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2 text-muted-foreground">{children}</blockquote>,
            code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground">{children}</code>,
            // Wide tables must scroll inside their own container rather than
            // pushing the dialog body sideways.
            table: ({ children }) => <div className="mt-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
            th: ({ children }) => <th className="border border-border/60 bg-muted/50 px-2 py-1 text-left font-semibold">{children}</th>,
            td: ({ children }) => <td className="border border-border/60 px-2 py-1 align-top">{children}</td>,
            // Citation chips: the link text is always the source's position.
            a: ({ children, href, title }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                title={title}
                className="mx-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded border border-primary/40 bg-primary/10 px-1 align-super text-[9px] font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                {children}
              </a>
            ),
          }}
        >
          {prose}
        </ReactMarkdown>
      </div>

      {figures.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {figures.map((figure, index) => (
            <div key={`${figure.label}-${index}`} className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2">
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{figure.label}</div>
              <div className="mt-0.5 text-sm font-semibold text-primary">{figure.value}</div>
            </div>
          ))}
        </div>
      )}

      {showStructured && audiences.length > 0 && (
        <Section title="What it means for" icon={Users} tone="primary">
          <div className="grid gap-2 sm:grid-cols-2">
            {audiences.map(({ key, label, icon: Icon }) => (
              <div key={key} className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden />{label}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-foreground">{implications?.[key]}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {showStructured && timeline.length > 0 && (
        <Section title="Sequence of events" icon={CalendarClock}>
          <ol className="space-y-1.5 border-l border-border/60 pl-3">
            {timeline.map((entry, index) => (
              <li key={`${entry.date}-${index}`} className="relative text-xs">
                <span className="absolute -left-[15px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                <span className="font-semibold text-foreground">{entry.date}</span>
                <span className="text-muted-foreground"> — {entry.event}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {showStructured && contrarianView && (
        <Section title="The other read" icon={Scale}>
          <p className="rounded-lg border border-border/60 bg-background/50 p-2.5 text-xs leading-relaxed text-muted-foreground">{contrarianView}</p>
        </Section>
      )}

      {showStructured && watchItems.length > 0 && (
        <Section title="What would change this" icon={Eye} tone="destructive">
          <ul className="space-y-1">
            {watchItems.map((item, index) => (
              <li key={index} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
