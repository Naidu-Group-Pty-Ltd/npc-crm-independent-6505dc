/**
 * AlignDistributeBar — floating toolbar for multi-select positional ops.
 *
 * Sits BELOW the existing BulkEditBar. Visible when ≥ 2 overlays are selected
 * on the active page. Provides: align (L/C/R + T/M/B), distribute (H/V),
 * align-to-page, group/ungroup, z-order, lock/hide.
 */
import { Button } from '@/components/ui/button';
import {
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  Group, Ungroup, BringToFront, SendToBack, ChevronUp, ChevronDown,
  Lock, Unlock, Eye, EyeOff, Square, Crosshair,
} from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { AlignOp, DistributeOp, PageAlignOp } from '@/lib/reportTemplate/editorActions.layout';

interface Props {
  count: number;
  onAlign: (op: AlignOp) => void;
  onDistribute: (op: DistributeOp) => void;
  onAlignToPage: (op: PageAlignOp) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onZ: (op: 'forward' | 'backward' | 'front' | 'back') => void;
  onLock: (locked: boolean) => void;
  onHide: (hidden: boolean) => void;
  anyLocked?: boolean;
  anyHidden?: boolean;
  anyGrouped?: boolean;
}

function Group2({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 px-1 border-l border-border first:border-l-0">
      {children}
    </div>
  );
}

function Btn({
  onClick, title, children, danger,
}: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${danger ? 'text-destructive hover:text-destructive' : ''}`}
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px]">{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AlignDistributeBar({
  count, onAlign, onDistribute, onAlignToPage, onGroup, onUngroup, onZ,
  onLock, onHide, anyLocked, anyHidden, anyGrouped,
}: Props) {
  if (count < 2) return null;
  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center rounded-md border bg-background/95 backdrop-blur px-1 py-1 shadow-md">
      <Group2>
        <Btn onClick={() => onAlign('align-left')} title="Align left">
          <AlignStartVertical className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlign('align-center-h')} title="Align centers (H)">
          <AlignCenterVertical className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlign('align-right')} title="Align right">
          <AlignEndVertical className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlign('align-top')} title="Align top">
          <AlignStartHorizontal className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlign('align-center-v')} title="Align middles (V)">
          <AlignCenterHorizontal className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlign('align-bottom')} title="Align bottom">
          <AlignEndHorizontal className="h-3.5 w-3.5" />
        </Btn>
      </Group2>

      <Group2>
        <Btn onClick={() => onDistribute('distribute-h')} title="Distribute horizontally (≥3)">
          <AlignHorizontalSpaceAround className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onDistribute('distribute-v')} title="Distribute vertically (≥3)">
          <AlignVerticalSpaceAround className="h-3.5 w-3.5" />
        </Btn>
      </Group2>

      <Group2>
        <Btn onClick={() => onAlignToPage('page-center-h')} title="Center on page (H)">
          <Crosshair className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onAlignToPage('page-center-v')} title="Center on page (V)">
          <Square className="h-3.5 w-3.5" />
        </Btn>
      </Group2>

      <Group2>
        <Btn onClick={() => onZ('front')} title="Bring to front">
          <BringToFront className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onZ('forward')} title="Bring forward">
          <ChevronUp className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onZ('backward')} title="Send backward">
          <ChevronDown className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={() => onZ('back')} title="Send to back">
          <SendToBack className="h-3.5 w-3.5" />
        </Btn>
      </Group2>

      <Group2>
        <Btn onClick={onGroup} title="Group (⌘G)">
          <Group className="h-3.5 w-3.5" />
        </Btn>
        <Btn onClick={onUngroup} title="Ungroup (⌘⇧G)">
          <Ungroup className={`h-3.5 w-3.5 ${anyGrouped ? '' : 'opacity-40'}`} />
        </Btn>
      </Group2>

      <Group2>
        <Btn onClick={() => onLock(!anyLocked)} title={anyLocked ? 'Unlock' : 'Lock'}>
          {anyLocked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </Btn>
        <Btn onClick={() => onHide(!anyHidden)} title={anyHidden ? 'Show' : 'Hide'}>
          {anyHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Btn>
      </Group2>
    </div>
  );
}
