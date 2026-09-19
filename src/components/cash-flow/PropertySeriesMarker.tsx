/**
 * The key beside a compared property's name — drawn as the line it actually is.
 *
 * Every surface that named a property in a comparison drew a filled dot in that
 * property's colour: the metrics table's column heads, the detail switcher, the
 * peer detail card. A dot can only ever say the colour, so once the chart's
 * five series stopped being told apart by hue alone (see `PROPERTY_LINE_STYLES`
 * in `lib/cashFlow/chartTheme`) a dot said less than the chart did — and a key
 * that carries less than the thing it is a key for is how a reader ends up
 * matching the wrong column to the wrong line.
 *
 * So the marker is a segment of the line: same colour, same dash pattern, same
 * cap. It also carries the pattern's NAME, because a marker that means nothing
 * to a screen reader and nothing in greyscale is a marker that only works for
 * the readers who were never in difficulty.
 */
import type { PropertyLineStyle } from '@/lib/cashFlow/chartTheme';

export interface PropertySeriesMarkerProps extends PropertyLineStyle {
  /** The resolved colour, already an `hsl(...)`/`#rrggbb` string. */
  colour: string;
  /**
   * Whose line this is, when the marker sits away from the name.
   *
   * Omit it where the name is adjacent — the accessible name then says only
   * what the pattern is, which is the part the text does not already carry.
   */
  label?: string;
  className?: string;
}

/**
 * 22×10, matching the legend swatch the chart draws.
 *
 * The dash array is in the same units as the chart's, so the marker and the
 * line are the same pattern rather than two patterns that resemble each other.
 */
export function PropertySeriesMarker({
  colour,
  dash,
  linecap,
  name,
  label,
  className,
}: PropertySeriesMarkerProps) {
  const description = label ? `${label}: ${name} line` : `${name} line`;
  return (
    <svg
      role="img"
      aria-label={description}
      width={22}
      height={10}
      viewBox="0 0 22 10"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
    >
      <title>{description}</title>
      <line
        x1={1}
        y1={5}
        x2={21}
        y2={5}
        stroke={colour}
        strokeWidth={2.5}
        strokeDasharray={dash}
        strokeLinecap={linecap ?? 'butt'}
      />
    </svg>
  );
}

export default PropertySeriesMarker;
