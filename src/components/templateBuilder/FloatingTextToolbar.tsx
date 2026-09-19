/**
 * FloatingTextToolbar — quick text styling above a selected text overlay
 * (rehaul Phase 5). Lets you change size / bold / italic / align / colour
 * without opening the inspector. Patches go through the normal overlay update
 * path, so undo/redo and the renderer are unaffected.
 */
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Overlay } from '@/lib/reportTemplate/templateSchema';

interface Props {
  overlay: Overlay;
  onChange: (patch: Partial<Overlay>) => void;
}

export function FloatingTextToolbar({ overlay, onChange }: Props) {
  const o = overlay as any;
  const size = Number(o.fontSize) || 16;
  const isBold = o.fontWeight === 'bold' || Number(o.fontWeight) >= 600;
  const isItalic = o.fontStyle === 'italic';
  const align: string = o.align || 'left';
  const colorValue = typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : '#000000';

  return (
    <div className="flex items-center gap-0.5 rounded-md border bg-popover px-1 py-0.5 shadow-md">
      <Button variant="ghost" size="icon" className="h-6 w-6" title="Smaller" onClick={() => onChange({ fontSize: Math.max(4, size - 1) } as Partial<Overlay>)}>
        <Minus className="h-3 w-3" />
      </Button>
      <span className="w-6 text-center text-[11px] tabular-nums">{Math.round(size)}</span>
      <Button variant="ghost" size="icon" className="h-6 w-6" title="Larger" onClick={() => onChange({ fontSize: Math.min(400, size + 1) } as Partial<Overlay>)}>
        <Plus className="h-3 w-3" />
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      <Button variant={isBold ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6" title="Bold" onClick={() => onChange({ fontWeight: isBold ? 'normal' : 'bold' } as Partial<Overlay>)}>
        <Bold className="h-3 w-3" />
      </Button>
      <Button variant={isItalic ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6" title="Italic" onClick={() => onChange({ fontStyle: isItalic ? 'normal' : 'italic' } as Partial<Overlay>)}>
        <Italic className="h-3 w-3" />
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      <Button variant={align === 'left' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6" title="Align left" onClick={() => onChange({ align: 'left' } as Partial<Overlay>)}>
        <AlignLeft className="h-3 w-3" />
      </Button>
      <Button variant={align === 'center' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6" title="Align centre" onClick={() => onChange({ align: 'center' } as Partial<Overlay>)}>
        <AlignCenter className="h-3 w-3" />
      </Button>
      <Button variant={align === 'right' ? 'secondary' : 'ghost'} size="icon" className="h-6 w-6" title="Align right" onClick={() => onChange({ align: 'right' } as Partial<Overlay>)}>
        <AlignRight className="h-3 w-3" />
      </Button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      <input
        type="color"
        value={colorValue}
        onChange={(e) => onChange({ color: e.target.value } as Partial<Overlay>)}
        title="Text colour"
        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </div>
  );
}
