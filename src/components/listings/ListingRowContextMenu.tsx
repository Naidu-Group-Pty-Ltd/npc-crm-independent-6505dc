import { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Sparkles,
  Eye,
  Copy,
  ExternalLink,
  Mail,
  Map,
  CheckSquare,
  Square,
} from 'lucide-react';

export interface ListingRowContextMenuProps {
  children: ReactNode;
  label?: string;
  isSelected?: boolean;
  canGenerate?: boolean;
  onQuickGenerate: () => void;
  onToggleSelect?: () => void;
  onOpenDetails?: () => void;
  onCopyAddress?: () => void;
  onOpenSource?: () => void;
  onEmailAgent?: () => void;
}

/**
 * Right-click context menu for listing rows (Phase C). Mirrors the
 * ReportActionMenu actions but launches from anywhere on the row, with
 * a quick scope/tier submenu using cached preferences.
 */
export function ListingRowContextMenu({
  children,
  label,
  isSelected,
  canGenerate = true,
  onQuickGenerate,
  onToggleSelect,
  onOpenDetails,
  onCopyAddress,
  onOpenSource,
  onEmailAgent,
}: ListingRowContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {label && (
          <>
            <ContextMenuLabel className="text-xs font-normal text-muted-foreground truncate">
              {label}
            </ContextMenuLabel>
            <ContextMenuSeparator />
          </>
        )}

        {canGenerate && (
          <>
            <ContextMenuItem onClick={onQuickGenerate}>
              <Sparkles className="h-4 w-4 mr-2 text-primary" />
              Generate investment report
            </ContextMenuItem>

            <ContextMenuSeparator />
          </>
        )}

        {onToggleSelect && (
          <ContextMenuItem onClick={onToggleSelect}>
            {isSelected ? (
              <>
                <CheckSquare className="h-4 w-4 mr-2 text-primary" />
                Remove from selection
              </>
            ) : (
              <>
                <Square className="h-4 w-4 mr-2" />
                Add to selection
              </>
            )}
          </ContextMenuItem>
        )}

        {(onOpenDetails || onCopyAddress || onOpenSource || onEmailAgent) && <ContextMenuSeparator />}

        {onOpenDetails && (
          <ContextMenuItem onClick={onOpenDetails}>
            <Map className="h-4 w-4 mr-2" />
            Open details
          </ContextMenuItem>
        )}
        {onEmailAgent && (
          <ContextMenuItem onClick={onEmailAgent}>
            <Mail className="h-4 w-4 mr-2" />
            Email the agent
          </ContextMenuItem>
        )}
        {onOpenSource && (
          <ContextMenuItem onClick={onOpenSource}>
            <ExternalLink className="h-4 w-4 mr-2" />
            Open source
          </ContextMenuItem>
        )}
        {onCopyAddress && (
          <ContextMenuItem onClick={onCopyAddress}>
            <Copy className="h-4 w-4 mr-2" />
            Copy address
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
