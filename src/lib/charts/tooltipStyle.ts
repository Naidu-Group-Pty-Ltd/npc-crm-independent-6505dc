/**
 * The one style a Recharts tooltip is drawn with.
 *
 * ## The defect this exists for
 *
 * Recharts' `DefaultTooltipContent` bakes `whiteSpace: 'nowrap'` into its own
 * style object and merges `contentStyle` over the top. Nothing in this
 * codebase ever overrode it — 46 `contentStyle` objects across 14 files, and
 * **zero** `whiteSpace` among them — so every tooltip in the product renders
 * its label on one unbreakable line. That fails two different ways depending
 * on whether the call site happened to set a width:
 *
 *   - **With `maxWidth`** the box is clamped and the label is not, so the text
 *     runs out through the right-hand border and prints on the page behind it.
 *     True ROI — Cost Per Acquisition, whose campaign names look like
 *     `7 Property in 7 years | Lean Agency | LA - AU | 13.10.25 | Quiz Funnel
 *     | JH`, is the reported case (Audit 4 item 10): a 356px box with 435px of
 *     text in it.
 *   - **Without one** the box grows to the label's full width instead, past
 *     the chart's container, and an ancestor's `overflow` cuts the name off —
 *     which is Audit 4 item 5 on the call-logs agent-performance chart,
 *     reported as "a cutoff in the name … It has all the space to display the
 *     full name".
 *
 * One property is the whole cure, and a width is what makes it bite: with
 * wrapping ON the box can never be wider than `maxWidth`, so it cannot grow
 * into an ancestor's clip, and the label can never be wider than the box, so
 * it cannot spill. `overflowWrap: 'anywhere'` covers the remaining case — a
 * single unbroken token longer than the box, which has no space to break at.
 *
 * ## Why it is a module
 *
 * Because the rule was absent from all 46 of them. A style written at each
 * call site is a style that is right in the one place somebody looked, and
 * this class of defect has now been reported on two separate charts in two
 * separate audits.
 */

/**
 * The surface itself, from the semantic tokens and never a literal.
 *
 * These values are the marketing panels' own — the shape three of the four
 * already drew. `ForecastPanel` and `ClientAnalyticsDashboard` each held a
 * PRIVATE `chartTooltipStyle` const with the same intent, and the two had
 * already drifted apart: different radii, different shadows, and one built on
 * a raw `rgba()` rather than a token. Neither was exported, so neither could
 * be the answer for anybody else.
 */
const SURFACE = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 14,
  boxShadow: '0 18px 50px hsl(var(--foreground) / 0.12)',
  color: 'hsl(var(--popover-foreground))',
} as const;

/**
 * The default. `maxWidth` is deliberately generous — a tooltip that wraps a
 * long name over three lines is legible, one that wraps every label over three
 * lines is not.
 */
export const chartTooltipContentStyle: React.CSSProperties = {
  ...SURFACE,
  fontSize: 12,
  maxWidth: 320,
  // The two that matter. See this file's header.
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
};

/**
 * The same style with a different cap, for a chart whose labels are known to
 * be long (campaign names, full agent names) or known to be short.
 *
 * Takes the width rather than the whole style so a call site cannot quietly
 * drop the wrapping rule while overriding the size — which is exactly how the
 * one `maxWidth: 320` in the product came to exist without it.
 */
export function chartTooltipContentStyleWithin(maxWidth: number): React.CSSProperties {
  return { ...chartTooltipContentStyle, maxWidth };
}

/**
 * Keeps a tooltip above the chart's own layers.
 *
 * Recharts renders the tooltip as a sibling of the SVG, so a panel that
 * establishes a stacking context can otherwise draw over it.
 */
export const chartTooltipWrapperStyle: React.CSSProperties = { zIndex: 50 };

/**
 * The wrapper a chart legend is drawn in.
 *
 * ## Why there is no `height`
 *
 * Recharts' `<Legend>` takes a `height` prop that becomes a hard `height` on
 * its absolutely-positioned wrapper, and the chart reserves exactly that much
 * room. It is safe only when the number of entries is fixed.
 *
 * The call-logs Call Outcomes pie draws one entry per DISTINCT outcome — 17 of
 * them on the reported account, with labels like `Call.in Progress.error
 * Providerfault Eleven Labs 500 Server Error` — and carried `height={48}`,
 * copied from the four-entry sentiment pie beside it. Measured in Chromium at
 * 700px: the legend's real content is **87px**, the wrapper was pinned to 48,
 * and the last row's bottom landed 33px below the container, which clips it.
 * That is Audit 4 item 5, "the labels/legend under the pie chart has a cutoff
 * at the bottom". With the prop removed the wrapper measures `auto` at 87px,
 * the chart reserves it, and the last row sits 6px inside the box.
 *
 * So: no height. The legend measures itself and the chart makes room.
 */
export const chartLegendWrapperStyle: React.CSSProperties = {
  color: 'hsl(var(--muted-foreground))',
  fontSize: 12,
};
