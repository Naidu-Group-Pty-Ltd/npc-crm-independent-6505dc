-- =============================================================================
-- STOR-004: Privatize sensitive storage buckets
-- =============================================================================
--
-- ⚠️  STAGED MIGRATION — DO NOT APPLY UNTIL THE ACCOMPANYING CODE HAS SHIPPED ⚠️
--
-- Flipping these buckets to `public = false` immediately breaks any client that
-- still reads their objects via anonymous `getPublicUrl` / direct download.
-- This migration must be applied ONLY AFTER the following have deployed to prod:
--
--   Frontend (Lovable publish):
--     * src/pages/portal/PortalDocuments.tsx        -> downloads client-files via
--                                                      get-portal-client-data
--                                                      (downloadFile action, signed URL)
--     * src/components/email/EmailAttachmentsList.tsx-> resolves email-attachments
--                                                      through secure-storage signed URLs
--                                                      (incl. legacy public-URL parsing)
--
--   Edge functions (Supabase deploy):
--     * get-portal-client-data   -> downloadFile action + legacy URL re-signing
--     * report-qa                -> qa_exports written as signed URLs (createSignedUrl)
--     * render-investment-report-pdf -> no longer falls back to getPublicUrl
--
-- After that code is live, apply this migration to close public read access.
--
-- NOTE: `investment-reports` is intentionally EXCLUDED here. Its public URLs are
-- embedded at rest in generated reports (hero_image_library.image_url,
-- report_visual_assets.public_url), so privatizing it requires either relocating
-- hero images to a dedicated public bucket or render-time signing of every
-- embedded asset. Tracked as a separate follow-up.
-- =============================================================================

UPDATE storage.buckets
SET public = false
WHERE id IN ('client-files', 'email-attachments', 'qa_exports');

-- Storage RLS on these buckets is already service-role-only (set in the
-- Phase 7 storage-hardening migrations), so no anon/authenticated policy grants
-- remain that could re-expose the objects. All reads now flow through edge
-- functions using the service-role client + short-lived signed URLs.
