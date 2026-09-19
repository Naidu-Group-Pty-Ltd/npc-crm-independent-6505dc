import { useMemo, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'lucide-react';
import DOMPurify, { type Config } from 'dompurify';
import { splitMarkdownForViewer, type ViewerSegment } from '@/lib/reports/viewerFigures';

interface InvestmentReportMarkdownProps {
  content: string;
  sourcesContent?: string | null;
  includeSources?: boolean;
  processTextWithBadges?: (text: any) => ReactNode;
}

function renderText(children: any, processTextWithBadges?: (text: any) => ReactNode) {
  return processTextWithBadges ? processTextWithBadges(children) : children;
}

const createMarkdownComponents = (processTextWithBadges?: (text: any) => ReactNode) => ({
  h1: ({ children }: any) => (
    <h1 className="mb-6 mt-10 border-b border-border/80 pb-4 text-3xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="mb-4 mt-9 flex items-center gap-3 text-2xl font-semibold tracking-tight text-primary">
      <span className="h-6 w-1 rounded-full bg-primary/70" />
      {children}
    </h2>
  ),
  h3: ({ children }: any) => <h3 className="mb-3 mt-7 text-xl font-semibold text-foreground">{children}</h3>,
  p: ({ children }: any) => <p className="mb-5 text-[15px] leading-8 text-foreground/90">{renderText(children, processTextWithBadges)}</p>,
  ul: ({ children }: any) => <ul className="mb-6 ml-5 space-y-2.5 list-disc marker:text-primary/70">{children}</ul>,
  ol: ({ children }: any) => <ol className="mb-6 ml-5 space-y-2.5 list-decimal marker:font-semibold marker:text-primary/80">{children}</ol>,
  li: ({ children }: any) => <li className="pl-2 text-[15px] leading-7 text-foreground/90">{children}</li>,
  table: ({ children }: any) => (
    <div className="my-8 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-muted/80 text-foreground">{children}</thead>,
  tbody: ({ children }: any) => <tbody className="divide-y divide-border/70">{children}</tbody>,
  tr: ({ children }: any) => <tr className="transition-colors even:bg-muted/20 hover:bg-muted/40">{children}</tr>,
  th: ({ children }: any) => <th className="border-r border-border/70 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0">{children}</th>,
  td: ({ children }: any) => <td className="border-r border-border/50 px-4 py-3 align-top leading-6 text-foreground/90 last:border-r-0">{renderText(children, processTextWithBadges)}</td>,
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: any) => <em className="italic text-muted-foreground">{children}</em>,
  blockquote: ({ children }: any) => (
    <blockquote className="my-7 rounded-r-xl border-l-4 border-primary bg-primary/5 px-5 py-4 text-[15px] italic leading-7 text-foreground/80 shadow-sm">
      {children}
    </blockquote>
  ),
  code: ({ children }: any) => <code className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>,
});

/**
 * The figures the print routes draw, styled for the screen with the
 * platform's own tokens: chart figures (an `<img>` carrying the SVG),
 * compact figures at the compact fraction, the at-a-glance callout and the
 * margin sidenote. Every colour is a semantic token; the SVG carries its own.
 */
const FIGURE_STYLES = [
  '[&_.chart-figure]:my-6 [&_.chart-figure]:mx-auto [&_.chart-figure]:max-w-full',
  '[&_.chart-figure_img]:h-auto [&_.chart-figure_img]:w-full [&_.chart-figure_svg]:h-auto [&_.chart-figure_svg]:w-full',
  '[&_.chart-compact]:max-w-[60%]',
  '[&_figcaption]:mt-2 [&_figcaption]:text-center [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground',
  '[&_.callout]:my-6 [&_.callout]:rounded-xl [&_.callout]:border [&_.callout]:border-border [&_.callout]:bg-muted/30 [&_.callout]:px-5 [&_.callout]:py-4',
  '[&_.callout-label]:mb-2 [&_.callout-label]:block [&_.callout-label]:text-xs [&_.callout-label]:font-semibold [&_.callout-label]:uppercase [&_.callout-label]:tracking-[0.14em] [&_.callout-label]:text-muted-foreground',
  '[&_.callout_ul.marked]:m-0 [&_.callout_ul.marked]:list-none [&_.callout_ul.marked]:space-y-1.5 [&_.callout_ul.marked]:pl-0 [&_.callout_li]:text-[15px] [&_.callout_li]:leading-7 [&_.callout_li]:text-foreground/90',
  '[&_.sidenote]:my-6 [&_.sidenote]:rounded-xl [&_.sidenote]:border-l-4 [&_.sidenote]:border-primary/60 [&_.sidenote]:bg-primary/5 [&_.sidenote]:px-5 [&_.sidenote]:py-4 [&_.sidenote_p]:mb-2 [&_.sidenote_p]:text-sm [&_.sidenote_p]:leading-6',
  '[&_.sidenote-label]:mb-2 [&_.sidenote-label]:block [&_.sidenote-label]:text-xs [&_.sidenote-label]:font-semibold [&_.sidenote-label]:uppercase [&_.sidenote-label]:tracking-[0.14em] [&_.sidenote-label]:text-muted-foreground',
].join(' ');

/**
 * The sanitiser the figure HTML passes through before it is injected.
 *
 * The HTML is `renderVizDirective`'s own output over escaped directive
 * values — never markup from the record — but the record is model-written
 * and stored, and the component that injects HTML is where the rule is
 * enforced rather than assumed (`check-baseline-invariants`, item 8). The
 * profile admits exactly what the renderer emits: a `<figure>` carrying the
 * SVG as a base64 data-URI `<img>` or inline, the at-a-glance callout and
 * the margin sidenote with its inline spark. Nothing executable, nothing
 * that navigates and nothing that fetches: `ALLOWED_URI_REGEXP` is
 * DOMPurify's own with its scheme list reduced to the one data-URI form the
 * renderer uses (the `[^a-z]` and bare-word alternatives are what let `d`,
 * `viewBox` and `fill` values through — they are not URIs). A spec proves
 * the sanitiser removes nothing from a drawn figure of every kind.
 */
export const FIGURE_SANITIZE: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: [
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form',
    'input', 'button', 'textarea', 'select', 'a', 'foreignObject', 'use', 'image',
    'audio', 'video', 'source', 'track', 'canvas', 'template',
  ],
  FORBID_ATTR: ['srcset', 'href', 'xlink:href', 'tabindex'],
  ALLOWED_URI_REGEXP: /^(?:data:image\/svg\+xml;base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

/** Sanitise one figure's HTML. Exported for the spec that measures it. */
export function sanitizeFigureHtml(html: string): string {
  return DOMPurify.sanitize(html, FIGURE_SANITIZE);
}

function sanitizedSegments(content: string): ViewerSegment[] {
  return splitMarkdownForViewer(content).segments.map((segment) => (
    segment.kind === 'figure' ? { ...segment, html: sanitizeFigureHtml(segment.html) } : segment
  ));
}

interface MarkdownWithFiguresProps {
  content: string;
  components: ComponentProps<typeof ReactMarkdown>['components'];
}

/**
 * Markdown with the generator's chart directives DRAWN rather than printed.
 *
 * The page handed the report's Markdown to `react-markdown` whole, which set
 * every `{{gauge: …}}` and `{{glance: …}}` as body copy — the print routes
 * draw them. `splitMarkdownForViewer` uses the same parser, renderer and
 * tabulation fallback those routes use, so what the page shows is what the
 * document prints; the figure HTML is that renderer's own output over the
 * report's directives, never markup from the record — and it is sanitised
 * here regardless, because injection is where the rule is enforced.
 */
export function MarkdownWithFigures({ content, components }: MarkdownWithFiguresProps) {
  const segments = useMemo(() => sanitizedSegments(content ?? ''), [content]);
  return (
    <div className={FIGURE_STYLES}>
      {segments.map((segment, index) => (
        segment.kind === 'figure'
          ? (
            <div
              key={`figure-${index}`}
              className="report-figure"
              data-directive={segment.directive}
              dangerouslySetInnerHTML={{ __html: segment.html }}
            />
          )
          : (
            <ReactMarkdown key={`markdown-${index}`} remarkPlugins={[remarkGfm]} components={components}>
              {segment.text}
            </ReactMarkdown>
          )
      ))}
    </div>
  );
}

export function InvestmentReportMarkdown({ content, sourcesContent, includeSources = true, processTextWithBadges }: InvestmentReportMarkdownProps) {
  const markdownComponents = createMarkdownComponents(processTextWithBadges);

  return (
    <>
      <MarkdownWithFigures content={content} components={markdownComponents} />
      {includeSources && sourcesContent && (
        <section className="mt-12 rounded-2xl border border-border bg-muted/20 p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-2 border-b border-border/70 pb-3">
            <div className="rounded-full bg-primary/10 p-2 text-primary"><Link className="h-4 w-4" /></div>
            <div>
              <h2 className="m-0 text-lg font-semibold text-foreground">Sources & references</h2>
              <p className="m-0 text-xs text-muted-foreground">Supporting source material included with this report.</p>
            </div>
          </div>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{sourcesContent}</ReactMarkdown>
        </section>
      )}
    </>
  );
}
