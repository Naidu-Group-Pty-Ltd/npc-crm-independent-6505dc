import { useState, useEffect, useCallback, useRef } from 'react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { Button } from '@/components/ui/button';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';
import { cn } from '@/lib/utils';
import {
  Home, User, TrendingUp, Building2, BarChart3,
  Briefcase, FileText, MessageSquare, Bell, CalendarDays,
  ArrowRight, X, Sparkles, CheckCircle2
} from 'lucide-react';

interface TourStep {
  targetSelector: string;
  title: string;
  description: string;
  icon: React.ElementType;
  position: 'right' | 'center';
}

const TOUR_STEPS: TourStep[] = [
  {
    targetSelector: '[data-tour="dashboard"]',
    title: 'Your Dashboard',
    description: 'This is your home base. Get a quick overview of your property portfolio, active deals, financial snapshot, and quick links to every section.',
    icon: Home,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="profile"]',
    title: 'My Profile',
    description: 'View and update your personal details including contact information, identification, and communication preferences.',
    icon: User,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="deal-progress"]',
    title: 'Deal Progress',
    description: 'Track the progress of your property deals through each stage — from initial consultation all the way through to settlement.',
    icon: TrendingUp,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="properties"]',
    title: 'Properties',
    description: 'View your entire property portfolio in one place. See property details, values, rental income, and key metrics.',
    icon: Building2,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="property-insights"]',
    title: 'Property Insights',
    description: 'Access real-time analytics on your properties — including equity position, loan-to-value ratios, and rental yield performance.',
    icon: BarChart3,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="finances"]',
    title: 'Finances',
    description: 'Manage your employment details, income sources, and financial information used for loan assessments and borrowing capacity.',
    icon: Briefcase,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="documents"]',
    title: 'Documents',
    description: 'Upload, access, and manage all your important documents — from identification to contracts and financial statements.',
    icon: FileText,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="reports"]',
    title: 'Reports',
    description: `View investment reports, ${PORTFOLIO_REPORT_LABEL} reports, and other documents published by your advisor. Request new reports when needed.`,
    icon: FileText,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="messages"]',
    title: 'Messages',
    description: 'Communicate directly with your advisor. Send messages, ask questions, and receive updates — all in one secure place.',
    icon: MessageSquare,
    position: 'right',
  },
  {
    targetSelector: '[data-tour="notifications"]',
    title: 'Notifications & Appointments',
    description: 'Stay informed with activity alerts and manage your upcoming appointments. Book new consultations when you need them.',
    icon: Bell,
    position: 'right',
  },
];

// "Desktop" means a real desktop input, not just a desktop width. Every tour
// target lives inside the desktop sidebar (`hidden md:flex`), so below `md`
// there is nothing to highlight and the tour's full-screen fixed overlay
// would sit over the whole portal silently swallowing every touch and tap.
// Width alone is not enough to prove desktop: Android's desktop-site mode,
// folds/tablets and display scaling can all report >= 768px while the only
// input is a finger — so the gate also demands a pointer that can hover and
// point precisely. The tour must never mount on a touch-only device.
const DESKTOP_MEDIA_QUERY =
  '(min-width: 768px) and (hover: hover) and (pointer: fine)';

export function PortalOnboardingTour() {
  const { user, completeOnboarding } = usePortalAuth();
  const [currentStep, setCurrentStep] = useState(-1); // -1 = welcome screen
  const [isActive, setIsActive] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  );
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (user && !user.has_completed_onboarding && isDesktop) {
      // Small delay so the layout renders first
      const timer = setTimeout(() => setIsActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, [user, isDesktop]);

  const positionTooltip = useCallback((stepIndex: number) => {
    if (stepIndex < 0 || stepIndex >= TOUR_STEPS.length) return;
    const step = TOUR_STEPS[stepIndex];
    const target = document.querySelector(step.targetSelector);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    // Highlight the target
    (target as HTMLElement).style.position = 'relative';
    (target as HTMLElement).style.zIndex = '60';
    (target as HTMLElement).style.borderRadius = '12px';
    (target as HTMLElement).style.boxShadow = '0 0 0 4px hsl(var(--primary) / 0.3)';

    // Position the tooltip to the right of the sidebar target; the tour only
    // runs at `md` and above, where that sidebar is visible.
    setTooltipPosition({
      top: Math.max(rect.top - 20, 80),
      left: rect.right + 20,
    });
  }, []);

  const cleanupHighlight = useCallback(() => {
    TOUR_STEPS.forEach(step => {
      const el = document.querySelector(step.targetSelector) as HTMLElement;
      if (el) {
        el.style.position = '';
        el.style.zIndex = '';
        el.style.borderRadius = '';
        el.style.boxShadow = '';
      }
    });
  }, []);

  // If the viewport leaves `md` while the tour is showing (rotation, split
  // screen, a resized window), tear the tour down completely: no fixed
  // overlay may remain over a viewport whose sidebar targets are hidden.
  // Onboarding is not marked complete — the tour re-offers itself when the
  // viewport is wide enough again.
  useEffect(() => {
    if (!isDesktop && isActive) {
      cleanupHighlight();
      setIsActive(false);
      setCurrentStep(-1);
    }
  }, [isDesktop, isActive, cleanupHighlight]);

  useEffect(() => {
    if (currentStep >= 0) {
      cleanupHighlight();
      positionTooltip(currentStep);
    }
    return () => cleanupHighlight();
  }, [currentStep, positionTooltip, cleanupHighlight]);

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handleSkip = () => {
    handleFinish();
  };

  const handleFinish = async () => {
    cleanupHighlight();
    setIsActive(false);
    setCurrentStep(-1);
    await completeOnboarding();
  };

  const handleStart = () => {
    setCurrentStep(0);
  };

  // Never render below `md`: the render guard (not just the activation timer)
  // is what guarantees no full-screen interaction layer can exist on mobile.
  if (!isActive || !isDesktop) return null;

  const isWelcome = currentStep === -1;
  const step = currentStep >= 0 ? TOUR_STEPS[currentStep] : null;
  const StepIcon = step?.icon;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 bg-background dark:bg-black/50 backdrop-blur-sm transition-opacity duration-300" />

      {isWelcome ? (
        /* Welcome Screen */
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 fade-in duration-300">
            <div className="text-center space-y-5">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">Welcome to Your Portal</h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  Let's take a quick tour to help you get familiar with all the features available to you. It only takes a minute.
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-2">
                <Button onClick={handleStart} size="lg" className="w-full gap-2">
                  Start Tour <ArrowRight className="h-4 w-4" />
                </Button>
                <Button onClick={handleSkip} variant="ghost" size="sm" className="text-muted-foreground">
                  Skip for now
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : step && StepIcon ? (
        /* Tour Step Tooltip */
        <div
          ref={tooltipRef}
          className="fixed z-[60] w-[340px] md:w-[380px] animate-in fade-in slide-in-from-left-3 duration-200"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-primary/5 px-5 py-4 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <StepIcon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground text-base">{step.title}</h3>
              </div>
              <button
                onClick={handleSkip}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-muted/30 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {TOUR_STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      i === currentStep
                        ? 'w-6 bg-primary'
                        : i < currentStep
                          ? 'w-1.5 bg-primary/40'
                          : 'w-1.5 bg-muted-foreground/20'
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">
                  {currentStep + 1}/{TOUR_STEPS.length}
                </span>
                <Button
                  onClick={handleNext}
                  size="sm"
                  className="gap-1.5 h-8"
                >
                  {currentStep === TOUR_STEPS.length - 1 ? (
                    <>Finish <CheckCircle2 className="h-3.5 w-3.5" /></>
                  ) : (
                    <>Next <ArrowRight className="h-3.5 w-3.5" /></>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
