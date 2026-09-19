import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { detectDocumentMime, MAX_LEGAL_DOCUMENT_BYTES, scanDocument, sha256Hex } from '../_shared/immutableDocuments.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

Deno.serve(async(req)=>{
  if(req.method!=='POST')return json({error:'method_not_allowed'},405);
  const secret=Deno.env.get('LEGAL_DOCUMENT_PROCESSOR_SECRET');
  if(!secret||req.headers.get('x-worker-secret')!==secret)return json({error:'unauthorised'},401);
  if(Deno.env.get('IMMUTABLE_DOCUMENTS_V2')!=='true')return json({error:'immutable_documents_disabled'},503);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!); const workerId=`legal-document-${crypto.randomUUID()}`;
  const {data:jobs,error}=await db.rpc('claim_document_processing_jobs',{_worker_id:workerId,_limit:10}); if(error)return json({error:'claim_failed'},500);
  let available=0,rejected=0,failed=0;
  for(const job of jobs||[]){
    let sha=''; let mime:string|null=null; let size=0; let status:'clean'|'infected'|'error'='error'; let provider='content_validation'; let reference:string|null=null; let details:Record<string,unknown>={}; let processingError:string|undefined;
    try {
      await db.from('document_versions').update({malware_scan_status:'scanning',lifecycle_status:'scanning',updated_at:new Date().toISOString()}).eq('id',job.version_id).in('malware_scan_status',['pending','error','legacy_unverified']);
      const {data:blob,error:downloadError}=await db.storage.from(job.storage_bucket).download(job.storage_path); if(downloadError||!blob)throw new Error('storage_download_failed');
      size=blob.size; if(size<1||size>MAX_LEGAL_DOCUMENT_BYTES)throw new Error('actual_size_out_of_range');
      const bytes=new Uint8Array(await blob.arrayBuffer()); sha=await sha256Hex(bytes); const detected=detectDocumentMime(bytes); mime=detected.mime;
      details={content_detection_reason:detected.reason||null,declared_mime_type:job.declared_mime_type,declared_byte_size:job.declared_byte_size,actual_byte_size:size};
      if(detected.executable)throw new Error('executable_content_rejected'); if(!mime)throw new Error(detected.reason||'mime_detection_failed');
      if(String(job.declared_mime_type||'').toLowerCase().split(';')[0].trim()!==mime)throw new Error('declared_mime_mismatch');
      const scan=await scanDocument(bytes,sha); status=scan.status;provider=scan.provider;reference=scan.reference;details={...details,...scan.details};processingError=scan.error;
      if(status==='clean')available++;else if(status==='infected')rejected++;else failed++;
    }catch(error){status='error';processingError=error instanceof Error?error.message:String(error);details={...details,validation_error:processingError};failed++;}
    await db.rpc('complete_document_processing',{_job_id:job.job_id,_worker_id:workerId,_sha256:sha,_detected_mime:mime,_byte_size:size,_scan_status:status,_scan_provider:provider,_scan_reference:reference,_scan_details:details,_error:processingError||null});
    const {data:scope}=await db.from('document_versions').select('document_records!inner(case_id,legal_matter_id)').eq('id',job.version_id).maybeSingle();const record=(scope as any)?.document_records;
    await db.rpc('record_portal_operational_event',{_event_name:status==='infected'?'document_malware_detected':status==='error'?'document_scan_failure':'document_scan_completed',_severity:status==='infected'?'critical':status==='error'?'warning':'info',_correlation_id:crypto.randomUUID(),_request_id:job.job_id,_actor_type:'worker',_actor_id:null,_portal:'document_processor',_case_id:record?.case_id||null,_matter_id:record?.legal_matter_id||null,_firm_id:null,_duration_ms:null,_success:status==='clean',_metadata:{document_version_id:job.version_id,scan_status:status,provider,error_code:processingError?.slice(0,120)||null}});
  }
  return json({claimed:(jobs||[]).length,available,rejected,failed});
});
