import * as React from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * ReportTocRail — Phase 7 primitive.
 *
 * Sticky left table-of-contents for long-form report surfaces. Renders a
 * scrollable glass rail of section anchors with active-section highlighting
 * driven by an IntersectionObserver on the provided section IDs. Consumes
 * only semantic tokens; no hardcoded palette values.
 */
export interface ReportTocRailSection {
  id: string;
  label: React.ReactNode;
  /** Optional depth (0 = top-level, 1 = nested). */
  depth?: 0 | 1;
  /** Optional trailing meta (e.g. page number, chip). */
  meta?: React.ReactNode;
}

export interface ReportTocRailProps extends React.HTMLAttributes<HTMLElement> {
  sections: ReportTocRailSection[];
  /** Scroll offset in px applied when jumping to a section. Default 96. */
  scrollOffset?: number;
  /** Optional heading rendered above the list. */
  heading?: React.ReactNode;
  /** ID currently active. If omitted, the rail observes its own targets. */
  activeId?: string;
}

export const ReportTocRail = React.forwardRef<HTMLElement, ReportTocRailProps>(
  ({ sections, scrollOffset = 96, heading = 'Contents', activeId: controlledActive, className, ...props }, ref) => {
    const [observedActive, setObservedActive] = React.useState<string | null>(null);
    const activeId = controlledActive ?? observedActive ?? sections[0]?.id ?? null;

    React.useEffect(() => {
      if (controlledActive) return;
      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop)[0];
          if (visible) setObservedActive(visible.target.id);
        },
        { rootMargin: `-${scrollOffset}px 0px -55% 0px`, threshold: [0, 0.25, 0.75] }
      );
      sections.forEach((s) => {
        const el = document.getElementById(s.id);
        if (el) observer.observe(el);
      });
      return () => observer.disconnect();
    }, [sections, scrollOffset, controlledActive]);

    const jumpTo = React.useCallback(
      (id: string) => {
        const el = document.getElementById(id);
        if (!el) return;
        const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset;
        window.scrollTo({ top, behavior: 'smooth' });
      },
      [scrollOffset]
    );

    return (
      <nav
        ref={ref}
        aria-label="Report contents"
        className={cn(
          'aurixa-hairline sticky top-24 hidden max-h-[calc(100vh-8rem)] w-64 shrink-0 flex-col rounded-2xl p-3 lg:flex',
          className
        )}
        {...props}
      >
        {heading && (
          <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {heading}
          </div>
        )}
        <ScrollArea className="flex-1 pr-2">
          <ul className="space-y-0.5">
            {sections.map((section) => {
              const active = section.id === activeId;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(section.id)}
                    className={cn(
                      'group relative flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      section.depth === 1 && 'pl-6 text-[13px]',
                      active
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    )}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full transition-colors',
                        active ? 'bg-primary' : 'bg-transparent'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    {section.meta && (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
                        {section.meta}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </nav>
    );
  }
);

ReportTocRail.displayName = 'ReportTocRail';

export default ReportTocRail;
