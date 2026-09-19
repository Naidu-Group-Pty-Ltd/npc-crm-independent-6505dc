import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { checkPermission } from '../_shared/permissions.ts';
import { logClientActivity } from '../_shared/client-data-provenance.ts';
import { requestSchema } from './validation.ts';

Deno.serve(async(req)=>{
 const corsHeaders=createCorsHeaders(req.headers.get('origin')); if(req.method==='OPTIONS')return new Response(null,{headers:corsHeaders});
 const csrf=enforceCsrf(req); if(!csrf.ok)return csrfDenied(corsHeaders,csrf);
 try {
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return new Response(JSON.stringify({success:false,error:'Server configuration unavailable'}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}});
  const supabase=createClient(url,key); const raw=await req.json();
  const auth=await verifyAuth(supabase,req.headers,raw); if(auth.error)return createUnauthorizedResponse(auth.error,corsHeaders);
  const permission=await checkPermission(supabase,auth.userId!,'clients','create',auth.authMethod); if(!permission.allowed)return new Response(JSON.stringify({success:false,error:'Permission denied'}),{status:403,headers:{...corsHeaders,'Content-Type':'application/json'}});
  const parsed=requestSchema.safeParse(raw); if(!parsed.success)return new Response(JSON.stringify({success:false,error:'Invalid Advanced client payload',issues:parsed.error.issues.map(i=>({path:i.path.join('.'),message:i.message}))}),{status:400,headers:{...corsHeaders,'Content-Type':'application/json'}});
  const payload=parsed.data.payload,a1=payload.applicants.find(a=>a.applicantNumber===1)!,a2=payload.applicants.find(a=>a.applicantNumber===2),current=payload.addresses.find(a=>a.applicantNumber===1&&a.addressType==='current');
  const clientData={primary_first_name:a1.firstName.trim(),primary_surname:a1.surname.trim(),primary_email:a1.email.trim()||null,primary_mobile:a1.mobile.trim()||null,secondary_first_name:a2?.firstName.trim()||null,secondary_surname:a2?.surname.trim()||null,secondary_email:a2?.email.trim()||null,secondary_mobile:a2?.mobile.trim()||null,current_address:current?.address.trim()||null};
  const {data,error}=await supabase.rpc('create_advanced_client_fact_find',{_actor_id:auth.userId,_client:clientData,_payload:payload}); if(error)throw error;
  await logClientActivity(supabase,{clientId:data.clientId,activityType:'client_created',title:'Advanced client fact find created',createdBy:auth.userId,metadata:{fact_find_id:data.factFindId,template_version:payload.templateVersion,synced_to_ghl:false},provenance:{sourceSurface:'internal_dashboard',sourceActorType:'internal_user',sourceActorName:auth.username,sourceReference:auth.userId,sourceDetails:{auth_method:auth.authMethod,creation_mode:'advanced'}}});
  return new Response(JSON.stringify({success:true,...data,syncToGhl:payload.syncToGhl===true}),{headers:{...corsHeaders,'Content-Type':'application/json'}});
 } catch(error){console.error('[create-advanced-client] failed',error instanceof Error?error.message:String(error));return new Response(JSON.stringify({success:false,error:'Unable to create Advanced client fact find'}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}});}
});
