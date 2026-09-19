import { cn } from "@/lib/utils";

export const settingsCardClass =
  "dashboard-theme-card dashboard-surface-panel-strong min-h-0 min-w-0 overflow-hidden rounded-2xl transition-shadow duration-200 motion-reduce:transition-none";

export const settingsAccentCardClass =
  "dashboard-theme-premium-card min-h-0 min-w-0 overflow-hidden rounded-2xl border-primary/25 bg-gradient-to-br from-card via-card/95 to-primary/5 shadow-lg shadow-primary/10 transition-shadow duration-200 motion-reduce:transition-none";

export const settingsPanelClass =
  "dashboard-surface-control min-h-0 min-w-0 rounded-2xl p-4 transition-colors duration-150 motion-reduce:transition-none";

export const settingsSubtlePanelClass =
  "dashboard-panel-muted min-h-0 min-w-0 rounded-2xl p-3 text-xs leading-5 text-muted-foreground";

export const settingsPrimaryButtonClass =
  "bg-primary font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-colors duration-150 hover:bg-primary-hover focus-visible:ring-primary disabled:shadow-none motion-reduce:transition-none";

export const settingsPillButtonClass =
  "rounded-full font-semibold transition-colors duration-150 focus-visible:ring-primary motion-reduce:transition-none";

export const settingsInputClass =
  "dashboard-input-control min-h-0 min-w-0 focus-visible:ring-primary";

export const settingsSwitchClass =
  "shrink-0 focus-visible:ring-primary data-[state=checked]:bg-primary";

export const settingsBadgePillClass = "min-w-0 shrink-0 rounded-full";

export const settingsDangerButtonClass =
  "rounded-full text-destructive transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive disabled:text-muted-foreground motion-reduce:transition-none";

export const settingsDialogClass =
  "dashboard-surface-panel-strong max-h-[90dvh] min-h-0 min-w-0 rounded-2xl";

export const settingsInteractiveRowClass =
  "min-h-0 min-w-0 transition-colors duration-150 hover:bg-primary/5 focus-within:bg-primary/5 motion-reduce:transition-none";

export function settingsCx(
  ...classes: Array<string | undefined | null | false>
) {
  return cn(...classes);
}
