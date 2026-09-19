UPDATE storage.buckets 
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'text/csv',
  'text/csv;charset=utf-8',
  'text/csv; charset=utf-8',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream'
],
file_size_limit = 104857600
WHERE id = 'qa_exports';

UPDATE public.export_jobs
SET status = 'failed',
    error_summary = COALESCE(error_summary, 'Worker stalled — marked failed by maintenance migration'),
    updated_at = now()
WHERE status IN ('pending', 'processing')
  AND updated_at < now() - interval '5 minutes';