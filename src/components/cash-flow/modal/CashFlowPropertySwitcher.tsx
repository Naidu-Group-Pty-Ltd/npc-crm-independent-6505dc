/**
 * Which property's inputs and projection the detail section is showing.
 *
 * The ten-year projection and the inputs that drive it sat at the very bottom
 * of the page and existed only for the report the adviser had open. Once a
 * comparison is running, the question "what assumptions is 28 Bligh Street
 * actually on?" has no answer anywhere on the screen — the peer contributes a
 * line to every chart and a column to every table, and its own figures are
 * unreachable.
 *
 * So the section is addressed rather than scrolled to: one control, the open
 * report first and named as such, each comparison basis after it.
 */
import { Building2, Home, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { PropertySeriesMarker } from '@/components/cash-flow/PropertySeriesMarker';
import type { PropertyLineStyle } from '@/lib/cashFlow/chartTheme';

export interface SwitcherProperty extends Partial<PropertyLineStyle> {
  id: string;
  address: string;
  /** The colour this property is drawn in on every chart above. */
  colour: string;
  /** True for the report the adviser opened; it is the only editable one. */
  isPrimary: boolean;
}

export interface CashFlowPropertySwitcherProps {
  properties: SwitcherProperty[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** The street line, which is what distinguishes two properties at a glance. */
function streetOf(address: string): string {
  return address.split(',')[0]?.trim() || address;
}

export function CashFlowPropertySwitcher({
  properties,
  selectedId,
  onSelect,
}: CashFlowPropertySwitcherProps) {
  // With nothing to compare against there is nothing to switch between, and a
  // one-button switcher is furniture.
  if (properties.length < 2) return null;

  return (
    <div className="space-y-2.5 rounded-2xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Property details
          </p>
          <p className="text-xs text-muted-foreground">
            Inputs and the ten-year projection, for whichever property you are looking at.
          </p>
        </div>
        <Badge variant="outline" className="rounded-full text-[11px] font-normal">
          {properties.length} in this comparison
        </Badge>
      </div>

      <div
        role="tablist"
        aria-label="Choose which property's details to show"
        className="flex flex-wrap gap-2"
      >
        {properties.map((property) => {
          const selected = property.id === selectedId;
          return (
            <button
              key={property.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(property.id)}
              className={`group flex min-h-9 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-all duration-200 ${
                selected
                  ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                  : 'border-border/60 bg-background/60 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/40'
              }`}
            >
              {/* The key is the line, not a dot: the charts above separate
                  five properties by pattern as well as by hue, and a dot can
                  only ever repeat half of that. */}
              <PropertySeriesMarker
                colour={property.colour}
                dash={property.dash}
                linecap={property.linecap}
                name={property.name ?? 'solid'}
              />
              {property.isPrimary
                ? <Home className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                : <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="max-w-[190px] truncate font-medium">{streetOf(property.address)}</span>
              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                {property.isPrimary ? 'this report' : 'comparison'}
              </span>
              {!property.isPrimary && (
                <Lock
                  className="h-3 w-3 shrink-0 text-muted-foreground/70"
                  aria-label="Read-only"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
