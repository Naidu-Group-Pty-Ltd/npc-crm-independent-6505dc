/**
 * AgentViewCards — what Aurixa found, drawn as the thing itself.
 *
 * The prose explains; these are what a person acts on. A client it found is a
 * row that opens the client, a pipeline it read is the pipeline's own figures,
 * a stage breakdown is a set of bars. Every value here came from the tool's
 * own result (see `agentViews.pure.ts`): nothing is estimated, and an absent
 * value leaves its slot empty rather than printing a zero.
 *
 * Links are router links, so a middle-click opens a tab and the back button
 * works. `onOpen` is told after the router has the click, which is how a panel
 * that covers the page (the phone's sheet) gets out of the way.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BellRing, Briefcase, CalendarDays, KeyRound, PhoneCall, UserRound, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAgentHref, type AgentRecordEntity, type AgentView } from '@/lib/agent/protocol';
import { formatWhen } from '@/lib/agent/answerPanel.pure';
import './aurixa.css';

const ENTITY_ICON: Record<AgentRecordEntity, LucideIcon> = {
  client: UserRound,
  deal: Briefcase,
  settlement: KeyRound,
  reminder: BellRing,
  event: CalendarDays,
  call: PhoneCall,
};

interface AgentViewCardsProps {
  views: readonly AgentView[];
  onOpen?: (href: string) => void;
}

function MaybeLink({ href, className, onOpen, children, label }: {
  href?: string;
  className: string;
  onOpen?: (href: string) => void;
  children: ReactNode;
  label?: string;
}) {
  if (href && isAgentHref(href)) {
    return (
      <Link to={href} className={cn(className, 'aurixa-view__link')} onClick={() => onOpen?.(href)} aria-label={label}>
        {children}
      </Link>
    );
  }
  return <div className={className}>{children}</div>;
}

export function AgentViewCards({ views, onOpen }: AgentViewCardsProps) {
  if (!views.length) return null;
  const now = new Date();
  return (
    <div className="aurixa-views mb-2 space-y-2">
      {views.map((view, vi) => (
        <section key={`${vi}-${view.title}`} className="aurixa-view" data-kind={view.kind} aria-label={view.title}>
          <header className="aurixa-view__head flex items-center gap-2 px-3 pt-2.5 pb-1.5">
            {view.kind === 'records' && (() => {
              const Icon = ENTITY_ICON[view.entity];
              return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
            })()}
            <h4 className="min-w-0 flex-1 truncate text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {view.title}
            </h4>
            {view.kind === 'records' && view.total !== undefined && view.total > view.items.length && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {view.items.length} of {view.total}
              </span>
            )}
            {view.href && isAgentHref(view.href) && (
              <Link
                to={view.href}
                onClick={() => onOpen?.(view.href!)}
                className="aurixa-view__all inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium"
              >
                Open <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
          </header>

          {view.kind === 'records' && (
            <ul className="aurixa-view__rows pb-1">
              {view.items.map((item) => {
                const when = formatWhen(item.when, now);
                return (
                  <li key={item.id}>
                    <MaybeLink href={item.href} onOpen={onOpen} className="aurixa-view__row flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-foreground">{item.title}</div>
                        {(item.subtitle || when) && (
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {[item.subtitle, when].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      {(item.meta || item.badge) && (
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {item.meta && <span className="text-[12px] font-medium tabular-nums text-foreground">{item.meta}</span>}
                          {item.badge && (
                            <span className="aurixa-view__badge rounded-full px-1.5 py-px text-[10px] font-medium" data-tone={item.badge.tone}>
                              {item.badge.label}
                            </span>
                          )}
                        </div>
                      )}
                    </MaybeLink>
                  </li>
                );
              })}
            </ul>
          )}

          {view.kind === 'metrics' && (
            <dl className="aurixa-view__metrics grid grid-cols-2 gap-px px-3 pb-3 sm:grid-cols-3">
              {view.items.map((m) => (
                <div key={m.label} className="aurixa-view__metric rounded-lg px-2.5 py-2" data-tone={m.tone ?? 'neutral'}>
                  <dt className="truncate text-[10.5px] text-muted-foreground">{m.label}</dt>
                  <dd className="mt-0.5 truncate text-[17px] font-semibold leading-tight tabular-nums text-foreground">{m.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {view.kind === 'breakdown' && (() => {
            const max = Math.max(...view.items.map((b) => b.value), 0);
            return (
              <ul className="aurixa-view__bars space-y-1.5 px-3 pb-3">
                {view.items.map((bar) => (
                  <li key={bar.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-2 text-[11.5px]">
                    <span className="truncate text-muted-foreground" title={bar.label}>{bar.label}</span>
                    <span className="aurixa-view__track h-1.5 overflow-hidden rounded-full" aria-hidden>
                      <span
                        className="aurixa-view__fill block h-full rounded-full"
                        style={{ width: `${max > 0 ? Math.max(4, Math.round((bar.value / max) * 100)) : 0}%` }}
                      />
                    </span>
                    <span className="tabular-nums font-medium text-foreground">{bar.display}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </section>
      ))}
    </div>
  );
}
