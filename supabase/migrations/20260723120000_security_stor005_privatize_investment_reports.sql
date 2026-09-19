-- =============================================================================
-- STOR-005: Privatize the investment-reports bucket
-- =============================================================================
--
-- ⚠️  STAGED MIGRATION — DO NOT APPLY UNTIL THE ACCOMPANYING CODE HAS SHIPPED ⚠️
--
-- investment-reports is a MIXED bucket: it holds sensitive report PDFs (full
-- client financial analysis) AND decorative hero/visual assets whose URLs are
-- resolved into reports at render time. Flipping it private immediately breaks
-- any consumer still reading its objects via getPublicUrl.
--
-- Apply this ONLY AFTER the following have deployed to prod:
--
--   Edge functions (Supabase deploy):
--     * render-investment-report-pdf -> loadHeroPlacements signs hero images
--       from storage_path (was public_url)
--     * hero-image-studio            -> generate/library_list/library_upload/
--       placements_list return signed URLs (withSignedHeroUrls)
--     * prepare-report-hero-images   -> status/list returns signed URLs
--     * secure-storage               -> investment-reports policy drops publicUrl
--     * render-template-pdf / get-portal-client-data -> already sign (STOR-004)
--
--   Frontend (Lovable publish):
--     * No change required — HeroImageStudio / HeroImagesDialog read hero URLs
--       exclusively through the above edge functions, which now hand back
--       signed URLs in the same public_url field.
--
-- PDFs are already served via short-lived signed URLs (render fns sign on
-- demand; get-portal-client-data re-signs legacy public/sign URLs for the
-- portal). Storage RLS on investment-reports is already service-role-only.
-- =============================================================================

UPDATE storage.buckets
SET public = false
WHERE id = 'investment-reports';
