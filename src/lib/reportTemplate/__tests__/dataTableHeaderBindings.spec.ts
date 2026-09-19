/**
 * A `data-table` resolves bindings in its column headers.
 *
 * ## Why this needed a test of its own
 *
 * Every cell in the body went through `resolveBindable`. The headers did not —
 * they were emitted verbatim — so a template that bound one printed a literal
 * `{{cashFlowComparison.properties.0.shortAddress}}` across the top of the
 * table, on a client's page.
 *
 * It survived because **no format bound a header until the seventh**. The other
 * six all name their columns statically — "Year", "Property value", "Balance" —
 * and a comparison is the first document whose column headings are data: one
 * property per column, each headed by its own address.
 *
 * That also makes it the one binding defect in this programme that is *visible*
 * rather than silent. An unresolved binding elsewhere renders as the empty
 * string; this one renders as its own source code.
 *
 * Both renderers had the same defect and both are fixed, so both are asserted.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';

const TOKENS = { colors: {}, fonts: {}, spacing: {} };

function schemaWith(headers: string[]) {
  return {
    version: 1 as const,
    name: 'Header bindings',
    tokens: TOKENS,
    pages: [{
      id: 'p1',
      name: 'Page',
      size: { width: 595, height: 842 },
      background: { color: '#ffffff' },
      blocks: [{
        id: 'b1',
        type: 'data-table',
        props: {
          headers,
          rows: [{ cells: ['{{sample.row}}', '1', '2'] }],
          x: 40, y: 40, width: 515,
        },
        overlays: [],
      }],
    }],
  };
}

const DATA = {
  sample: { row: 'A row cell' },
  properties: [
    { shortAddress: 'Marlborough Street, Leichhardt' },
    { shortAddress: 'Wardell Road, Dulwich Hill' },
  ],
};

describe('data-table column headers', () => {
  it('resolves a bound header instead of printing its source', () => {
    const { html } = renderTemplateToHtml(
      schemaWith(['Measure', '{{properties.0.shortAddress}}', '{{properties.1.shortAddress}}']) as any,
      { data: DATA },
    );
    // Cased as stored: the uppercasing is `text-transform` in the style, so
    // the markup carries the address exactly as the projection published it.
    expect(html).toContain('Marlborough Street, Leichhardt');
    expect(html).toContain('Wardell Road, Dulwich Hill');
    expect(html).not.toContain('{{');
  });

  it('leaves a static header exactly as it was', () => {
    // The common case, and the one every other format uses. This must not have
    // moved: `resolveBindable` returns a string with no `{{` untouched.
    const { html } = renderTemplateToHtml(
      schemaWith(['Year', 'Property value', 'Balance']) as any,
      { data: DATA },
    );
    expect(html).toContain('Property value');
    expect(html).toContain('Balance');
  });

  it('renders an unresolvable header as empty, not as its own source', () => {
    // Consistent with every other binding in the renderer: absent is blank.
    const { html } = renderTemplateToHtml(
      schemaWith(['Measure', '{{nothing.here}}']) as any,
      { data: DATA },
    );
    expect(html).not.toContain('{{');
    expect(html).not.toContain('nothing.here');
  });

  it('applies a filter in a header, as a cell would', () => {
    const { html } = renderTemplateToHtml(
      schemaWith(['Measure', '{{properties.0.shortAddress | upper}}']) as any,
      { data: DATA },
    );
    expect(html).toContain('MARLBOROUGH STREET, LEICHHARDT');
  });
});
