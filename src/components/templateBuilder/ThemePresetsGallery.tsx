/**
 * ThemePresetsGallery — one-click brand / design-system theme presets for the
 * Tokens tab.
 *
 * Extracted from TemplateBuilderEdit (rehaul Phase 2 / file split).
 */
import { Wand2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { THEME_PRESETS } from '@/lib/reportTemplate/themePresets';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

export function ThemePresetsGallery({
  activeTokens,
  onApply,
}: {
  activeTokens: ReportTemplate['tokens'];
  onApply: (presetId: string) => void;
}) {
  // Identify the closest preset (matches by primary + bg colour)
  const activeId = (() => {
    const p = activeTokens.colors?.primary;
    const b = activeTokens.colors?.bg;
    return THEME_PRESETS.find((t) => t.tokens.colors.primary === p && t.tokens.colors.bg === b)?.id ?? null;
  })();

  return (
    <section className="border-b pb-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Theme presets
          </Label>
          <p className="text-xs text-muted-foreground mt-1">
            One-click brand and design-system identities (Material, Fluent, Bootstrap, Ant Design included). Applies colors, fonts, spacing, radii, shadows, and Google font faces on top of the existing token map.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {THEME_PRESETS.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onApply(p.id)}
              className={`text-left rounded-md border p-2.5 transition-colors hover:border-primary/60 ${
                isActive ? 'border-primary ring-1 ring-primary' : 'border-border'
              }`}
              title={p.description}
            >
              <div className="flex gap-1 mb-2">
                {p.swatch.map((c) => (
                  <span key={c} className="h-5 flex-1 rounded-sm border border-border/40" style={{ background: c }} />
                ))}
              </div>
              <div className="text-xs font-medium leading-tight">{p.label}</div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{p.description}</div>
              {isActive && (
                <div className="mt-1.5 text-[9px] uppercase tracking-wider text-primary font-semibold">Active</div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
