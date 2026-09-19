/**
 * TextRhythmControl — sliders for line-height + letter-spacing + a live
 * "AaBbCc" preview ribbon that uses the overlay's current font + size so
 * designers see exactly what their rhythm changes look like.
 *
 * Optional `transform` / `decoration` dropdowns expose the schema fields
 * that are otherwise hidden in the bare TypographyPanel.
 */
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface TextRhythmValue {
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | 'small-caps';
  textDecoration?: 'none' | 'underline' | 'line-through' | 'overline';
}

interface Props {
  value: TextRhythmValue;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  onChange: (patch: TextRhythmValue) => void;
}

export function TextRhythmControl({ value, fontFamily, fontSize, color, onChange }: Props) {
  const lh = Number.isFinite(value.lineHeight) ? (value.lineHeight as number) : 1.3;
  const ls = Number.isFinite(value.letterSpacing) ? (value.letterSpacing as number) : 0;
  const tt = value.textTransform ?? 'none';
  const td = value.textDecoration ?? 'none';

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border bg-muted/20 px-2 py-3 text-center">
        <div
          style={{
            fontFamily: fontFamily || 'inherit',
            fontSize: fontSize ? `${Math.min(28, Math.max(10, fontSize))}pt` : '14pt',
            lineHeight: lh,
            letterSpacing: `${ls}px`,
            textTransform: (tt === 'small-caps' ? 'none' : tt) as any,
            fontVariant: tt === 'small-caps' ? 'small-caps' : undefined,
            textDecoration: td,
            color: /^#|^rgb|^hsl/.test(String(color || '')) ? color : undefined,
          }}
        >
          AaBbCc 123
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">Live rhythm preview</div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[11px]">Line height</Label>
          <span className="text-[10px] text-muted-foreground tabular-nums">{lh.toFixed(2)}</span>
        </div>
        <Slider value={[lh]} min={0.8} max={2.4} step={0.05} onValueChange={([v]) => onChange({ lineHeight: v })} />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[11px]">Letter spacing</Label>
          <span className="text-[10px] text-muted-foreground tabular-nums">{ls.toFixed(1)} px</span>
        </div>
        <Slider value={[ls]} min={-2} max={12} step={0.1} onValueChange={([v]) => onChange({ letterSpacing: v })} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[11px]">Transform</Label>
          <Select value={tt} onValueChange={(v) => onChange({ textTransform: v as any })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">none</SelectItem>
              <SelectItem value="uppercase">UPPERCASE</SelectItem>
              <SelectItem value="lowercase">lowercase</SelectItem>
              <SelectItem value="capitalize">Capitalize</SelectItem>
              <SelectItem value="small-caps">Small Caps</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">Decoration</Label>
          <Select value={td} onValueChange={(v) => onChange({ textDecoration: v as any })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">none</SelectItem>
              <SelectItem value="underline">underline</SelectItem>
              <SelectItem value="line-through">line-through</SelectItem>
              <SelectItem value="overline">overline</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
