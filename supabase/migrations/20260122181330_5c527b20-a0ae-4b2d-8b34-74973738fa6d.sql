-- Phase 7: Secure document_chunks only (confirmed to exist)

-- document_chunks
DROP POLICY IF EXISTS "Allow all for document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_select" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_insert" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_update" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_delete" ON public.document_chunks;

CREATE POLICY "document_chunks_service_role_select" ON public.document_chunks FOR SELECT TO service_role USING (true);
CREATE POLICY "document_chunks_service_role_insert" ON public.document_chunks FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "document_chunks_service_role_update" ON public.document_chunks FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "document_chunks_service_role_delete" ON public.document_chunks FOR DELETE TO service_role USING (true);