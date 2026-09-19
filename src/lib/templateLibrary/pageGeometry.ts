/**
 * Page geometry shared between the document preview and the reader.
 *
 * Lives outside the component files so both can import it without either one
 * exporting non-components — and so the reader's scroll maths and the
 * preview's render maths can never drift apart.
 */

/** CSS points to CSS pixels. Browsers fix this at 96dpi. */
export const PT_TO_PX = 96 / 72;

/** Gutter drawn between stacked pages, in points. */
export const PAGE_GUTTER_PT = 20;

/** The page box in points, defaulting to A4 when a schema does not say. */
export function pageGeometry(schema: unknown): { w: number; h: number } {
  const first = (schema as { pages?: Array<{ size?: { width?: number; height?: number } }> })
    ?.pages?.[0];
  return {
    w: Number(first?.size?.width) || 595,
    h: Number(first?.size?.height) || 842,
  };
}
