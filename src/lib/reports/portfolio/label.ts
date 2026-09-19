/**
 * What this report is called, everywhere a person can read it.
 *
 * Audit item 11 — the same report was called three different things, and two
 * of them appeared on screens a client sees:
 *
 *   Client portal → Request a report        "Portfolio Performance Review"
 *   Clients → a client → Reports            "Portfolio Analysis"
 *   Clients → a client → Sent Reports       "Portfolio Review"
 *
 * `PortalReports.tsx` managed two of the three by itself, in adjacent maps.
 *
 * A label repeated as a literal at fourteen call sites is a label that will
 * diverge again, so it is named once here and imported. `portfolioLabel.spec.ts`
 * fails any UI file that spells a variant.
 *
 * SCOPE — this is the product's name for the report, not the document's own
 * title. The rendered PDF is still headed "Portfolio Performance Review",
 * which is its formal name on the fifty Investment Compass template masters,
 * in the seeded catalogue and in `render-portfolio-review-pdf`. Changing that
 * is a template-library regeneration rather than a label change, so it is
 * deliberately left alone and called out rather than done quietly here.
 *
 * Stored values are untouched: `portfolio_review`, `portfolio` and `review`
 * are still what the database holds and what every query matches on. Only
 * what is drawn changes.
 */
export const PORTFOLIO_REPORT_LABEL = 'Portfolio Analysis';
