/**
 * PdfImportEngineAdmin — retired rollout console.
 *
 * Wave F7 removes the legacy pdf.js engine toggle. This page remains as a
 * superadmin landing page so old bookmarks explain the new Docling-only state
 * and direct operators to diagnostics instead of a deleted flag editor.
 */
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CheckCircle2, DatabaseZap, FileUp, LockKeyhole, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { useAuth } from '@/hooks/useAuth';

const STATUS_CARDS: Array<{
  title: string;
  eyebrow: string;
  description: string;
  Icon: LucideIcon;
  accent: 'success' | 'primary';
  badgeIcon?: LucideIcon;
}> = [
  {
    title: 'Legacy toggle retired',
    eyebrow: 'Retired',
    description:
      'The `pdf_import.engine` flag and UI selector are no longer used. Dispatcher requests are idempotent and always target the Docling sidecar.',
    Icon: CheckCircle2,
    accent: 'success',
  },
  {
    title: 'Observable pipeline',
    eyebrow: 'Diagnostics',
    description:
      'Use diagnostics for attempts, summaries, SSIM artifacts, cost telemetry, and diagnostics bundle links instead of side-by-side legacy comparisons.',
    Icon: DatabaseZap,
    accent: 'primary',
  },
  {
    title: 'Compliance defaults',
    eyebrow: 'Defaults',
    description:
      'Signed diagnostic URLs are short lived, PII redaction remains available from import dialogs, and diagnostic downloads are audited.',
    Icon: ShieldCheck,
    badgeIcon: LockKeyhole,
    accent: 'primary',
  },
];

const accentClasses = {
  success: {
    card: 'border-success/25 hover:border-success/40',
    icon: 'border-success/25 bg-success/10 text-success',
    badge: 'border-success/25 bg-success/10 text-success',
    divider: 'from-success/25',
  },
  primary: {
    card: 'border-primary/25 hover:border-primary/40',
    icon: 'border-primary/25 bg-primary/10 text-primary',
    badge: 'border-primary/25 bg-primary/10 text-primary',
    divider: 'from-primary/25',
  },
} as const;

export default function PdfImportEngineAdmin() {
  const { isSuperadmin } = useAuth();

  if (!isSuperadmin) {
    return (
      <DashboardThemeFrame as="main" variant="page" className="p-4 sm:p-6">
        <DashboardThemeFrame variant="section" className="mx-auto max-w-3xl border-primary/10">
          <Card className="border-border/70 bg-card/80 shadow-none">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Superadmin role required to view PDF import engine status.
            </CardContent>
          </Card>
        </DashboardThemeFrame>
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="relative max-w-6xl space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="isolate border-primary/25 bg-gradient-to-br from-card via-card to-primary/10 p-5 ring-1 ring-primary/10 sm:p-6 lg:p-8"
      >
        <div className="absolute right-0 top-0 -z-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary)/0.68))] text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-white/40 dark:ring-white/10">
                <Zap className="h-7 w-7" aria-hidden="true" />
                <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-background bg-card text-primary shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </div>
              <div className="min-w-0 space-y-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <h1 className="min-w-0 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                    PDF import engine
                  </h1>
                  <Badge className="shrink-0 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-sm hover:bg-primary/20">
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Docling only
                  </Badge>
                </div>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  The Wave F7 retirement removed the legacy in-browser pdf.js template importer and the
                  feature-flag rollout controls. New imports, re-imports, rasters, OCR, diagnostics, and
                  reconciliation metadata now flow through the Cloud Run Docling pipeline.
                </p>
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:justify-end">
            <Button
              asChild
              className="h-11 rounded-xl px-5 font-semibold shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/25 focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <Link to="/admin/pdf-import-diagnostics">
                <DatabaseZap className="mr-2 h-4 w-4" aria-hidden="true" />
                Open diagnostics
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-xl border-primary/25 bg-background/70 px-5 font-semibold text-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <Link to="/admin/template-builder">
                <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />
                Import a PDF
              </Link>
            </Button>
          </div>
        </div>
      </DashboardThemeFrame>

      <section aria-label="PDF import engine operational guarantees" className="grid gap-4 md:grid-cols-3">
        {STATUS_CARDS.map(({ title, eyebrow, description, Icon, accent, badgeIcon: BadgeIcon }) => {
          const styles = accentClasses[accent];

          return (
            <DashboardThemeFrame
              key={title}
              as="article"
              variant="premiumCard"
              className={`flex h-full flex-col p-0 ${styles.card}`}
            >
              <Card className="flex h-full min-w-0 flex-col border-0 bg-transparent shadow-none">
                <div className="space-y-4 p-5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none ${styles.icon}`}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <Badge
                      variant="outline"
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${styles.badge}`}
                    >
                      {BadgeIcon ? <BadgeIcon className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
                      {eyebrow}
                    </Badge>
                  </div>
                  <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
                </div>
                <CardContent className="flex flex-1 flex-col justify-between gap-4 px-5 pb-5 text-sm leading-6 text-muted-foreground">
                  <p>{description}</p>
                  <div className={`h-px w-full bg-gradient-to-r via-border to-transparent ${styles.divider}`} aria-hidden="true" />
                </CardContent>
              </Card>
            </DashboardThemeFrame>
          );
        })}
      </section>
    </DashboardThemeFrame>
  );
}
