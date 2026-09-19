CREATE OR REPLACE FUNCTION public.claim_next_bulk_item(p_job_id uuid, p_worker text)
 RETURNS TABLE(id uuid, property_listing_id text, property_address text, attempts integer, report_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.bulk_generation_items b
  SET status = 'processing',
      claimed_at = now(),
      heartbeat_at = now(),
      worker_id = p_worker,
      attempts = b.attempts + 1,
      started_at = COALESCE(b.started_at, now())
  WHERE b.id = (
    SELECT i.id FROM public.bulk_generation_items i
    WHERE i.job_id = p_job_id AND i.status = 'pending'
    ORDER BY i.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING b.id, b.property_listing_id, b.property_address, b.attempts, b.report_id;
END;
$function$;