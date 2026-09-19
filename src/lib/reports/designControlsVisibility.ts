/**
 * Whether the report DESIGN controls are offered anywhere in the product.
 *
 * OFF. The design factor is not a feature we are exposing at this point in
 * time. Documents render from the house design and the saved systems that
 * already exist, so output is consistent for every operator and every client,
 * and nobody can hand a client a document tuned into something the brand has
 * not approved.
 *
 * ## What this one constant governs
 *
 *  1. the Premium PDF design controls on a report's Publishing & Export panel
 *     (`PremiumPdfDesignPanel` — visual preset, cover, chapter openings,
 *     tables, density, body size, visual intensity, drop caps, numbers,
 *     justification), and the "Design" section that frames them;
 *  2. authoring a brand design system from the Template Converter
 *     (`BrandDesignSystemDialog`, the "New design system" button, and the
 *     link out to the page below);
 *  3. the Brand systems page (`/admin/template-builder/brand-systems`) and its
 *     navigation entry.
 *
 * ## This is a hide, not a removal
 *
 * The renderer, the option contract and the whole `reportDesign` system are
 * untouched and still exercised. `PremiumPdfButton` still sends design options
 * to the Premium PDF renderer — they are simply always the defaults — and the
 * Template Converter still SELECTS from the design systems that already exist,
 * so conversion keeps working exactly as before. What is withdrawn is the
 * ability to tune or author a design, not the ability to render one.
 *
 * Turning all of it back on is this one constant, and nothing else.
 *
 * ## Why the switch rather than deleting the markup
 *
 * Deleting each surface would leave the next mount to rediscover the decision,
 * and two of the three are shared components, so "the next mount" is a
 * plausible accident rather than a hypothetical. Both components therefore
 * refuse to render themselves while this is false, and the surfaces that frame
 * them check the same constant so no chrome is drawn around nothing. The
 * routes stay declared — hiding is never deleting, so a bookmark still lands
 * on a page that explains itself rather than a 404.
 *
 * Typed `boolean` rather than the literal `false` deliberately: a literal would
 * narrow every guard to dead code, which reads as deletion to both the compiler
 * and the next person, and this is a setting rather than a removal.
 *
 * Pinned by `src/components/reports/__tests__/premiumPdfDesignHidden.test.tsx`.
 */
export const REPORT_DESIGN_CONTROLS_VISIBLE: boolean = false;
