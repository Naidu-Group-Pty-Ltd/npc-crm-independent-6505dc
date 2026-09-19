import { useCallback, useEffect, useMemo, useState } from 'react';
import { LiveModelBadge, ModelUpgradeButton } from '@/components/agentModels';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Search,
  Filter,
  Download,
  Eye,
  AlertCircle,
  CheckCircle,
  Target,
  Settings,
  Bot,
  Headphones,
  FolderOpen,
  Sparkles,
  X,
  BookOpen,
  Lock,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openDocumentation } from '@/lib/missionControl';
import { UserGuideAssistant } from '@/components/user-guide/UserGuideAssistant';
import {
  GUIDE_SECTIONS,
  NEED_HELP_ITEMS,
  PROPERTY_STATUS_GUIDE,
  QUICK_TIPS,
  STANDALONE_GUIDE_CARD_IDS,
} from '@/lib/userGuideContent';
import { filterEntitledSections, lockedSections } from '@/lib/userGuideEntitlements';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * The guide's content lives in `lib/userGuideContent.ts` as data — one source
 * feeding this page, the AI assistant and the exported support knowledge base
 * (`npm run support:kb`). Content names icons as strings; mapping them back to
 * components is presentation, so it stays here in the UI.
 */
const QUICK_TIP_ICONS: Record<string, React.ElementType> = {
  Search,
  Filter,
  Download,
  Eye,
  Target,
  Bot,
};

const NEED_HELP_ICONS: Record<string, React.ElementType> = {
  Settings,
  Bot,
  AlertCircle,
  Headphones,
};

/** Status-dot colour for each entry of PROPERTY_STATUS_GUIDE. */
const STATUS_DOT_CLASSES: Record<string, string> = {
  Active: 'bg-success',
  Pending: 'bg-brand-500',
  Sold: 'bg-info',
  Withdrawn: 'bg-muted',
  Expired: 'bg-destructive',
};

/** Card styling for the Need Help entries, by position. */
const NEED_HELP_CARD_CLASSES = [
  'border-brand-400/25 bg-brand-500/8 text-brand-600 dark:text-brand-300',
  'border-primary/25 bg-primary/10 text-primary',
  'border-destructive/25 bg-destructive/8 text-destructive dark:text-destructive',
  'border-brand-400/25 bg-brand-500/8 text-brand-600 dark:text-brand-300',
];
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

export default function UserGuide() {
  const { planSlug, addonSlugs, loading: planLoading } = usePlanEntitlements();
  const { isSuperadmin } = usePermissions();
  // Controlled accordion state: quick navigation must be able to open a
  // section, and only real state can do that — clicking DOM nodes cannot.
  const [openSections, setOpenSections] = useState<string[]>([]);

  const handleNavigateToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (!element) return;
    setOpenSections((prev) => (prev.includes(sectionId) ? prev : [...prev, sectionId]));
    // Scroll on the next frame so the newly opened section participates in
    // layout; scroll-mt on the target keeps it clear of the sticky topbar.
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Deep links: /user-guide#section-<id> scrolls to that section and opens its
  // accordion; a standalone card id (#quick-tips, #need-help, …) scrolls that
  // card into view. Applied once shortly after mount — the accordion has to be
  // in the DOM before it can be opened — and again on every hashchange.
  useEffect(() => {
    const applyLocationHash = () => {
      let hash = window.location.hash.replace(/^#/, '');
      try {
        hash = decodeURIComponent(hash);
      } catch {
        // A malformed escape is not a deep link; keep the raw value.
      }
      if (!hash) return;
      if (hash.startsWith('section-')) {
        // handleNavigateToSection no-ops when the id is not rendered, which is
        // right for a stale link to a section this plan does not show.
        handleNavigateToSection(hash.slice('section-'.length));
        return;
      }
      if ((STANDALONE_GUIDE_CARD_IDS as readonly string[]).includes(hash)) {
        document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    const initial = window.setTimeout(applyLocationHash, 100);
    window.addEventListener('hashchange', applyLocationHash);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener('hashchange', applyLocationHash);
    };
  }, [handleNavigateToSection]);

  const allSections = GUIDE_SECTIONS;

  // Only the sections this workspace is entitled to. A Launch clone must not
  // be reading the Finance Portal guide: following a walkthrough for a screen
  // that is not in the sidebar reads as a broken product, not a locked one.
  //
  // An unknown or still-loading plan shows everything — the same asymmetry
  // planEntitlements.ts takes. Showing a section someone cannot use is an
  // annoyance; hiding one they pay for is a fault.
  //
  // A superadministrator reads the whole guide. They reach every available
  // module through the operator override, so a locked walkthrough for a page
  // they can open is the same "broken product" impression pointed the wrong
  // way.
  const entitlementCtx = {
    planSlug: planLoading ? null : planSlug,
    addonSlugs,
    isPlatformOperator: isSuperadmin,
  };
  const sections = useMemo(
    () => filterEntitledSections(allSections, entitlementCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSlug, addonSlugs, planLoading, isSuperadmin],
  );
  const locked = useMemo(
    () => lockedSections(allSections, entitlementCtx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planSlug, addonSlugs, planLoading, isSuperadmin],
  );

  const quickTips = QUICK_TIPS.map((tip) => ({
    icon: QUICK_TIP_ICONS[tip.icon] ?? Sparkles,
    text: tip.text,
  }));

  const statusGuide = PROPERTY_STATUS_GUIDE.map((item) => ({
    ...item,
    color: STATUS_DOT_CLASSES[item.status] ?? 'bg-muted',
  }));

  const quickTipCardClasses = [
    'border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--card)/0.92))] shadow-primary/5',
    'border-brand-400/25 bg-[linear-gradient(135deg,rgba(245,158,11,0.12),hsl(var(--card)/0.92))] shadow-brand-500/5',
    'border-info/25 bg-[linear-gradient(135deg,rgba(59,130,246,0.10),hsl(var(--card)/0.92))] shadow-info/5',
    'border-success/25 bg-[linear-gradient(135deg,rgba(16,185,129,0.10),hsl(var(--card)/0.92))] shadow-success/5',
    'border-accent/25 bg-[linear-gradient(135deg,rgba(168,85,247,0.10),hsl(var(--card)/0.92))] shadow-accent/5',
    'border-info/25 bg-[linear-gradient(135deg,rgba(6,182,212,0.10),hsl(var(--card)/0.92))] shadow-info/5',
  ];

  const statusGuideStyles = {
    Active: {
      card: 'border-success/25 bg-success/8 shadow-success/5',
      badge: 'border-success/35 bg-success/10 text-success dark:text-success',
      ring: 'ring-success/20',
    },
    Pending: {
      card: 'border-brand-400/30 bg-brand-500/10 shadow-brand-500/5',
      badge: 'border-brand-500/40 bg-brand-500/12 text-brand-700 dark:text-brand-300',
      ring: 'ring-brand-500/25',
    },
    Sold: {
      card: 'border-info/25 bg-info/8 shadow-info/5',
      badge: 'border-info/35 bg-info/10 text-info dark:text-info',
      ring: 'ring-info/20',
    },
    Withdrawn: {
      card: 'border-muted-foreground/20 bg-muted/30 shadow-black/0',
      badge: 'border-muted-foreground/25 bg-muted/45 text-muted-foreground',
      ring: 'ring-muted-foreground/15',
    },
    Expired: {
      card: 'border-destructive/25 bg-destructive/8 shadow-destructive/5',
      badge: 'border-destructive/35 bg-destructive/10 text-destructive dark:text-destructive',
      ring: 'ring-destructive/20',
    },
  } as const;

  const [documentationSearch, setDocumentationSearch] = useState('');

  const normalizedDocumentationSearch = documentationSearch.trim().toLowerCase();

  const documentationSearchResults = useMemo(() => {
    if (!normalizedDocumentationSearch) {
      return [];
    }

    return sections.filter((section) => {
      const searchableText = [
        section.title,
        section.description,
        ...section.items.flatMap((item) => [
          item.title,
          item.description,
          ...(item.features ?? []),
          ...(item.steps ?? []),
          ...(item.tips ?? []),
          ...(item.shortcuts?.flatMap((shortcut) => [shortcut.description, ...shortcut.keys]) ?? []),
        ]),
      ]
        .join(' ')
        .toLowerCase();

      return searchableText.includes(normalizedDocumentationSearch);
    });
  }, [normalizedDocumentationSearch, sections]);

  const quickNavigationItems = [
    { label: 'Quick Tips', targetId: 'quick-tips' },
    { label: 'Property Status Guide', targetId: 'property-status-guide' },
    { label: 'Feature Documentation', targetId: 'feature-documentation' },
    { label: 'Getting Started', sectionId: 'getting-started' },
    { label: 'Client Management', sectionId: 'client-management' },
    { label: 'Aurixa Intelligence Hub', sectionId: 'report-qa' },
    { label: 'Settings', sectionId: 'settings' },
    { label: 'Need Help', targetId: 'need-help' },
    { label: 'Troubleshooting', sectionId: 'troubleshooting' },
    { label: 'Monitoring & Logs', sectionId: 'monitoring' },
    { label: 'Keyboard Shortcuts', sectionId: 'keyboard-shortcuts' },
    { label: 'API Usage & Costs', sectionId: 'api-usage' },
    { label: 'Notifications', sectionId: 'notifications' },
  ];

  const needHelpItems = NEED_HELP_ITEMS.map((item, index) => ({
    icon: NEED_HELP_ICONS[item.icon] ?? Headphones,
    text: item.text,
    className: NEED_HELP_CARD_CLASSES[index % NEED_HELP_CARD_CLASSES.length],
  }));

  const handleQuickNavigation = useCallback((item: { targetId?: string; sectionId?: string }) => {
    if (item.sectionId) {
      handleNavigateToSection(item.sectionId);
      return;
    }

    if (item.targetId) {
      document.getElementById(item.targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [handleNavigateToSection]);

  return (
    <>
    <UserGuideAssistant onNavigateToSection={handleNavigateToSection} />
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="min-h-0 space-y-6 overflow-x-hidden rounded-[2rem] border border-border/50 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(180deg,hsl(var(--background)/0.96),hsl(var(--card)/0.76)_48%,hsl(var(--background)/0.98))] p-3 pb-8 text-foreground shadow-[0_28px_90px_rgba(15,23,42,0.10)] selection:bg-primary/20 selection:text-foreground [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_32%),linear-gradient(180deg,hsl(0_0%_2%),hsl(0_0%_6%)_50%,hsl(0_0%_3%))] dark:shadow-black/35 sm:space-y-7 sm:p-5 lg:p-6"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88)_52%,hsl(var(--muted)/0.42))] shadow-[0_22px_70px_rgba(15,23,42,0.10)] dark:shadow-black/30"
      >
        <div className="relative z-10 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-inner shadow-primary/10 sm:h-14 sm:w-14">
              <FolderOpen className="h-6 w-6 sm:h-7 sm:w-7" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="min-w-0 space-y-2">
                <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">User Guide</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Complete guide to navigating and using your dashboard
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <LiveModelBadge agentKey="user_guide_assistant" size="sm" showSlot />
                  <ModelUpgradeButton agentKey="user_guide_assistant" />
                </div>
              </div>

            </div>
          </div>
        </div>
      </DashboardThemeFrame>

      <DashboardThemeFrame
        as="section"
        variant="toolbar"
        role="navigation"
        aria-label="User Guide quick navigation"
        className="min-h-0 gap-2 overflow-x-auto overscroll-x-contain border-primary/15 bg-card/70 p-2 shadow-[0_12px_34px_rgba(15,23,42,0.06)] [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:bg-background/55"
      >
        {quickNavigationItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleQuickNavigation(item)}
            className="min-h-10 min-w-max rounded-full border border-border/70 bg-background/85 px-3.5 py-2 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-foreground hover:shadow-[0_10px_28px_hsl(var(--primary)/0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-background/55"
          >
            {item.label}
          </button>
        ))}
      </DashboardThemeFrame>

      {/* Quick Tips */}
      <Card id="quick-tips" className="min-w-0 scroll-mt-24 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--muted)/0.18))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner shadow-primary/10">
              <CheckCircle className="h-5 w-5 text-primary" />
            </span>
            <span className="min-w-0">Quick Tips</span>
          </CardTitle>
          <CardDescription className="leading-6">
            Essential tips to get the most out of your dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {quickTips.map((tip, index) => (
              <div
                key={index}
                className={`group relative min-w-0 overflow-hidden rounded-2xl border p-4 shadow-lg transition-all duration-300 before:absolute before:inset-y-4 before:left-0 before:w-1 before:rounded-r-full before:bg-primary/65 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_20px_48px_rgba(15,23,42,0.12),0_0_0_1px_hsl(var(--primary)/0.10)] dark:hover:shadow-black/35 ${quickTipCardClasses[index]}`}
              >
                <div className="relative z-10 flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-background/85 text-primary shadow-sm shadow-primary/5 transition-transform duration-300 group-hover:scale-105 dark:bg-background/55">
                    <tip.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 space-y-2">
                    <span className="block min-w-0 text-sm font-medium leading-6 text-foreground/95">{tip.text}</span>
                    {index === 0 && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <kbd className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground shadow-sm">⌘/Ctrl</kbd>
                        <span>+</span>
                        <kbd className="rounded-md border border-border bg-background px-2 py-1 font-semibold text-foreground shadow-sm">K</kbd>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Property Status Guide */}
      <Card id="property-status-guide" className="min-w-0 scroll-mt-24 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.06),hsl(var(--muted)/0.16))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-info/20 bg-info/10 shadow-inner shadow-info/10">
              <AlertCircle className="h-5 w-5 text-info" />
            </span>
            <span className="min-w-0">Property Status Guide</span>
          </CardTitle>
          <CardDescription className="leading-6">
            Understanding property status indicators throughout the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {statusGuide.map((item, index) => {
              const style = statusGuideStyles[item.status as keyof typeof statusGuideStyles];

              return (
                <div
                  key={index}
                  aria-label={`${item.status}: ${item.description}`}
                  className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_44px_rgba(15,23,42,0.10),0_0_0_1px_hsl(var(--primary)/0.08)] dark:hover:shadow-black/30 ${style.card}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-2xl bg-background/75 ring-4 dark:bg-background/50 ${style.ring}`}>
                      <span className={`h-3.5 w-3.5 rounded-full shadow-sm ${item.color}`} />
                    </span>
                    <Badge variant="outline" className={`min-w-0 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${style.badge}`}>
                      {item.status}
                    </Badge>
                  </div>
                  <span className="min-w-0 text-sm leading-6 text-muted-foreground">{item.description}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Sections with Accordion */}
      <Card id="feature-documentation" className="min-w-0 scroll-mt-24 overflow-hidden rounded-[1.5rem] border-primary/15 bg-card/95 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-4 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--muted)/0.16))]">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <CardTitle className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-inner shadow-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </span>
                <span className="min-w-0">Feature Documentation</span>
              </CardTitle>
              <CardDescription className="leading-6">
                Click on any section to expand and view detailed documentation
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-primary shadow-sm shadow-primary/10">
              {sections.length} sections
            </Badge>
          </div>

          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">Search feature documentation</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search feature documentation"
                value={documentationSearch}
                onChange={(event) => setDocumentationSearch(event.target.value)}
                placeholder="Search feature documentation"
                className="h-11 w-full min-w-0 rounded-2xl border border-border/75 bg-background/90 pl-10 pr-10 text-sm text-foreground shadow-inner outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-primary/25 dark:bg-background/60"
              />
              {documentationSearch && (
                <button
                  type="button"
                  onClick={() => setDocumentationSearch('')}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                  aria-label="Clear feature documentation search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-background/60 px-3 py-2 text-xs text-muted-foreground dark:bg-background/40">
              <span>Full documentation list stays visible while search shows jump results.</span>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => openDocumentation()}
              >
                <BookOpen className="h-4 w-4" />
                Read full documentation
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </Button>
            </div>
          </div>

          {normalizedDocumentationSearch && (
            <div className="rounded-2xl border border-border/60 bg-background/60 p-3 dark:bg-background/45">
              {documentationSearchResults.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Matching sections
                  </div>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {documentationSearchResults.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => handleNavigateToSection(section.id)}
                        className="min-h-9 max-w-full rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-brand-500/25 bg-brand-500/10 text-brand-600 dark:text-brand-300">
                      <Search className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                      No documentation sections match “{documentationSearch}”.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDocumentationSearch('')}
                    className="min-h-9 w-fit rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
                  >
                    Clear search
                  </button>
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="min-h-0 bg-muted/10 p-3 sm:p-4">
          {sections.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/70 p-6 text-center shadow-sm dark:bg-background/40">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm leading-6 text-muted-foreground">No documentation sections are available.</p>
            </div>
          ) : (
          <Accordion
            type="multiple"
            value={openSections}
            onValueChange={setOpenSections}
            className="grid min-w-0 w-full gap-3"
          >
            {sections.map((section) => (
              <AccordionItem id={`section-${section.id}`} key={section.id} value={section.id} className="group/section scroll-mt-24 overflow-hidden rounded-2xl border border-border/65 bg-card/90 px-0 shadow-sm transition-all duration-200 hover:border-primary/25 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)] data-[state=open]:border-primary/35 data-[state=open]:shadow-[0_18px_48px_rgba(15,23,42,0.10),0_0_0_1px_hsl(var(--primary)/0.08)] dark:bg-background/60 dark:hover:shadow-black/20 dark:data-[state=open]:shadow-black/30">
                <AccordionTrigger className="min-w-0 px-4 py-4 text-left transition-colors hover:bg-primary/5 hover:no-underline focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-primary/10 sm:min-h-16 sm:px-5 [&>svg]:ml-3 [&>svg]:flex-shrink-0 [&>svg]:text-primary [&>svg]:transition-transform [&>svg]:duration-200">
                  <div className="flex min-w-0 items-center gap-3 pr-2">
                    <div className="flex-shrink-0 rounded-xl border border-primary/15 bg-primary/10 p-2 transition-colors group-data-[state=open]/section:border-primary/30 group-data-[state=open]/section:bg-primary/15">
                      <section.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="break-words font-semibold text-foreground">{section.title}</div>
                      <div className="break-words text-sm font-normal leading-6 text-muted-foreground">
                        {section.description}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                  <div className="min-h-0 min-w-0 border-t border-border/50 bg-background/45 px-3 py-5 sm:px-5">
                    {/* The guide is the quick reference; the documentation site
                        carries the long form. It is gated by the same plan and
                        add-on entitlement as this page, so a section visible
                        here is always readable there. */}
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3">
                      <p className="min-w-0 text-sm leading-6 text-muted-foreground">
                        Want the full detail on {section.title}?
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-shrink-0 gap-2"
                        onClick={() => openDocumentation(section.id)}
                      >
                        <BookOpen className="h-4 w-4" />
                        Read documentation
                        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                      </Button>
                    </div>
                    <div className="ml-2 min-w-0 space-y-5 border-l-2 border-primary/25 pl-3 sm:ml-5 sm:pl-6">
                    {section.items.map((item, itemIndex) => (
                      <article
                        key={itemIndex}
                        className="min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card/95 shadow-[0_12px_34px_rgba(15,23,42,0.06)] ring-1 ring-white/60 dark:border-white/10 dark:bg-background/50 dark:ring-white/5"
                      >
                        <div className="flex min-w-0 items-start gap-3 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.075),transparent_58%)] p-4 sm:p-5">
                          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-xs font-semibold text-primary shadow-inner shadow-primary/10">
                            {itemIndex + 1}
                          </span>
                          <div className="min-w-0 space-y-1.5">
                            <h4 className="break-words text-base font-semibold leading-6 text-foreground">{item.title}</h4>
                            <p className="text-sm leading-7 text-muted-foreground">{item.description}</p>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-4 p-4 sm:p-5">
                        {item.features && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-success/15 bg-success/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Key Features:</h5>
                            <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
                              {item.features.map((feature, featureIndex) => (
                                <li key={featureIndex} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-background/55 p-2.5 text-sm leading-6 text-foreground/90 dark:bg-background/35">
                                  <CheckCircle className="mt-1 h-4 w-4 flex-shrink-0 text-success" />
                                  <span className="min-w-0 break-words">{feature}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.steps && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-primary/15 bg-primary/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Step-by-Step Guide:</h5>
                            <ol className="space-y-2.5">
                              {item.steps.map((step, stepIndex) => (
                                <li key={stepIndex} className="flex min-w-0 items-start gap-3 rounded-xl bg-background/60 p-3 text-sm dark:bg-background/35">
                                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/25">
                                    {stepIndex + 1}
                                  </span>
                                  <span className="min-w-0 break-words leading-7 text-foreground/90">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {item.tips && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-brand-500/15 bg-brand-500/5 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Tips:</h5>
                            <ul className="space-y-2">
                              {item.tips.map((tip, tipIndex) => (
                                <li key={tipIndex} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-background/55 p-2.5 text-sm leading-6 dark:bg-background/35">
                                  <Sparkles className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-brand-500" />
                                  <span className="min-w-0 break-words text-foreground/90">{tip}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.shortcuts && (
                          <div className="min-w-0 space-y-3 rounded-2xl border border-border/55 bg-muted/20 p-4">
                            <h5 className="text-sm font-semibold leading-6 text-foreground">Shortcuts:</h5>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                              {item.shortcuts.map((shortcut, shortcutIndex) => (
                                <div
                                  key={shortcutIndex}
                                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/65 p-3 dark:bg-background/35"
                                >
                                  <span className="min-w-0 break-words text-sm leading-6 text-muted-foreground">
                                    {shortcut.description}
                                  </span>
                                  <div className="flex flex-shrink-0 flex-wrap gap-1">
                                    {shortcut.keys.map((key, keyIndex) => (
                                      <kbd
                                        key={keyIndex}
                                        className="rounded-lg border border-primary/20 bg-background px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm shadow-primary/5 ring-1 ring-white/50 dark:bg-background/60 dark:ring-white/10"
                                      >
                                        {key}
                                      </kbd>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>

                        {itemIndex < section.items.length - 1 && <Separator className="mx-5" />}
                      </article>
                    ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          )}
          {/* Guides this plan does not include.
              Named rather than silently omitted: a customer who notices a
              feature exists is a sales conversation, whereas a customer who
              notices documentation vanished raises a support ticket. */}
          {locked.length > 0 && (
            <div className="mt-6 rounded-2xl border border-border/65 bg-muted/25 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                  <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0 space-y-2">
                  <h4 className="text-sm font-semibold leading-6 text-foreground">
                    {locked.length} more {locked.length === 1 ? 'guide' : 'guides'} available on
                    other plans
                  </h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    These cover modules your current plan does not include. Contact your
                    administrator to add them.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {locked.map((l) => (
                      <span
                        key={l.id}
                        className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {l.title}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Support Section */}
      <Card id="need-help" className="min-w-0 scroll-mt-24 overflow-hidden rounded-[1.5rem] border-primary/20 bg-card/90 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:border-primary/15 dark:bg-background/75 dark:shadow-black/25">
        <CardHeader className="space-y-2 border-b border-border/50 bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),hsl(var(--muted)/0.16))]">
          <CardTitle className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-inner shadow-primary/10">
              <Headphones className="h-5 w-5 text-primary" />
            </span>
            <span className="min-w-0">Need Help?</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            If you need additional assistance or encounter any issues:
          </p>
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {needHelpItems.map((item) => (
              <li
                key={item.text}
                className="group flex min-w-0 items-start gap-3 rounded-2xl border border-border/65 bg-background/80 p-4 text-sm shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08),0_0_0_1px_hsl(var(--primary)/0.08)] dark:bg-background/40 dark:hover:shadow-black/25"
              >
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border shadow-inner ${item.className}`}>
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 break-words leading-6 text-foreground/90">{item.text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </DashboardThemeFrame>
    </>
  );
}
