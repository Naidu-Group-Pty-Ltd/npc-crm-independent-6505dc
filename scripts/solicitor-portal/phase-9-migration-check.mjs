import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/20260730250000_immutable_document_service_phase9.sql','utf8');
for(const token of ['document_records','document_versions','document_access_grants','document_processing_jobs','document_download_audit','guard_immutable_document_version','request_document_version','complete_document_processing','authorize_document_download','record_document_download','legal_hold','legacy_unverified','FOR UPDATE SKIP LOCKED'])if(!sql.includes(token))throw new Error(`Missing ${token}`);
if(/DELETE FROM public\.(document_versions|legal_matter_documents)/i.test(sql))throw new Error('Phase 9 must not delete document evidence');
console.log('Phase 9 migration contract passed');
