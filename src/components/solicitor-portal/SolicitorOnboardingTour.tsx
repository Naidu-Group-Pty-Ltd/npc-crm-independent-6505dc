/**
 * Onboarding tour for solicitor portal users — mirrors the Client Portal
 * (`PortalOnboardingTour`) and Finance Portal (`FinanceOnboardingTour`) tours so
 * all three portals introduce themselves the same way.
 *
 * Highlights each sidebar destination on first login. Completion is cached in
 * localStorage; the tour can be replayed from the account menu via the
 * `solicitor:start-tour` event.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Bell, Briefcase, CheckCircle2, KanbanSquare, LayoutDashboard,
  ListChecks, MessageSquare, Settings as SettingsIcon, Sparkles, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSolicitorPortalAuth } from '@/hooks/useSolicitorPortalAuth';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'solicitor_tour_completed_v1';

interface TourStep {
  selector: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="dashboard"]',
    title: 'Your dashboard',
    description: 'Your home base — active matters, settlement runway and anything the referring team has flagged as at risk.',
    icon: LayoutDashboard,
  },
  {
    selector: '[data-tour="matters"]',
    title: 'Matters',
    description: 'Every conveyancing file shared with your practice, with server-side search, status filters and pagination.',
    icon: Briefcase,
  },
  {
    selector: '[data-tour="pipeline"]',
    title: 'Pipeline',
    description: 'A stage-by-stage board of your matters so you can see what is stuck and where momentum is being lost.',
    icon: KanbanSquare,
  },
  {
    selector: '[data-tour="messages"]',
    title: 'Messages',
    description: 'Matter-scoped conversations. You see a thread as soon as you are added as a participant on that file.',
    icon: MessageSquare,
  },
  {
    selector: '[data-tour="tasks"]',
    title: 'Tasks',
    description: 'Shared and legal tasks across your matters — requisitions, searches, disbursements and settlement steps.',
    icon: ListChecks,
  },
  {
    selector: '[data-tour="notifications"]',
    title: 'Notifications',
    description: 'Alerts for critical date changes, new documents, access updates and matter status movement.',
    icon: Bell,
  },
  {
    selector: '[data-tour="settings"]',
    title: 'Settings & security',
    description: 'Manage portal preferences, review the devices signed into your account and revoke any you do not recognise.',
    icon: SettingsIcon,
  },
];

function hasCompleted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

function markCompleted() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* storage unavailable */ }
}

function resetSolicitorTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

export function SolicitorOnboardingTour() {
  const { user } = useSolicitorPortalAuth();
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(-1); // -1 = welcome
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [centered, setCentered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    if (hasCompleted()) return;
    const timer = setTimeout(() => setActive(true), 900);
    return () => clearTimeout(timer);
  }, [user]);

  useEffect(() => {
    const onReplay = () => { resetSolicitorTour(); setStep(-1); setActive(true); };
    window.addEventListener('solicitor:start-tour', onReplay);
    return () => window.removeEventListener('solicitor:start-tour', onReplay);
  }, []);

  const cleanup = useCallback(() => {
    STEPS.forEach((s) => {
      const el = document.querySelector(s.selector) as HTMLElement | null;
      if (!el) return;
      el.style.position = ''; el.style.zIndex = ''; el.style.boxShadow = ''; el.style.borderRadius = '';
      // The sidebar owns a stacking context (backdrop-filter), so raising the nav
      // item alone would leave the highlight trapped underneath the overlay.
      const shell = el.closest('aside') as HTMLElement | null;
      if (shell) { shell.style.zIndex = ''; shell.style.position = ''; }
    });
  }, []);

  const position = useCallback((index: number) => {
    if (index < 0 || index >= STEPS.length) return;
    const el = document.querySelector(STEPS[index].selector) as HTMLElement | null;
    if (!el) { setCentered(true); return; }
    const rect = el.getBoundingClientRect();
    // Sidebar is hidden below md — nothing to point at, so centre the card.
    if (rect.width === 0 || rect.height === 0) { setCentered(true); return; }
    setCentered(false);

    const shell = el.closest('aside') as HTMLElement | null;
    if (shell) { shell.style.position = 'relative'; shell.style.zIndex = '60'; }
    el.style.position = 'relative';
    el.style.zIndex = '61';
    el.style.borderRadius = '12px';
    el.style.boxShadow = '0 0 0 4px hsl(var(--primary) / 0.35)';

    setPos({
      top: Math.max(Math.min(rect.top - 20, window.innerHeight - 260), 80),
      left: rect.right + 20,
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Solicitor portal tour">
          <div className="w-full max-w-md animate-in rounded-2xl border border-border bg-card p-8 shadow-2xl duration-300 fade-in zoom-in-95">
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-8 w-8 text-primary" aria-hidden />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Welcome to the Solicitor Portal</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  A quick tour of where everything lives. It takes about a minute, and you can replay it anytime from your account menu.
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
            'fixed z-[62] w-[340px] animate-in duration-200 fade-in md:w-[380px]',
            centered ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 zoom-in-95' : 'slide-in-from-left-3',
          )}
          style={centered ? { maxWidth: 'calc(100vw - 32px)' } : { top: `${pos.top}px`, left: `${pos.left}px`, maxWidth: 'calc(100vw - 32px)' }}
        >
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border bg-primary/5 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-primary/10 p-2"><Icon className="h-5 w-5 text-primary" aria-hidden /></div>
                <h3 className="text-base font-semibold text-foreground">{current.title}</h3>
              </div>
              <button
                type="button"
                onClick={finish}
                aria-label="Close tour"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{current.description}</p>
            </div>

            <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
              <div className="flex items-center gap-1.5" aria-hidden>
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-muted-foreground/20',
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">{step + 1}/{STEPS.length}</span>
                <Button
                  onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}
                  size="sm"
                  className="h-8 gap-1.5"
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
