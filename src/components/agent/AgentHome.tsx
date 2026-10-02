/**
 * AgentHome — what Aurixa says before you have said anything.
 *
 * The old empty state was a logo, "How can I help?" and sixteen chips. A
 * colleague would greet you by name, tell you what needs attention today and
 * offer to pick something up, so that is the order here: the presence and a
 * greeting, today's pulse (the same counts the notification bell has always
 * read, each one a tap away from the question it answers), four ways to
 * start, a voice conversation, a question about the screen behind the panel,
 * and the conversations already under way.
 *
 * Every prompt sent from here is one of the original starter strings, word
 * for word, so what the agent receives is exactly what it received before.
 */
import { useState } from 'react';
import {
  AudioLines, CalendarDays, ChevronDown, ChevronRight, LayoutDashboard, MapPin, ScanSearch, Sunrise,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AurixaPresence } from './presence/AurixaPresence';
import type { Presence } from '@/lib/agent/presence.pure';
import { STARTER_PROMPTS } from '@/lib/agent/starterPrompts';


interface QuickStart {
  prompt: (typeof STARTER_PROMPTS)[number];
  title: string;
  caption: string;
  icon: LucideIcon;
}

const QUICK_STARTS: QuickStart[] = [
  { prompt: '☀️ Morning briefing', title: 'Morning briefing', caption: 'What matters today', icon: Sunrise },
  { prompt: '📊 Pipeline overview', title: 'Pipeline overview', caption: 'Where every deal stands', icon: LayoutDashboard },
  { prompt: '📅 Upcoming appointments', title: 'Upcoming appointments', caption: 'Your next few days', icon: CalendarDays },
  { prompt: '🔍 Proactive insights scan', title: 'Insights scan', caption: 'Risks and openings', icon: ScanSearch },
];

interface PulseItem {
  key: string;
  count: number;
  one: string;
  many: string;
  action: string;
  tone: 'urgent' | 'warn' | 'info';
}

function pulseFrom(n: Record<string, unknown> | null): PulseItem[] {
  if (!n) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // The same counts and the same prompts the notification panel uses.
  return [
    { key: 'overdue', count: num(n.overdue_reminders), one: 'overdue reminder', many: 'overdue reminders', action: '⏰ Overdue reminders', tone: 'urgent' as const },
    { key: 'urgent', count: num(n.urgent_deals), one: 'urgent deal', many: 'urgent deals', action: '🚨 Show urgent deals', tone: 'warn' as const },
    { key: 'settle', count: num(n.upcoming_settlements), one: 'settlement this week', many: 'settlements this week', action: '🏠 Upcoming settlements', tone: 'info' as const },
    { key: 'calls', count: num(n.unread_call_alerts), one: 'unread call alert', many: 'unread call alerts', action: '📞 Unread call alerts', tone: 'info' as const },
    { key: 'clawback', count: num(n.clawback_risk_deals), one: 'clawback risk', many: 'clawback risks', action: '⚠️ Clawback risk deals', tone: 'warn' as const },
  ].filter((p) => p.count > 0);
}

export interface HomeConversation {
  id: string;
  title: string;
  updated_at: string;
}

interface AgentHomeProps {
  greeting: string;
  presence: Presence;
  notifications: Record<string, unknown> | null;
  recent: HomeConversation[];
  pageLabel: string | null;
  voiceAvailable: boolean;
  onPrompt: (prompt: string) => void;
  onTalk: () => void;
  onAskAboutPage: () => void;
  onOpenConversation: (id: string) => void;
  onShowAll: () => void;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export function AgentHome({
  greeting, presence, notifications, recent, pageLabel, voiceAvailable,
  onPrompt, onTalk, onAskAboutPage, onOpenConversation, onShowAll,
}: AgentHomeProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const pulse = pulseFrom(notifications);
  const quick = new Set<string>(QUICK_STARTS.map((q) => q.prompt));
  const more = STARTER_PROMPTS.filter((p) => !quick.has(p));

  return (
    <div className="aurixa-home mx-auto flex w-full max-w-[34rem] flex-col px-4 pb-6 pt-6">
      <div className="flex flex-col items-center text-center animate-aurixa-rise">
        <AurixaPresence mood={presence.mood} size={84} />
        <h2 className="mt-4 font-heading text-[1.35rem] font-medium tracking-tight text-foreground">{greeting}</h2>
        <p className="mt-1 max-w-[19rem] text-[13px] leading-relaxed text-muted-foreground">
          I can look things up across your clients and deals, draft and send for you, and keep an eye on what’s due.
        </p>
      </div>

      {/* Today's pulse */}
      <section className="mt-5" aria-label="Today">
        <p className="aurixa-eyebrow">Today</p>
        {!notifications ? (
          <div className="mt-2 flex gap-1.5" aria-hidden>
            <span className="aurixa-skeleton h-7 w-36 rounded-full" />
            <span className="aurixa-skeleton h-7 w-28 rounded-full" />
          </div>
        ) : pulse.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">Nothing urgent. A good day to get ahead.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pulse.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onPrompt(p.action)}
                className="aurixa-pulse-chip"
                data-tone={p.tone}
              >
                <span className="aurixa-pulse-chip__count tabular-nums">{p.count}</span>
                {p.count === 1 ? p.one : p.many}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Ways to start */}
      <section className="mt-5" aria-label="Start with">
        <p className="aurixa-eyebrow">Start with</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {QUICK_STARTS.map((q) => (
            <button key={q.prompt} type="button" onClick={() => onPrompt(q.prompt)} className="aurixa-tile group">
              <q.icon className="aurixa-tile__icon h-4 w-4" aria-hidden />
              <span className="mt-2 block text-[13px] font-medium leading-tight text-foreground">{q.title}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{q.caption}</span>
            </button>
          ))}
        </div>

        <div className={cn('mt-2 grid gap-2', voiceAvailable ? 'grid-cols-2' : 'grid-cols-1')}>
          {voiceAvailable && (
            <button type="button" onClick={onTalk} className="aurixa-tile aurixa-tile--accent flex items-center gap-2.5">
              <AudioLines className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-left">
                <span className="block text-[13px] font-medium leading-tight">Talk it through</span>
                <span className="block text-[11.5px] leading-snug opacity-80">Hands-free, out loud</span>
              </span>
            </button>
          )}
          <button type="button" onClick={onAskAboutPage} className="aurixa-tile flex items-center gap-2.5">
            <MapPin className="aurixa-tile__icon h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 text-left">
              <span className="block text-[13px] font-medium leading-tight text-foreground">Ask about this page</span>
              <span className="block truncate text-[11.5px] leading-snug text-muted-foreground">{pageLabel ?? 'The screen behind me'}</span>
            </span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={moreOpen}
        >
          More ideas
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', moreOpen && 'rotate-180')} aria-hidden />
        </button>
        {moreOpen && (
          <div className="mt-2 flex flex-wrap gap-1.5 animate-aurixa-unfold">
            {more.map((prompt) => (
              <button key={prompt} type="button" onClick={() => onPrompt(prompt)} className="aurixa-idea-chip">
                {prompt}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Conversations under way */}
      {recent.length > 0 && (
        <section className="mt-6" aria-label="Recent conversations">
          <div className="flex items-center justify-between">
            <p className="aurixa-eyebrow">Pick up where you left off</p>
            <button type="button" onClick={onShowAll} className="text-[12px] font-medium text-muted-foreground hover:text-foreground">
              All
            </button>
          </div>
          <ul className="mt-1.5 divide-y divide-[hsl(var(--aurixa-glass-border)/0.45)]">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(c.id)}
                  className="group flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground group-hover:text-brand">{c.title || 'Untitled conversation'}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeAgo(c.updated_at)}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
