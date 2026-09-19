/**
 * Bridge — the implementation lives with the Edge Functions.
 *
 * Turning a brand snapshot into the shapes a renderer takes. Written for the
 * Borrowing Capacity Snapshot and never format-specific: it reads a snapshot
 * and returns a palette, a company block, a masthead and a lockup, none of
 * which know what document they are about. The Cash Flow projection needs
 * exactly the same thing, so it lives here rather than beside one format.
 * Nothing may be added here; see `__tests__/designSystemSourceOfTruth.spec.ts`.
 */
export * from '../../../supabase/functions/_shared/reportDesign/documentBrand.pure.ts';
