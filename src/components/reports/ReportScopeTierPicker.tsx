import { useState } from 'react';
import { MapPin, Hash, Globe, TrendingUp, FileText, Zap, BarChart3, Sparkles, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ReportScope, ReportTier } from '@/hooks/useReportPreferences';

export interface ScopeTierPickerProps {
  scope: ReportScope;
  tier: ReportTier;
  defaultScope: ReportScope;
  defaultTier: ReportTier;
  /** Restrict scope/tier choices to those that are valid in this context */
  availableScopes?: ReportScope[];
  availableTiers?: ReportTier[];
  onChange: (next: { scope: ReportScope; tier: ReportTier }) => void;
  /** Persist current choice as the user's default */
  onSaveDefault?: (next: { scope: ReportScope; tier: ReportTier }) => void;
  onConfirm: (next: { scope: ReportScope; tier: ReportTier }) => void;
  confirmLabel?: string;
  disabled?: boolean;
}

const SCOPE_META: Record<ReportScope, { label: string; icon: typeof MapPin; hint: string }> = {
  address:  { label: 'Address',  icon: MapPin,     hint: 'Single property report' },
  suburb:   { label: 'Suburb',   icon: TrendingUp, hint: 'Suburb-level market analysis' },
  zipcode:  { label: 'Postcode', icon: Hash,       hint: 'Postcode-level market analysis' },
  state:    { label: 'State',    icon: Globe,      hint: 'State-level market analysis' },
};

const TIER_META: Record<ReportTier, { label: string; icon: typeof BarChart3; hint: string; pages: string }> = {
  compass:   { label: 'Compass',   icon: BarChart3, hint: '40-page macro + planning + risk',  pages: '~40p' },
  financial: { label: 'Financial', icon: FileText,  hint: 'Yield, loan, cashflow, 10-yr',     pages: '~20p' },
  strategic: { label: 'Strategic', icon: Sparkles,  hint: 'Strategic advisor narrative',       pages: '~30p' },
  briefing:  { label: 'Briefing',  icon: FileText,  hint: 'Executive briefing',                pages: '~20p' },
  snapshot:  { label: 'Snapshot',  icon: Zap,       hint: 'Quick decision snapshot',           pages: '~5p' },
};

/**
 * In-menu segmented picker that lets the user choose scope (address / suburb /
 * postcode / state) and tier (compass / strategic / briefing / snapshot)
 * before confirming generation. Used inside ReportActionMenu (Phase B).
 */
export function ReportScopeTierPicker({
  scope,
  tier,
  defaultScope,
  defaultTier,
  availableScopes = ['address', 'suburb', 'zipcode', 'state'],
  availableTiers = ['compass', 'financial', 'strategic', 'briefing', 'snapshot'],
  onChange,
  onSaveDefault,
  onConfirm,
  confirmLabel = 'Generate',
  disabled = false,
}: ScopeTierPickerProps) {
  const [savingDefault, setSavingDefault] = useState(false);
  const isDefault = scope === defaultScope && tier === defaultTier;

  const setScope = (s: ReportScope) => onChange({ scope: s, tier });
  const setTier  = (t: ReportTier)  => onChange({ scope, tier: t });

  return (
    <div className="px-2 py-2 space-y-3 text-xs">
      {/* Scope row */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Scope</span>
          {scope === defaultScope && (
            <span className="text-[9px] text-muted-foreground/70">default</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {availableScopes.map((s) => {
            const meta = SCOPE_META[s];
            const Icon = meta.icon;
            const active = s === scope;
            return (
              <Tooltip key={s}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setScope(s)}
                    disabled={disabled}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors text-left',
                      active
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-accent hover:text-accent-foreground',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{meta.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{meta.hint}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Tier row */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Tier</span>
          {tier === defaultTier && (
            <span className="text-[9px] text-muted-foreground/70">default</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {availableTiers.map((t) => {
            const meta = TIER_META[t];
            const Icon = meta.icon;
            const active = t === tier;
            return (
              <Tooltip key={t}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setTier(t)}
                    disabled={disabled}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors text-left',
                      active
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/60 hover:bg-accent hover:text-accent-foreground',
                      disabled && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{meta.label}</span>
                    <span className="ml-auto text-[9px] text-muted-foreground">{meta.pages}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">{meta.hint}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-1.5 pt-1">
        <Button
          size="sm"
          className="flex-1 h-8"
          onClick={() => onConfirm({ scope, tier })}
          disabled={disabled}
        >
          {confirmLabel}
        </Button>
        {onSaveDefault && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                disabled={disabled || isDefault || savingDefault}
                onClick={async () => {
                  setSavingDefault(true);
                  try {
                    await onSaveDefault({ scope, tier });
                  } finally {
                    setSavingDefault(false);
                  }
                }}
                aria-label="Save as default"
              >
                <Star className={cn('h-3.5 w-3.5', isDefault && 'fill-primary text-primary')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isDefault ? 'Already your default' : 'Save as your default'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
