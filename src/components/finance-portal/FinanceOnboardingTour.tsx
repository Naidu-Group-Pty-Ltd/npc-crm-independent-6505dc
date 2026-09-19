/**
 * Batch 13 #67 — Onboarding tour for finance partners.
 * Highlights each sidebar destination on first login. Completion is cached in
 * localStorage and the tour can be replayed via the `finance:start-tour` event.
 *
 * WHEN IT MAY RUN. Only once the partner is actually *in* the portal — the
 * agreement accepted and onboarding complete. It used to auto-start on nothing
 * but "a user exists", 900ms after the layout mounted, while the terms modal
 * that shipped in the same tree was still open; the tour paints at `z-[60]` and
 * the dialog at `z-50`, so the welcome card landed on top of the agreement.
 * Terms and onboarding are their own routes now (`FinancePortalTerms`,
 * `FinancePortalOnboarding`) and this layout does not mount until both are
 * behind the partner, but the condition is asserted here as well: a tour is
 * never the right thing to interrupt a consent wall with, whoever mounts it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowRight, X, Sparkles, CheckCircle2, LayoutDashboard, Briefcase, Layers, Users,
  MessageSquare, Inbox, BookOpen, Trophy,
} from 'lucide-react';

const STORAGE_KEY = 'finance_tour_completed_v1';

interface TourStep {
  selector: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const STEPS: TourStep[] = [
  { selector: '[data-tour="dashboard"]', title: 'Your dashboard', description: 'Today\'s briefing, KPIs, streaks and what changed since you last logged in.', icon: LayoutDashboard },
  { selector: '[data-tour="purchase-files"]', title: 'Active purchase files', description: 'Every live deal room with critical dates, status and risk flags. This is your day.', icon: Briefcase },
  { selector: '[data-tour="pipeline"]', title: 'Pipeline Kanban', description: 'Drag files between stages, spot what\'s stuck, and keep momentum visible.', icon: Layers },
  { selector: '[data-tour="clients"]', title: 'My clients', description: 'Every assigned client with their engagement score and full purchase file history.', icon: Users },
  { selector: '[data-tour="messages"]', title: 'Messages', description: 'Direct portal messaging — clients see everything you share here in real-time.', icon: MessageSquare },
  { selector: '[data-tour="client-inbox"]', title: 'Unified client inbox', description: 'Email, SMS, WhatsApp and portal messages stitched into one timeline per client.', icon: Inbox },
  { selector: '[data-tour="lender-intelligence"]', title: 'Lender intelligence', description: 'Live rates, lender filters and side-by-side comparisons from the Command Centre.', icon: BookOpen },
  { selector: '[data-tour="insights"]', title: 'Pipeline insights', description: 'Lender leaderboard, stuck files and win/loss analytics.', icon: Trophy },
];

function hasCompleted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function markCompleted() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
}

export function resetFinanceTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function FinanceOnboardingTour() {
  const { user } = useFinancePortalAuth();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(-1); // -1 = welcome
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [centered, setCentered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // `has_accepted_current_terms` is absent, not false, against a
  // finance-portal-verify that predates versioned acceptance — the same
  // tolerance the route guard applies.
  const acceptedTerms = user
    ? (typeof user.has_accepted_current_terms === 'boolean'
      ? user.has_accepted_current_terms
      : user.has_accepted_terms)
    : false;
  const throughTheDoor = Boolean(user) && acceptedTerms && Boolean(user?.has_completed_onboarding);

  useEffect(() => {
    if (!throughTheDoor) return;
    if (hasCompleted()) return;
    const t = setTimeout(() => setActive(true), 900);
    return () => clearTimeout(t);
  }, [throughTheDoor]);

  useEffect(() => {
    const onCustom = () => { resetFinanceTour(); setStep(-1); setActive(true); };
    window.addEventListener('finance:start-tour', onCustom);
    return () => window.removeEventListener('finance:start-tour', onCustom);
  }, []);

  const cleanup = useCallback(() => {
    STEPS.forEach(s => {
      const el = document.querySelector(s.selector) as HTMLElement | null;
      if (!el) return;
      el.style.position = ''; el.style.zIndex = ''; el.style.boxShadow = ''; el.style.borderRadius = '';
      const shell = el.closest('aside') as HTMLElement | null;
      if (shell) { shell.style.zIndex = ''; shell.style.position = ''; }
    });
  }, []);

  const position = useCallback((idx: number) => {
    if (idx < 0 || idx >= STEPS.length) return;
    const el = document.querySelector(STEPS[idx].selector) as HTMLElement | null;
    // A destination can be absent (feature-flagged out) or invisible (the
    // sidebar is hidden below md). Either way there is nothing to point at, so
    // the card is centred rather than left at the previous step's coordinates.
    if (!el) { setCentered(true); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { setCentered(true); return; }
    setCentered(false);

    // The sidebar is a glass surface, so `backdrop-filter` gives it its own
    // stacking context and raising the nav item alone would leave the highlight
    // trapped under the overlay. Raise the shell with it.
    const shell = el.closest('aside') as HTMLElement | null;
    if (shell) { shell.style.position = 'relative'; shell.style.zIndex = '60'; }
    el.style.position = 'relative';
    el.style.zIndex = '61';
    el.style.borderRadius = '12px';
    el.style.boxShadow = '0 0 0 4px hsl(var(--primary) / 0.35)';

    setPos({
      top: Math.max(Math.min(r.top - 20, window.innerHeight - 260), 80),
      left: r.right + 20,
    });
  }, []);

  useEffect(() => {
    if (step >= 0) { cleanup(); position(step); }
    return () => cleanup();
  }, [step, position, cleanup]);

  const finish = useCallback(() => {
    cleanup();
    markCompleted();
    setActive(false);
    setStep(-1);
  }, [cleanup]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, finish]);

  if (!active) return null;
  const isWelcome = step === -1;
  const current = step >= 0 ? STEPS[step] : null;
  const Icon = current?.icon;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm dark:bg-black/60" />
      {isWelcome ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Finance portal tour"
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 fade-in duration-300">
            <div className="text-center space-y-5">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-primary" aria-hidden />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Welcome to the Finance Portal</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Two minutes to see what's where. You can replay the tour anytime from Settings → Display.
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Button onClick={() => setStep(0)} size="lg" className="w-full gap-2">
                  Start tour <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
                <Button onClick={finish} variant="ghost" size="sm" className="text-muted-foreground">
                  Skip for now
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : current && Icon ? (
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={`Tour step ${step + 1} of ${STEPS.length}: ${current.title}`}
          className={cn(
            'fixed z-[62] w-[340px] md:w-[380px] animate-in duration-200 fade-in',
            centered ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 zoom-in-95' : 'slide-in-from-left-3',
          )}
          style={centered
            ? { maxWidth: 'calc(100vw - 32px)' }
            : { top: `${pos.top}px`, left: `${pos.left}px`, maxWidth: 'calc(100vw - 32px)' }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-primary/5 px-5 py-4 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10"><Icon className="h-5 w-5 text-primary" aria-hidden /></div>
                <h3 className="font-semibold text-foreground text-base">{current.title}</h3>
              </div>
              <button
                type="button"
                onClick={finish}
                aria-label="Close tour"
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{current.description}</p>
            </div>
            <div className="px-5 py-3 bg-muted/30 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-1.5" aria-hidden>
                {STEPS.map((_, i) => (
                  <div key={i} className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/20'
                  )} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">{step + 1}/{STEPS.length}</span>
                <Button
                  onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}
                  size="sm"
                  className="gap-1.5 h-8"
                >
                  {step === STEPS.length - 1
                    ? <>Finish <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /></>
                    : <>Next <ArrowRight className="h-3.5 w-3.5" aria-hidden /></>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
