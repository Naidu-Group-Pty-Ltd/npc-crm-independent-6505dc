/**
 * Pricing & Catalog card — read-only view of Mission Control's pricing
 * catalogue (seat roles, add-on modules, setup packages, per-report credit
 * costs). All edits happen in Mission Control's /billing/catalog.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Sparkles,
  Layers,
  Coins,
  UserCog,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { useMissionControlCatalog } from "@/hooks/useMissionControlCatalog";
import {
  formatPriceRange,
  type MissionControlCatalog,
} from "@/lib/missionControlCatalog";
import {
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";
import {
  settingsBadgePillClass,
  settingsCardClass,
  settingsCx,
  settingsInteractiveRowClass,
  settingsPanelClass,
  settingsPillButtonClass,
} from "@/components/settings/settingsUi";

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: any;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className={settingsCx(settingsPanelClass, "space-y-3")}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="min-w-0 break-words text-sm font-semibold">{title}</h3>
        <Badge
          variant="outline"
          className={settingsCx(settingsBadgePillClass, "ml-auto")}
        >
          {count}
        </Badge>
      </div>
      {count === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 bg-muted/25 p-3 text-xs italic text-muted-foreground">
          No items configured in Mission Control.
        </p>
      ) : (
        <div className="min-w-0 space-y-2">{children}</div>
      )}
    </div>
  );
}

export function PricingCatalogCard() {
  const { catalog, loading, error, refresh } = useMissionControlCatalog();

  return (
    <Card className={settingsCardClass}>
      <CardHeader className="space-y-4">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg md:text-xl">
              <Coins className="h-4 w-4 shrink-0 text-primary" />
              Pricing & Catalog
            </CardTitle>
            <CardDescription className="max-w-3xl break-words leading-6">
              Seat roles, add-on modules, setup packages and per-report credit
              costs synced from Mission Control.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh pricing and catalog"
            aria-busy={loading}
            className={settingsCx(settingsPillButtonClass, "w-full sm:w-auto")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6">
        {error && (
          <Alert
            variant="destructive"
            className="min-w-0 overflow-hidden rounded-2xl"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}

        {loading && !catalog && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {catalog && <CatalogBody catalog={catalog} />}

        <Separator />
        <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-words">
            Read-only — edits happen in Mission Control.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openMissionControlWithAttribution("pricing", AURIXA_PRICING_URL)
            }
            className={settingsCx(
              settingsPillButtonClass,
              "w-full shrink-0 border-primary/35 hover:border-primary/60 sm:w-auto",
            )}
          >
            Open catalog
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CatalogBody({ catalog }: { catalog: MissionControlCatalog }) {
  return (
    <>
      <Section icon={UserCog} title="Seat roles" count={catalog.roles.length}>
        {catalog.roles.map((r) => (
          <div
            key={r.slug}
            className={settingsCx(
              settingsInteractiveRowClass,
              "flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between",
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-medium">
                  {r.name}
                </span>
                <code className="min-w-0 break-all rounded-full bg-muted/45 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {r.slug}
                </code>
              </div>
              {r.permissions?.length ? (
                <p className="mt-1 break-words text-xs leading-5 text-muted-foreground line-clamp-2">
                  {r.permissions.slice(0, 6).join(" · ")}
                  {r.permissions.length > 6
                    ? ` +${r.permissions.length - 6}`
                    : ""}
                </p>
              ) : null}
            </div>
            <Badge
              variant="secondary"
              className={settingsCx(
                settingsBadgePillClass,
                "bg-primary/10 px-3 py-1 text-primary",
              )}
            >
              {formatPriceRange(
                r.price_min_cents,
                r.price_max_cents,
                r.currency || "AUD",
              )}
            </Badge>
          </div>
        ))}
      </Section>

      <Section
        icon={Sparkles}
        title="Add-on modules"
        count={catalog.addons.length}
      >
        {catalog.addons.map((a) => (
          <div
            key={a.slug}
            className={settingsCx(
              settingsInteractiveRowClass,
              "flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between",
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-medium">
                  {a.name}
                </span>
                <code className="min-w-0 break-all rounded-full bg-muted/45 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {a.slug}
                </code>
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                Billed {a.billing_period}
                {a.included_in_plans?.length
                  ? ` · Included in: ${a.included_in_plans.join(", ")}`
                  : ""}
              </p>
            </div>
            <Badge
              variant="secondary"
              className={settingsCx(
                settingsBadgePillClass,
                "bg-primary/10 px-3 py-1 text-primary",
              )}
            >
              {formatPriceRange(
                a.price_min_cents,
                a.price_max_cents,
                a.currency || "AUD",
              )}
            </Badge>
          </div>
        ))}
      </Section>

      <Section
        icon={Layers}
        title="Setup packages"
        count={catalog.setups.length}
      >
        {catalog.setups.map((s) => (
          <div
            key={s.slug}
            className={settingsCx(
              settingsInteractiveRowClass,
              "rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm",
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-sm font-medium">
                {s.name}
              </span>
              <code className="min-w-0 break-all rounded-full bg-muted/45 px-2 py-0.5 text-[10px] text-muted-foreground">
                {s.slug}
              </code>
              {s.applies_to_plans?.length ? (
                <Badge
                  variant="outline"
                  className={settingsCx(
                    settingsBadgePillClass,
                    "ml-auto text-[10px]",
                  )}
                >
                  {s.applies_to_plans.join(", ")}
                </Badge>
              ) : null}
            </div>
            {s.deliverables?.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs leading-5 text-muted-foreground">
                {s.deliverables.slice(0, 5).map((d, i) => (
                  <li key={i} className="break-words">
                    {d}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </Section>

      <Section
        icon={Coins}
        title="Report credit costs"
        count={catalog.reports.length}
      >
        <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
          {catalog.reports.map((r) => (
            <div
              key={r.slug}
              className={settingsCx(
                settingsInteractiveRowClass,
                "flex items-start justify-between gap-3 rounded-2xl border border-border/60 bg-card/70 p-3 shadow-sm",
              )}
            >
              <div className="min-w-0">
                <div className="min-w-0 break-words text-sm font-medium">
                  {r.name}
                </div>
                <code className="min-w-0 break-all rounded-full bg-muted/45 px-2 py-0.5 text-[10px] text-muted-foreground">
                  {r.slug}
                </code>
              </div>
              <Badge
                variant="secondary"
                className={settingsCx(
                  settingsBadgePillClass,
                  "bg-primary/10 px-3 py-1 text-primary",
                )}
              >
                {r.credit_cost} {r.credit_cost === 1 ? "credit" : "credits"}
              </Badge>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
