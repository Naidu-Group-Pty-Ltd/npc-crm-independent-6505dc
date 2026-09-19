/**
 * Floating bulk-edit toolbar.
 *
 * Appears at the top of the visual canvas when more than one overlay is
 * shift/cmd-clicked in the Outline panel. Lets you apply common style /
 * destructive actions to all selected overlays in one go.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Type, Palette, Trash2, AlignLeft, AlignCenter, AlignRight, X, Layers, Copy as CopyIcon, Combine,
} from 'lucide-react';

interface Props {
  count: number;
  onClear: () => void;
  onDelete: () => void;
  onAlign: (a: 'left' | 'center' | 'right') => void;
  onSetColor: (hex: string) => void;
  onSetFontSize: (n: number) => void;
  onSetFontFamily: (family: string) => void;
  onSetOpacity: (n: number) => void;
  onCopyStyle: () => void;
  onPasteStyle: () => void;
  hasStyleClipboard: boolean;
  /** Merge the selected text overlays into one (import cleanup). */
  onMergeText?: () => void;
  canMergeText?: boolean;
}

const FONT_FAMILIES = [
  'Inter, sans-serif',
  '"Playfair Display", serif',
  'Georgia, serif',
  '"DM Sans", sans-serif',
  '"Space Grotesk", sans-serif',
  'system-ui, sans-serif',
];

export function BulkEditBar({
  count, onClear, onDelete, onAlign, onSetColor, onSetFontSize,
  onSetFontFamily, onSetOpacity, onCopyStyle, onPasteStyle, hasStyleClipboard,
  onMergeText, canMergeText,
}: Props) {
  if (count < 2) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-md border bg-background/95 backdrop-blur px-2 py-1 shadow-md">
      <Layers className="h-3.5 w-3.5 text-primary" />
      <span className="text-xs font-medium mr-1">{count} selected</span>

      <span className="w-px h-4 bg-border mx-1" />

      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAlign('left')} title="Align left">
        <AlignLeft className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAlign('center')} title="Align center">
        <AlignCenter className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAlign('right')} title="Align right">
        <AlignRight className="h-3.5 w-3.5" />
      </Button>

      {onMergeText && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onMergeText}
          disabled={!canMergeText}
          title="Merge selected text overlays into one block"
        >
          <Combine className="h-3.5 w-3.5" />
        </Button>
      )}

      <span className="w-px h-4 bg-border mx-1" />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" title="Set text colour">
            <Palette className="h-3.5 w-3.5" /> Color
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3 space-y-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Text colour</Label>
          <div className="flex items-center gap-2">
            <Input
              type="color"
              defaultValue="#111111"
              onChange={(e) => onSetColor(e.target.value)}
              className="h-8 w-11 p-0.5"
            />
            <Input
              placeholder="#hex / rgba() / token:primary"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const value = (e.currentTarget as HTMLInputElement).value.trim();
                  if (value) onSetColor(value);
                }
              }}
              onBlur={(e) => {
                const value = e.currentTarget.value.trim();
                if (value) onSetColor(value);
              }}
              className="h-8 text-[11px] font-mono"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">Accepts #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), or token:name.</p>
          <div className="grid grid-cols-6 gap-1 pt-1">
            {['#0D0D0D', '#FFFFFF', '#BF9B50', '#1F2937', '#94A3B8', 'token:primary', 'token:text', 'token:muted'].map((c) => (
              <button
                key={c}
                onClick={() => onSetColor(c)}
                className="h-6 rounded border text-[8px] flex items-center justify-center"
                style={{ background: c.startsWith('#') ? c : '#eee', color: c.startsWith('#') && parseInt(c.slice(1), 16) < 0x888888 ? '#fff' : '#000' }}
                title={c}
              >
                {c.startsWith('token') ? 'T' : ''}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" title="Set font">
            <Type className="h-3.5 w-3.5" /> Font
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3 space-y-2">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Size (pt)</Label>
          <Input
            type="number"
            min={6}
            max={144}
            defaultValue={12}
            onChange={(e) => { const n = Number(e.target.value); if (n > 0) onSetFontSize(n); }}
            className="h-8 text-xs"
          />
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Family</Label>
          <div className="grid gap-1">
            {FONT_FAMILIES.map((f) => (
              <button
                key={f}
                onClick={() => onSetFontFamily(f)}
                className="text-left text-xs px-2 py-1 rounded hover:bg-muted"
                style={{ fontFamily: f }}
              >
                {f.split(',')[0].replace(/"/g, '')}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Opacity">
            Opacity
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-3 space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Opacity (0–1)</Label>
          <Input
            type="number"
            min={0} max={1} step={0.05} defaultValue={1}
            onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) onSetOpacity(Math.max(0, Math.min(1, n))); }}
            className="h-8 text-xs"
          />
        </PopoverContent>
      </Popover>

      <span className="w-px h-4 bg-border mx-1" />

      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onCopyStyle} title="Copy style from first selected">
        <CopyIcon className="h-3.5 w-3.5" /> Copy style
      </Button>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onPasteStyle} disabled={!hasStyleClipboard} title="Paste style to all">
        Paste
      </Button>

      <span className="w-px h-4 bg-border mx-1" />

      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} title="Delete all selected">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} title="Clear selection">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
