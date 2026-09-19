import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Sparkles,
  FileText,
  Layers,
  BarChart3,
  Zap,
  Building2,
  ListChecks,
  Settings2,
  ExternalLink,
  Info,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { PropertyListing } from '@/lib/airtable';
import type { ReportScope, ReportTier } from '@/hooks/useReportPreferences';
import { buildFullAddress } from '@/lib/addressUtils';

const SCOPE_LABEL: Record<ReportScope, string> = {
  address: 'Address',
  suburb: 'Suburb',
  zipcode: 'Postcode',
  state: 'State',
};
const TIER_LABEL: Record<ReportTier, string> = {
  compass: 'Compass',
  strategic: 'Strategic',
  briefing: 'Briefing',
  snapshot: 'Snapshot',
  financial: 'Financial',
};
const TIER_ICON = {
  compass: BarChart3,
  strategic: Sparkles,
  briefing: FileText,
  snapshot: Zap,
  financial: BarChart3,
} as const;

const TIER_HINT: Record<ReportTier, string> = {
  compass: 'Deep 17-section Location & Property Fit deep-dive (~38 pages). Best for full due diligence.',
  strategic: 'Advisor-grade narrative with strategy, risks and NPC view — mid depth.',
  briefing: 'Concise executive briefing suitable for a first client-ready summary.',
  snapshot: 'Fast one-page snapshot — quickest to generate, minimal token cost.',
  financial: 'Financial-only fork (FIN) — cash flow, servicing, tax and scenarios.',
};

const SCOPE_HINT: Record<ReportScope, string> = {
  address: 'Runs against the specific property address on the listing.',
  suburb: 'Aggregates data at the suburb level around the listing.',
  zipcode: 'Aggregates data at the postcode level around the listing.',
  state: 'State-wide market context — broadest scope, lowest specificity.',
};

const HELP_ICON_CLS =
  'ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors';

function HelpDot({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground"
          aria-label="What does this do?"
        >
          <Info className={HELP_ICON_CLS} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-xs text-xs leading-relaxed">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}


export interface ReportCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listings: PropertyListing[];
  selectedIds: Set<string>;
  effectiveScope: ReportScope;
  effectiveTier: ReportTier;
  canGenerate: boolean;
  onGenerateForListing: (listing: PropertyListing, scope: ReportScope, tier: ReportTier) => void;
  onOpenBulkGeneration: () => void;
  onToggleSelect: (listingId: string) => void;
  onClearSelection: () => void;
}

/**
 * Phase C: ⌘K command palette for fast report actions.
 * Searches listings by address/suburb/postcode and exposes:
 *  - Generate (uses cached scope/tier or per-tier sub-commands)
 *  - Add/remove from selection
 *  - Bulk-generate from current selection
 *  - Quick navigation to Reports / Generated Reports
 */
export function ReportCommandPalette({
  open,
  onOpenChange,
  listings,
  selectedIds,
  effectiveScope,
  effectiveTier,
  canGenerate,
  onGenerateForListing,
  onOpenBulkGeneration,
  onToggleSelect,
  onClearSelection,
}: ReportCommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);


  // Global ⌘K / Ctrl+K binding
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  // Limit visible listing matches for perf — cmdk filters internally
  const visibleListings = useMemo(() => listings.slice(0, 50), [listings]);

  const close = () => {
    onOpenChange(false);
    setSearch('');
  };

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const selectionSize = selectedIds.size;
  const canBulk = canGenerate && selectionSize >= 2 && selectionSize <= 10;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <TooltipProvider delayDuration={150}>
        <CommandInput
          placeholder="Search listings, or run a command…"
          value={search}
          onValueChange={setSearch}
        />

        {/* Contextual help panel */}
        <div className="border-b border-border/60 bg-muted/30 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
            aria-expanded={showHelp}
          >
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle className="h-3.5 w-3.5" />
              How commands work
            </span>
            {showHelp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showHelp && (
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Search</span> — type an address, suburb or
                postcode to filter matching listings. Press <kbd className="rounded bg-background/70 px-1 font-mono">↵</kbd> on a
                match to generate a report for it using your current default scope &amp; tier.
              </p>
              <p>
                <span className="font-semibold text-foreground">Selection</span> — commands here act on the
                listings you ticked in the table. Bulk generation supports 2–10 selected properties.
              </p>
              <p>
                <span className="font-semibold text-foreground">Tier shortcuts</span> — override the default
                depth for a one-off generation. Current defaults:
                <span className="ml-1 rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {SCOPE_LABEL[effectiveScope]} · {TIER_LABEL[effectiveTier]}
                </span>
              </p>
              <p>
                <span className="font-semibold text-foreground">Tips</span> — hover the{' '}
                <Info className="inline h-3 w-3 align-[-2px] text-muted-foreground/70" /> icon on any
                command for a plain-English description of what it does before you run it.
              </p>
            </div>
          )}
        </div>

        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          {/* Selection actions */}
          {selectionSize > 0 && (
            <>
              <CommandGroup heading={`Selection (${selectionSize})`}>
                {canBulk && (
                  <CommandItem onSelect={run(onOpenBulkGeneration)}>
                    <Layers className="h-4 w-4 mr-2 text-primary" />
                    <span className="flex-1">Generate reports for {selectionSize} selected</span>
                    <HelpDot label={`Opens the bulk generation modal and queues ${selectionSize} reports back-to-back using your current defaults. Runs in the background so you can keep working.`} />
                    <CommandShortcut>↵</CommandShortcut>
                  </CommandItem>
                )}
                {canGenerate && selectionSize > 10 && (
                  <CommandItem disabled>
                    <Layers className="h-4 w-4 mr-2 text-muted-foreground" />
                    <span className="flex-1">Bulk supports max 10 — reduce selection</span>
                    <HelpDot label="To protect token spend and keep queue times reasonable, bulk generation is capped at 10 properties per run. Untick some listings and try again." />
                  </CommandItem>
                )}
                <CommandItem onSelect={run(onClearSelection)}>
                  <ListChecks className="h-4 w-4 mr-2" />
                  <span className="flex-1">Clear selection</span>
                  <HelpDot label="Deselects every listing currently ticked in the table. Does not delete anything." />
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Listing matches */}
          {visibleListings.length > 0 && (
            <>
              <CommandGroup
                heading={`Listings — generate as ${SCOPE_LABEL[effectiveScope]} · ${TIER_LABEL[effectiveTier]}`}
              >
                {visibleListings.map((listing) => {
                  const addr = listing.address || listing.location || 'Unknown';
                  const sub = [listing.suburb, listing.state, listing.zipCode]
                    .filter(Boolean)
                    .join(' ');
                  const isSel = selectedIds.has(listing.id);
                  return (
                    <CommandItem
                      key={listing.id}
                      value={`${addr} ${sub} ${buildFullAddress(listing)}`}
                      onSelect={
                        canGenerate
                          ? run(() => onGenerateForListing(listing, effectiveScope, effectiveTier))
                          : undefined
                      }
                    >
                      <Building2 className="h-4 w-4 mr-2 text-muted-foreground" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate">{addr}</span>
                        {sub && <span className="text-[10px] text-muted-foreground truncate">{sub}</span>}
                      </div>
                      <HelpDot
                        label={`Generates a ${TIER_LABEL[effectiveTier]} report scoped to the ${SCOPE_LABEL[effectiveScope]}. ${TIER_HINT[effectiveTier]} ${SCOPE_HINT[effectiveScope]}`}
                      />
                      <CommandShortcut className="flex items-center gap-1">
                        {isSel && <span className="text-primary">●</span>}
                        <Sparkles className="h-3 w-3" />
                      </CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Tier shortcuts (apply to first match if any, otherwise hint only) */}
          {canGenerate && visibleListings.length > 0 && search && (
            <>
              <CommandGroup heading="Generate first match with tier">
                {(['compass', 'strategic', 'briefing', 'snapshot'] as ReportTier[]).map((t) => {
                  const Icon = TIER_ICON[t];
                  return (
                    <CommandItem
                      key={t}
                      onSelect={run(() =>
                        onGenerateForListing(visibleListings[0], effectiveScope, t)
                      )}
                    >
                      <Icon className="h-4 w-4 mr-2 text-primary" />
                      <span className="flex-1">{TIER_LABEL[t]}</span>
                      <HelpDot label={TIER_HINT[t]} />
                      {t === effectiveTier && (
                        <CommandShortcut className="text-[10px]">default</CommandShortcut>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Navigation */}
          <CommandGroup heading="Navigate">
            <CommandItem onSelect={run(() => navigate('/generated-reports'))}>
              <FileText className="h-4 w-4 mr-2" />
              <span className="flex-1">Open Generated Reports</span>
              <HelpDot label="Jump to the library of every report that has finished generating for this workspace. You can preview, download or share from there." />
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/reports'))}>
              <ExternalLink className="h-4 w-4 mr-2" />
              <span className="flex-1">Open Reports page</span>
              <HelpDot label="Opens the main Reports hub — configure scope, tier, templates and kick off ad-hoc generations from a full-screen workspace." />
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/reports'))}>
              <Settings2 className="h-4 w-4 mr-2" />
              <span className="flex-1">Manage report defaults</span>
              <HelpDot label="Change the default scope (Address / Suburb / Postcode / State) and tier (Compass / Strategic / Briefing / Snapshot / Financial) applied when you generate from the palette." />
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </TooltipProvider>
    </CommandDialog>
  );
}

