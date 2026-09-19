-- Update the vownet-forms bucket to allow Excel and CSV file types
UPDATE storage.buckets 
SET allowed_mime_types = ARRAY[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  'text/csv',
  'application/octet-stream'
]
WHERE id = 'vownet-forms';