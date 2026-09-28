import { HardHat } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import type { PlannedBuildFigures } from '@/lib/reports/cashFlow/plannedBuild.pure';

/** What the adviser has typed — strings, as the inputs hold them. */
export interface PlannedBuildDraft {
  enabled: boolean;
  buildPrice: string;
  durationMonths: string;
  weeklyRent: string;
}

interface CashFlowPlannedBuildPanelProps {
  draft: PlannedBuildDraft;
  onChange: (next: PlannedBuildDraft) => void;
  /** The case the cash flow is running on, once a build contract is stated. */
  figures: PlannedBuildFigures | null;
  disabled?: boolean;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

/**
 * The land-only report's one switch: "we are going ahead and building".
 *
 * Off, the cash flow is the lot as it was bought. On, with a build contract,
 * it is costed as the new build the lot becomes — the construction payment
 * schedule, the land and build deposits, the interest carried while it is
 * built and a ten-year projection of the finished home — by the same modules
 * every new build uses (`plannedBuild.pure.ts`). Nothing is saved until the
 * adviser saves, like every other edit in this workspace.
 */
export function CashFlowPlannedBuildPanel({ draft, onChange, figures, disabled = false }: CashFlowPlannedBuildPanelProps) {
  const set = (patch: Partial<PlannedBuildDraft>) => onChange({ ...draft, ...patch });
  const digits = (value: string) => {
    const raw = removeCommas(value);
    return raw === '' || /^\d*\.?\d*$/.test(raw) ? raw : null;
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4 md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-2xl bg-primary/10 p-2 text-primary ring-1 ring-primary/10">
              <HardHat className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold md:text-base">Build on this land</p>
              <p className="max-w-2xl text-xs text-muted-foreground md:text-sm">
                Going ahead with a build? Switch this on and enter the build contract. The cash flow then
                includes the construction payment schedule and projects the finished home, the same way it
                does for a new build.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="planned-build-switch" className="text-sm font-medium">
              {draft.enabled ? 'Build planned' : 'Land only'}
            </Label>
            <Switch
              id="planned-build-switch"
              checked={draft.enabled}
              onCheckedChange={(checked) => set({ enabled: checked === true })}
              disabled={disabled}
              aria-describedby="planned-build-help"
            />
          </div>
        </div>

        {draft.enabled && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="planned-build-price" className="text-sm font-medium">
                  Build contract price <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="planned-build-price"
                    inputMode="numeric"
                    value={formatNumberWithCommas(draft.buildPrice)}
                    onChange={(e) => { const v = digits(e.target.value); if (v !== null) set({ buildPrice: v }); }}
                    placeholder="387,000"
                    disabled={disabled}
                    className="pl-7"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planned-build-duration" className="text-sm font-medium">Build duration</Label>
                <div className="relative">
                  <Input
                    id="planned-build-duration"
                    inputMode="numeric"
                    value={draft.durationMonths}
                    onChange={(e) => { if (/^\d{0,2}$/.test(e.target.value)) set({ durationMonths: e.target.value }); }}
                    placeholder="7"
                    disabled={disabled}
                    className="pr-16"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">months</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planned-build-rent" className="text-sm font-medium">Weekly rent once built</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="planned-build-rent"
                    inputMode="numeric"
                    value={formatNumberWithCommas(draft.weeklyRent)}
                    onChange={(e) => { const v = digits(e.target.value); if (v !== null) set({ weeklyRent: v }); }}
                    placeholder="550"
                    disabled={disabled}
                    className="pl-7"
                  />
                </div>
              </div>
            </div>

            <p id="planned-build-help" className="text-xs text-muted-foreground">
              Stage percentages and timing come from the report&apos;s construction settings and the schedule
              mode below. The loan is re-sized to the report&apos;s LVR of the land and build together, and stamp
              duty stays on the land. Save changes to keep the build with this report.
            </p>

            {figures ? (
              <dl className="grid gap-3 rounded-2xl border bg-muted/30 p-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Land</dt>
                  <dd className="font-semibold tabular-nums">{money(figures.landPrice)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Build contract</dt>
                  <dd className="font-semibold tabular-nums">{money(figures.buildPrice)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Total project</dt>
                  <dd className="font-semibold tabular-nums">{money(figures.totalProject)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Loan at {figures.loanToValueRatio}% LVR</dt>
                  <dd className="font-semibold tabular-nums">{money(figures.loanAmount)}</dd>
                </div>
              </dl>
            ) : (
              <p className="rounded-2xl border border-warning/30 bg-warning/10 p-3 text-xs text-foreground">
                Enter the build contract price to add the construction payment schedule.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
