/**
 * The SVG inside a rendered chart figure.
 *
 * `chartFigure` emits the drawing as `<img src="data:image/svg+xml;base64,…">`
 * rather than inline, because that is the only form WeasyPrint tags as a
 * `/Figure` with `/Alt` — inline SVG lands under `/NonStruct` and is invisible
 * to a screen reader. See `charts.pure.ts`.
 *
 * That is right for the document and inconvenient for a test, because roughly
 * thirty specs assert on the drawing: that a negative total takes the negative
 * colour, that each bar prints its figure so the chart reads in monochrome,
 * that two holdings are scaled against one maximum. Those assertions are about
 * the SVG, and the SVG is still there — one base64 decode away.
 *
 * Decoding it here rather than weakening the assertions keeps the tests about
 * what they were always about, and keeps them failing for the reasons they
 * were written to fail for.
 */

/** The chart's SVG source, whether the figure carries it inline or encoded. */
export function chartSvg(html: string): string {
  const encoded = /src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]*)"/.exec(html);
  if (!encoded) return html;
  const binary = atob(encoded[1]);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  // The drawing carries em dashes and currency symbols, so it is UTF-8 rather
  // than latin1 — decoding it as bytes-to-characters would mangle a label the
  // moment a test asserted on one.
  const svg = new TextDecoder().decode(bytes);
  // Everything outside the figure — the caption, the surrounding markup — is
  // still worth asserting on, so it is kept beside the decoded drawing.
  return `${html.replace(encoded[0], '')}${svg}`;
}

/**
 * A chart function, with its drawing decoded.
 *
 * Wrapping the import rather than every call site: these specs call their
 * chart with three or four multi-line arguments, and wrapping thirty of those
 * is thirty chances to close a parenthesis in the wrong place.
 */
export function decodedChart<A extends unknown[]>(
  fn: (...args: A) => string,
): (...args: A) => string {
  return (...args: A) => chartSvg(fn(...args));
}

/**
 * A whole document, with every chart's drawing decoded in place.
 *
 * For the assertions whose subject is the document rather than one chart: that
 * every `font-family` in the file asks for a brand face first, that the
 * projection fan draws three named scenarios and not one line, that a chart
 * sits under the section that earned it rather than at the end of the chapter.
 *
 * Each of those reads the SVG through the document, and each would have gone
 * quietly green when the drawings moved into a base64 payload — which is the
 * failure mode worth avoiding here. An assertion that can no longer see its
 * subject does not fail; it passes.
 */
export function withDecodedCharts(html: string): string {
  return html.replace(
    /<img class="chart-img" src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]*)"[^>]*>/g,
    (_whole, payload: string) => new TextDecoder().decode(
      Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)),
    ),
  );
}
