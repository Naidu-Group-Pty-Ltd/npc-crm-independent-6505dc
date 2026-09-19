/**
 * ShadowStudio — visual elevation picker for the BlockStyle `shadow` preset.
 *
 * Renders a row of preview tiles for each preset (none / sm / md / lg / xl)
 * with the matching CSS box-shadow applied so the user can SEE the elevation,
 * rather than reading words from a Select dropdown.
 */
import { Label } from '@/components/ui/label';

export type ShadowPreset = 'none' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  value: ShadowPreset | undefined;
  onChange: (v: ShadowPreset | undefined) => void;
  label?: string;
}

// Mirror of the production WeasyPrint CSS shadow rules in htmlRenderer.
const SHADOW_CSS: Record<ShadowPreset, string> = {
  none: 'none',
  sm:   '0 1px 2px rgba(0,0,0,0.08)',
  md:   '0 4px 10px rgba(0,0,0,0.10)',
  lg:   '0 10px 24px rgba(0,0,0,0.14)',
  xl:   '0 20px 48px rgba(0,0,0,0.20)',
};

const PRESETS: ShadowPreset[] = ['none', 'sm', 'md', 'lg', 'xl'];

export function ShadowStudio({ value, onChange, label = 'Elevation' }: Props) {
  const active = (value ?? 'none') as ShadowPreset;
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{label}</Label>
      <div className="grid grid-cols-5 gap-1.5">
        {PRESETS.map((p) => {
          const isActive = active === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p === 'none' ? undefined : p)}
              className={`group flex flex-col items-center gap-1 rounded-md border p-1.5 transition-colors ${
                isActive ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'
              }`}
              title={`shadow: ${p}`}
            >
              <div
                className="h-8 w-full rounded-sm bg-card"
                style={{ boxShadow: SHADOW_CSS[p] }}
              />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {p}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
