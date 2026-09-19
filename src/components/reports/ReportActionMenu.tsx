import { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MoreHorizontal,
  Eye,
  Download,
  RefreshCw,
  History,
  Archive,
  ArchiveRestore,
  FileText,
  Zap,
  BarChart3,
  ExternalLink,
  Copy,
  Loader2,
  AlertCircle,
  Sparkles,
  Map,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReportScopeTierPicker } from './ReportScopeTierPicker';
import type { ReportScope, ReportTier } from '@/hooks/useReportPreferences';
import { useState } from 'react';
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from '@/components/ui/dropdown-menu';

/**
 * Unified report action menu used across Listings rows, Generated Reports
 * cards, and (later) the client review wizard.
 *
 * The menu is purely presentational + a routing layer to caller-provided
 * callbacks. It never owns business logic — that stays in the parent so
 * we don't regress permissions, modals, or report-state side effects.
 */

export type ReportActionStatus =
  | 'idle'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ReportContext {
  /** Existing report id, if one exists for this row/card */
  reportId?: string;
  /** Last known status of the existing report */
  status?: ReportActionStatus;
  /** Tier of the existing report — controls which "generate condensed" items appear */
  tier?: 'compass' | 'strategic' | 'briefing' | 'snapshot' | string | null;
  /** Scope of the existing report (address/suburb/postcode/state) */
  scope?: string | null;
  /** Last error message, if status === 'failed' */
  errorMessage?: string | null;
  /** Whether the report is archived */
  isArchived?: boolean;
}

export interface ReportActionCallbacks {
  /** Open the existing report viewer */
  onView?: () => void;
  /** Download the existing report (txt/pdf — caller decides) */
  onDownload?: () => void;
  /** Trigger a fresh full regeneration (chunked) */
  onRegenerate?: () => void;
  /** Open the version-history drawer/modal */
  onViewHistory?: () => void;
  /** Toggle archived state */
  onToggleArchive?: () => void;
  /** Generate a condensed Briefing from a Compass report */
  onGenerateBriefing?: () => void;
  /** Generate a Snapshot from a Compass report */
  onGenerateSnapshot?: () => void;
  /** Open the "create new investment report" modal (Listings flow) */
  onOpenGenerateModal?: () => void;
  /** Open property/listing details */
  onOpenDetails?: () => void;
  /** Open the source URL (e.g. Domain.com.au listing) */
  onOpenSource?: () => void;
  /** Copy the full address to clipboard */
  onCopyAddress?: () => void;
  /** Phase B: open generate flow with explicit scope + tier */
  onGenerateWithScope?: (args: { scope: ReportScope; tier: ReportTier }) => void;
}

export interface GeneratePickerConfig {
  /** Currently selected scope (controlled) */
  scope: ReportScope;
  tier: ReportTier;
  defaultScope: ReportScope;
  defaultTier: ReportTier;
  availableScopes?: ReportScope[];
  availableTiers?: ReportTier[];
  onChange: (next: { scope: ReportScope; tier: ReportTier }) => void;
  /** Persist as default (star button) */
  onSaveDefault?: (next: { scope: ReportScope; tier: ReportTier }) => void;
}

export interface ReportActionPermissions {
  canGenerate?: boolean;
  canEdit?: boolean;
  canArchive?: boolean;
  canDelete?: boolean;
}

export interface ReportActionMenuProps {
  /** Surface that the menu is rendered into — controls labels and item ordering */
  surface: 'listing-row' | 'report-card';
  /** Optional human label, e.g. property address — used in screen-reader text */
  label?: string;
  /** Existing report context (omit on listings rows that have no report yet) */
  report?: ReportContext;
  /** Caller-provided handlers — only the items whose callbacks are present render */
  callbacks: ReportActionCallbacks;
  /** Permission gates — items hidden if false */
  permissions?: ReportActionPermissions;
  /** Currently regenerating? Disables the regenerate item and shows spinner */
  isRegenerating?: boolean;
  /** Currently generating a condensed tier? Disables those items */
  generatingTier?: 'briefing' | 'snapshot' | null;
  /** Custom trigger override (e.g. a styled icon button); defaults to `MoreHorizontal` */
  trigger?: ReactNode;
  /** Optional className applied to the trigger Button when using the default trigger */
  triggerClassName?: string;
  /** Menu alignment */
  align?: 'start' | 'center' | 'end';
  /** Phase B: when provided, renders the scope+tier picker submenu */
  generatePicker?: GeneratePickerConfig;
}

function StatusHint({ status, errorMessage }: { status?: ReportActionStatus; errorMessage?: string | null }) {
  if (!status || status === 'idle' || status === 'completed') return null;

  const map: Record<string, { label: string; tone: string; icon: ReactNode }> = {
    pending: { label: 'Pending', tone: 'text-muted-foreground', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    processing: { label: 'Generating…', tone: 'text-primary', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { label: errorMessage ? `Failed: ${errorMessage}` : 'Last attempt failed', tone: 'text-destructive', icon: <AlertCircle className="h-3 w-3" /> },
  };
  const entry = map[status];
  if (!entry) return null;

  return (
    <div className={cn('flex items-center gap-1.5 px-2 py-1.5 text-xs', entry.tone)}>
      {entry.icon}
      <span className="truncate">{entry.label}</span>
    </div>
  );
}

export function ReportActionMenu({
  surface,
  label,
  report,
  callbacks,
  permissions = {},
  isRegenerating = false,
  generatingTier = null,
  trigger,
  triggerClassName,
  align = 'end',
  generatePicker,
}: ReportActionMenuProps) {
  const {
    canGenerate = true,
    canEdit = true,
    canArchive = true,
  } = permissions;

  const hasReport = !!report?.reportId;
  const isCompass = report?.tier === 'compass';
  const isProcessing = report?.status === 'processing' || report?.status === 'pending';

  const showGenerateGroup =
    canGenerate &&
    (callbacks.onOpenGenerateModal || (hasReport && callbacks.onRegenerate));

  const showCondensedGroup =
    hasReport && isCompass && (callbacks.onGenerateBriefing || callbacks.onGenerateSnapshot);

  const showHistory = hasReport && callbacks.onViewHistory;
  const showArchive = hasReport && canArchive && callbacks.onToggleArchive;
  const showListingExtras =
    surface === 'listing-row' &&
    (callbacks.onOpenDetails || callbacks.onOpenSource || callbacks.onCopyAddress);
  const listingMenuItemClass = surface === 'listing-row'
    ? 'min-h-9 rounded-lg text-sm font-medium transition-colors focus:bg-primary/10 focus:text-primary data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary'
    : undefined;
  const listingMenuContentClass = surface === 'listing-row'
    ? 'w-64 rounded-xl border-border/70 bg-popover/95 p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur supports-[backdrop-filter]:bg-popover/90 dark:border-white/10 dark:shadow-black/40'
    : 'w-60';

  const triggerEl = trigger ?? (
    <Button variant="ghost" size="icon" className={cn('h-8 w-8', triggerClassName)} aria-label={label ? `Open actions for ${label}` : 'Open report actions'}>
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{triggerEl}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className={listingMenuContentClass}>
          {label && (
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">
              {label}
            </DropdownMenuLabel>
          )}

          {/* Status hint surfaces in-flight or failed state */}
          {report?.status && report.status !== 'idle' && report.status !== 'completed' && (
            <>
              <StatusHint status={report.status} errorMessage={report.errorMessage} />
              <DropdownMenuSeparator />
            </>
          )}

          {/* === Existing report actions === */}
          {hasReport && (
            <DropdownMenuGroup>
              {callbacks.onView && (
                <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onView}>
                  <Eye className="h-4 w-4 mr-2" />
                  View report
                </DropdownMenuItem>
              )}
              {callbacks.onDownload && (
                <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          )}

          {hasReport && showGenerateGroup && <DropdownMenuSeparator />}

          {/* === Generate / regenerate === */}
          {showGenerateGroup && (
            <DropdownMenuGroup>
              {!hasReport && callbacks.onOpenGenerateModal && (
                <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onOpenGenerateModal}>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Generate investment report
                </DropdownMenuItem>
              )}
              {hasReport && callbacks.onRegenerate && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuItem
                      className={listingMenuItemClass}
                      onClick={callbacks.onRegenerate}
                      disabled={isRegenerating || isProcessing}
                    >
                      {isRegenerating ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      {isRegenerating ? 'Regenerating…' : 'Regenerate'}
                    </DropdownMenuItem>
                  </TooltipTrigger>
                  {isProcessing && (
                    <TooltipContent side="left">
                      Already processing — wait for it to finish
                    </TooltipContent>
                  )}
                </Tooltip>
              )}
              {hasReport && callbacks.onOpenGenerateModal && (
                <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onOpenGenerateModal}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate new report…
                </DropdownMenuItem>
              )}

              {/* Phase B: scope + tier picker submenu */}
              {generatePicker && callbacks.onGenerateWithScope && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={listingMenuItemClass}>
                    <Sparkles className="h-4 w-4 mr-2 text-primary" />
                    Generate with options…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="w-72 p-0">
                      <ReportScopeTierPicker
                        scope={generatePicker.scope}
                        tier={generatePicker.tier}
                        defaultScope={generatePicker.defaultScope}
                        defaultTier={generatePicker.defaultTier}
                        availableScopes={generatePicker.availableScopes}
                        availableTiers={generatePicker.availableTiers}
                        onChange={generatePicker.onChange}
                        onSaveDefault={generatePicker.onSaveDefault}
                        onConfirm={(next) => callbacks.onGenerateWithScope?.(next)}
                        confirmLabel={hasReport ? 'Regenerate' : 'Generate'}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>
          )}

          {/* === Condensed tiers === */}
          {showCondensedGroup && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Generate condensed
              </DropdownMenuLabel>
              <DropdownMenuGroup>
                {callbacks.onGenerateBriefing && (
                  <DropdownMenuItem
                    onClick={callbacks.onGenerateBriefing}
                    disabled={generatingTier !== null}
                  >
                    {generatingTier === 'briefing' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2 text-info" />
                    )}
                    Briefing (~20p)
                  </DropdownMenuItem>
                )}
                {callbacks.onGenerateSnapshot && (
                  <DropdownMenuItem
                    onClick={callbacks.onGenerateSnapshot}
                    disabled={generatingTier !== null}
                  >
                    {generatingTier === 'snapshot' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4 mr-2 text-success" />
                    )}
                    Snapshot (~5p)
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}

          {/* === History / archive === */}
          {(showHistory || showArchive) && <DropdownMenuSeparator />}
          {showHistory && (
            <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onViewHistory}>
              <History className="h-4 w-4 mr-2" />
              Version history
            </DropdownMenuItem>
          )}
          {showArchive && (
            <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onToggleArchive}>
              {report?.isArchived ? (
                <>
                  <ArchiveRestore className="h-4 w-4 mr-2 text-success" />
                  Restore from archive
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4 mr-2 text-muted-foreground" />
                  Archive
                </>
              )}
            </DropdownMenuItem>
          )}

          {/* === Listing-row extras (Open Details / Source / Copy) === */}
          {showListingExtras && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {callbacks.onOpenDetails && (
                  <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onOpenDetails}>
                    <Map className="h-4 w-4 mr-2" />
                    Open details
                  </DropdownMenuItem>
                )}
                {callbacks.onOpenSource && (
                  <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onOpenSource}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open source
                  </DropdownMenuItem>
                )}
                {callbacks.onCopyAddress && (
                  <DropdownMenuItem className={listingMenuItemClass} onClick={callbacks.onCopyAddress}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy address
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
