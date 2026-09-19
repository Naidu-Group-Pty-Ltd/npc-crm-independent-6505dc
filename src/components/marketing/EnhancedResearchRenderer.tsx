import { useState, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Globe, ChevronDown, Copy, Check, ExternalLink, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Components } from 'react-markdown';

interface EnhancedResearchRendererProps {
  content: string;
  citations: string[];
  title: string;
  icon?: React.ReactNode;
  fetchedAt?: string;
}

/**
 * Extracts first ~200 chars of plain text from markdown for preview.
 */
function extractPreview(md: string): string {
  const plain = md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
  return plain.length > 200 ? plain.slice(0, 200) + '…' : plain;
}

/**
 * Converts inline [1][2][3] citation references to styled superscript badges.
 */
function processCitations(text: string, citations: string[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const num = parseInt(match[1], 10);
    const url = citations[num - 1];
    if (url) {
      parts.push(
        <a
          key={`cite-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-4 h-4 text-[8px] font-bold rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors align-super ml-0.5 no-underline"
          title={`Source ${num}`}
        >
          {num}
        </a>
      );
    } else {
      parts.push(
        <sup key={`cite-${match.index}`} className="text-[9px] font-semibold text-primary/60 ml-0.5">
          [{num}]
        </sup>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Detects if text contains "Meta/Facebook ad impact:" pattern and renders as callout.
 */
function isAdImpactCallout(text: string): boolean {
  return /meta\/facebook ad impact/i.test(text);
}

/**
 * Custom markdown components for enhanced rendering.
 */
export function createMarkdownComponents(citations: string[] = []): Components {
  return {
    // Enhanced tables
    table: ({ children, ...props }) => (
      <div className="my-4 overflow-x-auto rounded-lg border border-border/60 shadow-sm">
        <table className="w-full text-xs border-collapse" {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ children, ...props }) => (
      <thead className="bg-muted/60 border-b border-border/60" {...props}>
        {children}
      </thead>
    ),
    th: ({ children, ...props }) => (
      <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-foreground/80" {...props}>
        {children}
      </th>
    ),
    tr: ({ children, ...props }) => (
      <tr className="border-b border-border/30 even:bg-muted/20 hover:bg-muted/40 transition-colors" {...props}>
        {children}
      </tr>
    ),
    td: ({ children, ...props }) => (
      <td className="px-3 py-2 text-xs text-foreground/80 leading-relaxed" {...props}>
        {children}
      </td>
    ),

    // Enhanced headings with left accent
    h1: ({ children, ...props }) => (
      <h1 className="text-base font-bold text-foreground mt-6 mb-3 pb-2 border-b border-primary/20 flex items-center gap-2" {...props}>
        <span className="w-1 h-5 rounded-full bg-primary shrink-0" />
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 className="text-sm font-bold text-foreground mt-5 mb-2.5 pb-1.5 border-b border-border/40 flex items-center gap-2" {...props}>
        <span className="w-0.5 h-4 rounded-full bg-primary/70 shrink-0" />
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="text-[13px] font-semibold text-foreground mt-4 mb-2 flex items-center gap-1.5" {...props}>
        <span className="w-1.5 h-1.5 rounded-full bg-primary/50 shrink-0" />
        {children}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4 className="text-xs font-semibold text-foreground/90 mt-3 mb-1.5" {...props}>
        {children}
      </h4>
    ),

    // Enhanced paragraphs with callout detection
    p: ({ children, ...props }) => {
      const text = typeof children === 'string' ? children : '';
      const childArray = Array.isArray(children) ? children : [children];

      // Check if this paragraph contains a "Meta/Facebook ad impact" callout
      const fullText = childArray
        .map((c: any) => {
          if (typeof c === 'string') return c;
          if (c?.props?.children) return typeof c.props.children === 'string' ? c.props.children : '';
          return '';
        })
        .join('');

      if (isAdImpactCallout(fullText)) {
        return (
          <div className="my-3 rounded-lg border border-primary/25 bg-primary/[0.04] p-3 flex items-start gap-2.5">
            <span className="text-sm mt-0.5 shrink-0">📣</span>
            <p className="text-xs text-foreground/80 leading-relaxed m-0" {...props}>
              {children}
            </p>
          </div>
        );
      }

      // Check for "YoY Changes", "Best Practices", "Caveats" callouts
      const isHighlight = /^(yoy changes|best practices|caveats|key takeaway|important)/i.test(fullText);
      if (isHighlight) {
        const isWarning = /^caveats/i.test(fullText);
        return (
          <div className={cn(
            "my-3 rounded-lg border p-3 flex items-start gap-2.5",
            isWarning
              ? "border-brand-500/25 bg-brand-500/[0.04]"
              : "border-success/25 bg-success/[0.04]"
          )}>
            <span className="text-sm mt-0.5 shrink-0">{isWarning ? '⚠️' : '📈'}</span>
            <p className="text-xs text-foreground/80 leading-relaxed m-0" {...props}>
              {children}
            </p>
          </div>
        );
      }

      return (
        <p className="my-2 text-xs text-foreground/70 leading-relaxed" {...props}>
          {children}
        </p>
      );
    },

    // Enhanced strong text with citation processing
    strong: ({ children, ...props }) => {
      const text = typeof children === 'string' ? children : '';
      if (isAdImpactCallout(text)) {
        return (
          <strong className="text-primary font-semibold" {...props}>
            {children}
          </strong>
        );
      }
      return (
        <strong className="text-foreground font-semibold" {...props}>
          {children}
        </strong>
      );
    },

    // Enhanced links
    a: ({ children, href, ...props }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 underline underline-offset-2 decoration-primary/30 hover:decoration-primary/60 transition-colors"
        {...props}
      >
        {children}
      </a>
    ),

    // Enhanced lists
    ul: ({ children, ...props }) => (
      <ul className="my-2.5 space-y-1 list-none pl-0" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol className="my-2.5 space-y-1.5 list-none pl-0 counter-reset-[item]" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="text-xs text-foreground/70 leading-relaxed flex items-start gap-2 pl-1" {...props}>
        <span className="w-1 h-1 rounded-full bg-primary/40 mt-1.5 shrink-0" />
        <span className="flex-1">{children}</span>
      </li>
    ),

    // Enhanced blockquotes
    blockquote: ({ children, ...props }) => (
      <blockquote className="my-3 pl-3 border-l-2 border-primary/30 text-muted-foreground italic" {...props}>
        {children}
      </blockquote>
    ),

    // Enhanced horizontal rules
    hr: () => (
      <div className="my-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-border/60" />
        <span className="text-[10px] text-muted-foreground/50">•</span>
        <div className="flex-1 h-px bg-border/60" />
      </div>
    ),

    // Enhanced code
    code: ({ children, ...props }) => (
      <code className="px-1.5 py-0.5 rounded bg-muted/60 text-[11px] font-mono text-foreground/80" {...props}>
        {children}
      </code>
    ),
  };
}

export function EnhancedResearchRenderer({
  content,
  citations,
  title,
  icon,
  fetchedAt,
}: EnhancedResearchRendererProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const preview = useMemo(() => extractPreview(content), [content]);
  const components = useMemo(() => createMarkdownComponents(citations), [citations]);

  // Process content to convert inline [n] citations to clickable badges
  const processedContent = useMemo(() => {
    // We'll let ReactMarkdown handle rendering, but process citation refs via text nodes
    return content;
  }, [content]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden transition-all duration-300">
      {/* Toggle Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left group"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon || <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
            {title}
          </span>
          {citations.length > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-primary/20 text-primary/70 shrink-0">
              {citations.length} sources
            </Badge>
          )}
          {fetchedAt && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] text-muted-foreground/50">
              <Clock className="h-2.5 w-2.5" />
              {new Date(fetchedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-300",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Preview snippet when collapsed */}
      {!isOpen && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-muted-foreground/50 leading-relaxed line-clamp-2">
            {preview}
          </p>
        </div>
      )}

      {/* Expanded Content */}
      {isOpen && (
        <div className="border-t border-border/40">
          {/* Toolbar */}
          <div className="flex items-center justify-end gap-2 px-4 py-2 bg-muted/10 border-b border-border/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-7 px-2.5 text-[10px] text-muted-foreground hover:text-foreground gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-success" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy report
                </>
              )}
            </Button>
          </div>

          {/* Main Content */}
          <div className="px-4 py-4 max-w-prose">
            <div className="prose-override">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {processedContent}
              </ReactMarkdown>
            </div>
          </div>

          {/* Enhanced Citations Footer */}
          {citations.length > 0 && (
            <div className="px-4 py-3 border-t border-border/40 bg-muted/10">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" />
                Sources
              </p>
              <div className="flex flex-wrap gap-2">
                {citations.map((url, i) => {
                  let domain = '';
                  try {
                    domain = new URL(url).hostname.replace('www.', '');
                  } catch {
                    domain = `Source ${i + 1}`;
                  }
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10px] rounded-md border border-border/50 bg-card hover:bg-muted/40 px-2.5 py-1.5 text-foreground/70 hover:text-foreground transition-colors group"
                    >
                      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary/10 text-primary text-[8px] font-bold shrink-0">
                        {i + 1}
                      </span>
                      <span className="truncate max-w-[140px]">{domain}</span>
                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
