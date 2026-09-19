/**
 * The ink a cash-flow figure takes from its sign.
 *
 * Every negative figure in the 10-Year Projection Overview rendered as WHITE
 * — the Pre-Tax and After-Tax cash flows and the Net Profit/Loss, on screen,
 * in both themes. The five rows carried `text-destructive-foreground`, and
 * that token is not "the destructive colour": `--destructive-foreground` is
 * the ink for text sitting ON a solid `bg-destructive` fill, and it is
 * `0 0% 100%` in the light block AND in the dark one. Measured in Chromium
 * against the compiled stylesheet:
 *
 *   text-destructive-foreground → rgb(255, 255, 255)   (both themes)
 *   text-destructive            → rgb(239,  67,  67)   (both themes)
 *
 * So the loss figures were painted the same colour as the ordinary ones, and
 * the one thing the table exists to show — which years cost the client money
 * — was the one thing it stopped showing. `--success-foreground` is white on
 * both sides too, so the positive half of the same expression was equally
 * silent wherever it was reached.
 *
 * The two documents this screen exports never lost it, and they are what this
 * restores the screen to agreeing with: the PDF writes negatives in
 * `#B91C1C` and the HTML export in `#dc2626`, on exactly these rows. A client
 * reading the report saw red; the person who produced it did not.
 *
 * The rule, then: **a figure coloured by its sign takes the semantic token,
 * never its `-foreground` twin.** `-foreground` belongs on a solid fill of
 * the matching colour and nowhere else — the same trap that made an AML risk
 * badge render as an empty pill (`src/lib/aml/caseDimensions.ts`) and a deal
 * stage number unreadable (`src/components/deals/DealExecutiveSummary.tsx`).
 *
 * These are named here, once, rather than spelled at each call site, because
 * nine call sites in one 6,600-line file is how nine of them came to be
 * wrong together.
 */

/** A figure at or above zero. Green. */
export const POSITIVE_FIGURE_INK = 'text-success';

/** A figure below zero. Red — this is the token that carries the meaning. */
export const NEGATIVE_FIGURE_INK = 'text-destructive';

/**
 * The ink for a figure, from its value. Zero reads as positive, which is what
 * every call site did before and what the exports do: only a value that is
 * actually below zero is a loss.
 */
export const signedFigureInk = (value: number): string =>
  value < 0 ? NEGATIVE_FIGURE_INK : POSITIVE_FIGURE_INK;
