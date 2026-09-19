/**
 * Listing image model — client-side entry point.
 *
 * The implementation lives in `supabase/functions/_shared/listingImages.pure.ts`
 * because both runtimes need exactly the same answers: the browser decides what
 * to render and when a signed URL has gone stale, while the edge function uses
 * the same identity, fingerprint and refresh rules to decide what to download.
 * Two copies of that logic would drift, and the first symptom would be the
 * library re-harvesting every photo on every pass.
 *
 * Re-exported rather than re-implemented, which is the convention the repo
 * already uses for `_shared/*.pure` modules.
 */
export * from '../../supabase/functions/_shared/listingImages.pure';
