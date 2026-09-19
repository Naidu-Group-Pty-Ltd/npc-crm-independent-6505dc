import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyPortalSession } from '../_shared/requestSecurity.ts';

const WORKSPACE_ENABLED = Deno.env.get('CLIENT_LEGAL_WORKSPACE') === 'true';
const IMMUTABLE_DOCUMENTS = Deno.env.get('IMMUTABLE_DOCUMENTS_V2') === 'true';
const json = (body: unknown, status: number, headers: Record<string,string>) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
const hashTelemetry = async (value: string | null) => value ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('') : null;
const safeDocument = (entry:any) => ({
  id:entry.record.id,case_id:entry.record.case_id,category:entry.record.category,title:entry.record.title,
  description:entry.record.description,owner:entry.record.owner,due_date:entry.record.due_date,status:entry.record.logical_status,row_version:entry.record.row_version,
  current_version:entry.version?{id:entry.version.id,version_number:entry.version.version_number,filename:entry.version.original_filename,mime_type:entry.version.detected_mime_type,byte_size:entry.version.byte_size,sha256:entry.version.sha256,lifecycle_status:entry.version.lifecycle_status,reviewed_at:entry.version.reviewed_at}:null,
  updated_at:entry.record.updated_at,
});

Deno.serve(async req => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  if(req.method!=='POST') return json({success:false,error:'Method not allowed'},405,cors);
  if(!WORKSPACE_ENABLED) return json({success:false,error:'Not found'},404,cors);
  try {
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body=await req.json().catch(()=>({}));
    const token=req.headers.get('x-portal-session-token')||body.portal_session_token||body.session_token;
    const auth=await verifyPortalSession(db,token); if(!auth.ok||!auth.actorId||!auth.clientId)return json({success:false,error:'Authentication required'},401,cors);
    const actorId=auth.actorId,clientId=auth.clientId,operation=String(body.operation||'list_cases');
    const loadCase=async(caseId:string)=>{const {data}=await db.from('client_case_read_model').select('case_id,client_id,legal_matter_id,matter_reference,friendly_status,shared_summary,property_address,settlement_date,next_client_action,practice_name,practice_email,practice_phone,solicitor_name,solicitor_email,source_version,updated_at').eq('case_id',caseId).eq('client_id',clientId).maybeSingle();return data;};

    if(operation==='list_cases'){
      const {data,error}=await db.from('client_case_read_model').select('case_id,matter_reference,friendly_status,shared_summary,property_address,settlement_date,next_client_action,practice_name,solicitor_name,source_version,updated_at').eq('client_id',clientId).order('updated_at',{ascending:false});if(error)throw error;
      return json({success:true,cases:data||[]},200,cors);
    }

    const caseId=String(body.case_id||''); if(!caseId)return json({success:false,error:'case_id is required'},400,cors);
    const legalCase=await loadCase(caseId);if(!legalCase)return json({success:false,error:'Not found'},404,cors);

    if(operation==='get_workspace'){
      const [{data:runway,error:runwayError},{data:documentRows,error:documentError},{data:conversationRows,error:conversationError},{data:activity,error:activityError},{data:acks,error:ackError}]=await Promise.all([
        db.rpc('get_case_runway',{_case_id:caseId,_audience:'client'}),
        IMMUTABLE_DOCUMENTS?db.rpc('list_accessible_documents',{_case_id:caseId,_audience:'client',_grantee_id:actorId}):Promise.resolve({data:[],error:null}),
        db.rpc('get_participant_conversations',{_participant_type:'client_user',_participant_id:actorId,_case_id:caseId}),
        db.from('client_case_activity_read_model').select('id,activity_type,title,summary,occurred_at').eq('case_id',caseId).eq('client_id',clientId).order('occurred_at',{ascending:false}).limit(20),
        db.from('client_document_acknowledgements').select('document_version_id,acknowledgement_type,acknowledged_at').eq('case_id',caseId).eq('client_portal_user_id',actorId),
      ]);if(runwayError||documentError||conversationError||activityError||ackError)throw runwayError||documentError||conversationError||activityError||ackError;
      const documents=(documentRows||[]).filter((entry:any)=>entry.version?.malware_scan_status==='clean'&&['reviewed','retained','legal_hold'].includes(entry.version?.lifecycle_status)).map(safeDocument);
      const uploadRequests=(documentRows||[]).filter((entry:any)=>entry.record?.owner==='client'&&['requested','upload_pending'].includes(entry.record?.logical_status)).map((entry:any)=>({id:entry.record.id,case_id:entry.record.case_id,title:entry.record.title,description:entry.record.description,category:entry.record.category,due_date:entry.record.due_date,row_version:entry.record.row_version,status:entry.record.logical_status}));
      const conversations=[];for(const entry of (conversationRows||[]).filter((entry:any)=>entry.conversation?.scope==='client_solicitor')){const {data:messages}=await db.rpc('get_conversation_messages',{_conversation_id:entry.conversation.id,_participant_type:'client_user',_participant_id:actorId,_limit:100,_before:null});conversations.push({id:entry.conversation.id,subject:entry.conversation.subject,unread_count:entry.unread_count,messages:(messages||[]).map((m:any)=>({id:m.id,sender_type:m.sender_type,sender_name:m.sender_name,body:m.body,reply_to_message_id:m.reply_to_message_id,created_at:m.created_at}))});}
      const milestones=(runway?.milestones||[]).map((m:any)=>({id:m.id,milestone_type:m.milestone_type,title:m.title,due_at:m.due_at,status:m.status,owner_type:m.owner_type,row_version:m.row_version}));
      const actions=(runway?.tasks||[]).filter((task:any)=>task.status!=='not_applicable').map((task:any)=>({id:task.id,label:task.label,description:task.description,status:task.status,due_at:task.due_at,completed_at:task.completed_at,owner_domain:task.owner_domain,row_version:task.row_version}));
      return json({success:true,workspace:{case:legalCase,milestones,actions,documents,upload_requests:uploadRequests,document_acknowledgements:acks||[],conversations,activity:activity||[]}},200,cors);
    }

    if(operation==='reply'){
      const conversationId=String(body.conversation_id||''),message=String(body.message||'').trim();if(!conversationId||!message)return json({success:false,error:'conversation_id and message are required'},400,cors);
      const {data:conversation}=await db.from('conversations').select('id').eq('id',conversationId).eq('case_id',caseId).eq('scope','client_solicitor').maybeSingle();if(!conversation)return json({success:false,error:'Not found'},404,cors);
      const {data,error}=await db.rpc('post_conversation_message',{_conversation_id:conversationId,_actor_type:'client_user',_actor_id:actorId,_body:message,_idempotency_key:String(body.idempotency_key||`client-legal:${actorId}:${crypto.randomUUID()}`),_sender_name:'Client',_reply_to:body.reply_to_message_id||null});if(error)return json({success:false,error:error.message},/ACCESS_DENIED/.test(error.message||'')?403:400,cors);return json({success:true,message:data},200,cors);
    }

    if(operation==='download_document'){
      const recordId=String(body.document_record_id||'');const {data:authorized,error}=await db.rpc('authorize_document_download',{_document_record_id:recordId,_document_version_id:body.document_version_id||null,_audience:'client',_grantee_id:actorId});if(error)throw error;if(!authorized||authorized.record?.case_id!==caseId)return json({success:false,error:'Not found'},404,cors);
      const version=authorized.version;const {data:signed,error:signError}=await db.storage.from(version.storage_bucket).createSignedUrl(version.storage_path,300,{download:version.original_filename});if(signError)throw signError;const correlationId=crypto.randomUUID();await db.rpc('record_document_download',{_document_record_id:recordId,_document_version_id:version.id,_actor_type:'client_user',_actor_id:actorId,_audience:'client',_ip_hash:await hashTelemetry(req.headers.get('x-forwarded-for')),_user_agent_hash:await hashTelemetry(req.headers.get('user-agent')),_correlation_id:correlationId});return json({success:true,url:signed?.signedUrl||null,filename:version.original_filename,version_id:version.id,sha256:version.sha256},200,cors);
    }

    if(operation==='acknowledge_document'){
      const correlationId=crypto.randomUUID();const {data,error}=await db.rpc('acknowledge_client_document',{_case_id:caseId,_document_record_id:String(body.document_record_id||''),_document_version_id:String(body.document_version_id||''),_client_user_id:actorId,_acknowledgement_type:String(body.acknowledgement_type||'received'),_ip_hash:await hashTelemetry(req.headers.get('x-forwarded-for')),_user_agent_hash:await hashTelemetry(req.headers.get('user-agent')),_correlation_id:correlationId});if(error)return json({success:false,error:/DOCUMENT_NOT_FOUND/.test(error.message||'')?'Not found':error.message},/DOCUMENT_NOT_FOUND/.test(error.message||'')?404:400,cors);return json({success:true,acknowledgement:data},200,cors);
    }

    if(operation==='request_upload'){
      if(!IMMUTABLE_DOCUMENTS)return json({success:false,error:'Document uploads unavailable'},409,cors);const recordId=String(body.document_record_id||'');const {data:record}=await db.from('document_records').select('id,row_version,owner,logical_status').eq('id',recordId).eq('case_id',caseId).eq('legal_matter_id',legalCase.legal_matter_id).eq('owner','client').in('logical_status',['requested','upload_pending']).maybeSingle();if(!record)return json({success:false,error:'Not found'},404,cors);
      const {data,error}=await db.rpc('request_document_version',{_document_record_id:recordId,_expected_version:Number(body.expected_version),_filename:String(body.filename||'document'),_declared_mime:String(body.mime_type||''),_declared_size:Number(body.byte_size),_actor_type:'client_user',_actor_id:actorId});if(error)return json({success:false,error:error.message},/STALE_VERSION/.test(error.message||'')?409:400,cors);const {data:signed,error:signError}=await db.storage.from(data.version.storage_bucket).createSignedUploadUrl(data.version.storage_path);if(signError)throw signError;const raw=signed?.signedUrl||'',absolute=raw.startsWith('http')?raw:`${Deno.env.get('SUPABASE_URL')}/storage/v1${raw.startsWith('/')?'':'/'}${raw}`;return json({success:true,upload:{document_record_id:recordId,document_row_version:data.record.row_version,version_id:data.version.id,token:signed?.token,signed_url:absolute}},200,cors);
    }

    if(operation==='complete_upload'){
      const versionId=String(body.version_id||''),recordId=String(body.document_record_id||'');const {data:version}=await db.from('document_versions').select('id,document_record_id,uploaded_by_type,uploaded_by_id,document_records!inner(case_id,legal_matter_id,owner)').eq('id',versionId).eq('document_record_id',recordId).eq('uploaded_by_type','client_user').eq('uploaded_by_id',actorId).eq('document_records.case_id',caseId).eq('document_records.legal_matter_id',legalCase.legal_matter_id).eq('document_records.owner','client').maybeSingle();if(!version)return json({success:false,error:'Not found'},404,cors);
      const {data,error}=await db.rpc('register_uploaded_document_version',{_document_version_id:versionId,_actor_type:'client_user',_actor_id:actorId});if(error)return json({success:false,error:error.message},400,cors);return json({success:true,processing_status:'queued',document:{id:data.record.id,row_version:data.record.row_version,status:data.record.logical_status}},200,cors);
    }
    return json({success:false,error:'Unknown operation'},400,cors);
  } catch(error){console.error('[client-legal-workspace]',error instanceof Error?error.message:'request_failed');return json({success:false,error:'Unable to load legal workspace'},500,cors);}
});
