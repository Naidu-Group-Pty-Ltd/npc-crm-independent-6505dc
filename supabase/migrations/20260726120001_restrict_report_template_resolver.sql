-- The resolver is SECURITY DEFINER and accepts scope identifiers supplied by
-- its caller. Keep it behind trusted Edge Functions so browser clients cannot
-- use arbitrary user or agency IDs to bypass the manage-templates permission
-- checks. Browser callers already fall back to manage-templates when this RPC
-- is unavailable to their role.
REVOKE EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_report_template(text, text, uuid, uuid)
  TO service_role;
