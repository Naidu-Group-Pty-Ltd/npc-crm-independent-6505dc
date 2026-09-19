UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
],
file_size_limit = GREATEST(COALESCE(file_size_limit, 0), 104857600)
WHERE id = 'qa_exports';