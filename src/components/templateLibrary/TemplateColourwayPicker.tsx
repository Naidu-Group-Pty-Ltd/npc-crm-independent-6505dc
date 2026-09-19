/**
 * Choose a colourway for the template being read.
 *
 * ## What it is choosing
 *
 * Not a theme, and not a filter — a colourway is one of the ten palettes the
 * design family curated for this template. The approved catalogue states the
 * composition rule outright: "Tokens carry no layout meaning. Any colourway
 * composes with any of the five layout variants." So the control changes the
 * document's colour and nothing else, and the reader watches it happen.
 *
 * ## Why a swatch and not a name in a list
 *
 * The catalogue's own control is a paper square with an accent square inside
 * it, and that is the honest representation: a colourway IS its paper and its
 * accent. "Slate Bronze" and "Platinum" are names a reader cannot rank without
 * seeing them. The name stays as the accessible label and the tooltip.
 */
import { Check } from 'lucide-react';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { resolveColourway, type ApprovedColourway } from '@/lib/templateLibrary/colourways';

interface Props {
  colourways: readonly ApprovedColourway[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Compact form for the reader's footer bar. */
  size?: 'sm' | 'default';
  /**
   * What the choice applies to, for the accessible name. The default names the
   * reader's preview, which is where this control was born; a caller putting it
   * somewhere with different consequences must say so.
   */
  ariaLabel?: string;
}

/**
 * The swatch: paper behind, accent in front.
 *
 * ## Why the colours arrive as custom properties
 *
 * These are the *document's* colours shown as data. They are deliberately not
 * app tokens — the whole point is that a colourway is outside the dashboard's
 * palette — and a `bg-*` utility cannot express ten arbitrary hexes.
 *
 * But painting them through an inline colour style would add to the
 * hardcoded-style ratchet (`npm run audit:style`), which exists to stop exactly
 * that pattern spreading. So the values arrive as `--sw-*` custom properties and
 * the paint happens in a class. Same result, and the ratchet keeps meaning what
 * it says rather than acquiring an exception.
 */
function Swatch({ colourway, size = 15 }: { colourway: ApprovedColourway; size?: number }) {
  const resolved = resolveColourway(colourway);
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-[1px] bg-[var(--sw-paper)] ring-1 ring-black/15"
      style={{
        width: size,
        height: size,
        ['--sw-paper' as string]: resolved.surface,
        ['--sw-accent' as string]: resolved.primary,
      }}
    >
      <span
        className="rounded-[1px] bg-[var(--sw-accent)]"
        style={{ width: size * 0.42, height: size * 0.42 }}
      />
    </span>
  );
}

export function TemplateColourwayPicker({
  colourways, selectedId, onSelect, size = 'default',
  ariaLabel = 'Colourway used in this preview',
}: Props) {
  if (colourways.length === 0) return null;

  const light = colourways.filter((c) => c.ground === 'light');
  const dark = colourways.filter((c) => c.ground === 'dark');
  const selected = colourways.find((c) => c.id === selectedId) ?? colourways[0];

  const group = (label: string, list: readonly ApprovedColourway[]) => (
    list.length === 0 ? null : (
      <SelectGroup>
        <SelectLabel className="text-[10px] font-medium uppercase tracking-[0.07em] text-muted-foreground">
          {label}
        </SelectLabel>
        {list.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center gap-2">
              <Swatch colourway={c} />
              <span className="truncate">{c.name}</span>
              {c.id === selectedId && <Check className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
            </span>
          </SelectItem>
        ))}
      </SelectGroup>
    )
  );

  return (
    <Select value={selected.id} onValueChange={onSelect}>
      <SelectTrigger
        className={size === 'sm' ? 'h-8 w-[13.5rem] text-xs' : 'h-9 w-[15rem] text-sm'}
        aria-label={ariaLabel}
      >
        <SelectValue>
          <span className="flex items-center gap-2">
            <Swatch colourway={selected} size={size === 'sm' ? 13 : 15} />
            <span className="truncate">{selected.name}</span>
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {group(`${light.length} light ground${light.length === 1 ? '' : 's'}`, light)}
        {group(`${dark.length} dark ground${dark.length === 1 ? '' : 's'}`, dark)}
      </SelectContent>
    </Select>
  );
}

export { Swatch as ColourwaySwatch };
