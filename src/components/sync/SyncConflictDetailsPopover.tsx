import { AlertTriangle, GitBranch, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  getActorLabel,
  getConflictReason,
  getSupersededByEntityId,
  getSupersededByVersionNumber,
  getSupersedesEntityId,
  getSurfaceLabel,
  getSyncStatusLabel,
  getVersionGroupId,
  getVersionNumber,
} from '@/lib/syncDisplay';

interface SyncConflictDetailsPopoverProps {
  record: Record<string, any> | null | undefined;
}

function shortId(value?: string | null) {
  if (!value) return null;
  return value.length > 8 ? value.slice(0, 8) : value;
}

export function SyncConflictDetailsPopover({ record }: SyncConflictDetailsPopoverProps) {
  if (!record) return null;

  const reason = getConflictReason(record);
  const actor = getActorLabel(record);
  const versionNumber = getVersionNumber(record);
  const versionGroupId = getVersionGroupId(record);
  const supersedesEntityId = getSupersedesEntityId(record);
  const supersededByEntityId = getSupersededByEntityId(record);
  const supersededByVersionNumber = getSupersededByVersionNumber(record);
  const sourceSurface = record.source_surface || record.metadata?.source_surface || record.source_details?.source_surface;
  const status = record.sync_status || record.metadata?.sync_status || null;

  const hasDetails = Boolean(
    reason
    || versionNumber
    || versionGroupId
    || supersedesEntityId
    || supersededByEntityId
    || status,
  );

  if (!hasDetails) return null;

  const Icon = status === 'conflict' ? AlertTriangle : status === 'superseded' ? GitBranch : Info;
  const title = status === 'conflict' ? 'Conflict details' : 'Sync details';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
          aria-label={title}
        >
          <Icon className="h-3 w-3" />
          Details
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            Deterministic sync lineage for this record.
          </p>
        </div>

        <div className="space-y-2 text-sm">
          {status && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Status</span>
              <span className="text-right text-foreground">{getSyncStatusLabel(status)}</span>
            </div>
          )}
          {sourceSurface && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Origin portal</span>
              <span className="text-right text-foreground">{getSurfaceLabel(sourceSurface)}</span>
            </div>
          )}
          {actor && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Actor</span>
              <span className="text-right break-all text-foreground">{actor}</span>
            </div>
          )}
          {versionNumber && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Current version</span>
              <span className="text-right text-foreground">v{versionNumber}</span>
            </div>
          )}
          {reason && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Resolution</span>
              <p className="text-sm text-foreground">{reason}</p>
            </div>
          )}
          {supersedesEntityId && versionNumber && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Version lineage</span>
              <p className="text-sm text-foreground">
                Version v{versionNumber} superseded record {shortId(supersedesEntityId)}.
              </p>
            </div>
          )}
          {supersededByEntityId && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Superseded by</span>
              <p className="text-sm text-foreground">
                {supersededByVersionNumber ? `Version v${supersededByVersionNumber}` : 'A newer version'} replaced this record as {shortId(supersededByEntityId)}.
              </p>
            </div>
          )}
          {versionGroupId && (
            <div className="flex items-start justify-between gap-3">
              <span className="text-muted-foreground">Version group</span>
              <span className="text-right font-mono text-xs text-foreground">{shortId(versionGroupId)}</span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}