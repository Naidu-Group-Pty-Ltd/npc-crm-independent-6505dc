ALTER TABLE public.client_case_read_model
  ADD COLUMN IF NOT EXISTS legal_matter_id uuid REFERENCES public.legal_matters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matter_reference text,
  ADD COLUMN IF NOT EXISTS practice_name text,
  ADD COLUMN IF NOT EXISTS practice_email text,
  ADD COLUMN IF NOT EXISTS practice_phone text,
  ADD COLUMN IF NOT EXISTS solicitor_name text,
  ADD COLUMN IF NOT EXISTS solicitor_email text;

CREATE INDEX IF NOT EXISTS idx_client_case_read_model_client_updated
  ON public.client_case_read_model(client_id,updated_at DESC,case_id);

CREATE TABLE IF NOT EXISTS public.client_case_activity_read_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  event_key text NOT NULL UNIQUE,
  activity_type text NOT NULL CHECK(activity_type IN ('case_progress','milestone','task','document','message')),
  title text NOT NULL,
  summary text,
  occurred_at timestamptz NOT NULL,
  source_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_case_activity_case
  ON public.client_case_activity_read_model(case_id,occurred_at DESC,id);

CREATE TABLE IF NOT EXISTS public.client_document_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
  document_record_id uuid NOT NULL REFERENCES public.document_records(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL REFERENCES public.document_versions(id) ON DELETE RESTRICT,
  client_portal_user_id uuid NOT NULL REFERENCES public.client_portal_users(id) ON DELETE RESTRICT,
  acknowledgement_type text NOT NULL DEFAULT 'viewed' CHECK(acknowledgement_type IN ('viewed','received','accepted')),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent_hash text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  UNIQUE(document_version_id,client_portal_user_id,acknowledgement_type)
);
CREATE INDEX IF NOT EXISTS idx_client_document_ack_case
  ON public.client_document_acknowledgements(case_id,acknowledged_at DESC);

CREATE OR REPLACE FUNCTION public.acknowledge_client_document(
  _case_id uuid,_document_record_id uuid,_document_version_id uuid,_client_user_id uuid,
  _acknowledgement_type text,_ip_hash text,_user_agent_hash text,_correlation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.client_document_acknowledgements%ROWTYPE; matter_id uuid; client_id uuid; BEGIN
 IF _acknowledgement_type NOT IN ('viewed','received','accepted') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_ACKNOWLEDGEMENT'; END IF;
 SELECT r.legal_matter_id,tc.client_id INTO matter_id,client_id
 FROM public.document_records r JOIN public.transaction_cases tc ON tc.id=r.case_id
 JOIN public.document_versions v ON v.document_record_id=r.id
 WHERE r.id=_document_record_id AND r.case_id=_case_id AND v.id=_document_version_id
   AND v.malware_scan_status='clean' AND v.lifecycle_status IN ('reviewed','retained','legal_hold')
   AND EXISTS(SELECT 1 FROM public.client_portal_users u WHERE u.id=_client_user_id AND u.client_id=tc.client_id AND u.status='active')
   AND EXISTS(SELECT 1 FROM public.document_access_grants g WHERE g.document_record_id=r.id AND (g.document_version_id IS NULL OR g.document_version_id=v.id) AND g.audience='client' AND (g.grantee_id IS NULL OR g.grantee_id=_client_user_id) AND g.permission IN ('view','download') AND g.revoked_at IS NULL)
 FOR UPDATE OF r;
 IF matter_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF;
 INSERT INTO public.client_document_acknowledgements(case_id,document_record_id,document_version_id,client_portal_user_id,acknowledgement_type,ip_hash,user_agent_hash,correlation_id)
 VALUES(_case_id,_document_record_id,_document_version_id,_client_user_id,_acknowledgement_type,_ip_hash,_user_agent_hash,COALESCE(_correlation_id,gen_random_uuid()))
 ON CONFLICT(document_version_id,client_portal_user_id,acknowledgement_type) DO UPDATE SET acknowledged_at=EXCLUDED.acknowledged_at,ip_hash=EXCLUDED.ip_hash,user_agent_hash=EXCLUDED.user_agent_hash RETURNING * INTO a;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,actor_type,actor_client_portal_user_id,category,action,target_type,target_id,description,metadata)
 VALUES(matter_id,client_id,'client_user',_client_user_id,'document','client_document_acknowledged','document_version',_document_version_id,'Client acknowledged an approved document',jsonb_build_object('case_id',_case_id,'document_record_id',_document_record_id,'acknowledgement_type',_acknowledgement_type,'correlation_id',a.correlation_id));
 RETURN to_jsonb(a);
END $$;

UPDATE public.client_case_read_model p SET
 legal_matter_id=l.legal_matter_id,
 matter_reference=m.matter_reference,
 practice_name=COALESCE(f.trading_name,f.name), practice_email=f.contact_email, practice_phone=f.contact_phone,
 solicitor_name=u.name, solicitor_email=u.email
FROM public.transaction_case_links l
LEFT JOIN public.legal_matters m ON m.id=l.legal_matter_id
LEFT JOIN public.solicitor_firms f ON f.id=m.firm_id AND f.is_active=true
LEFT JOIN public.solicitor_portal_users u ON u.id=m.assigned_solicitor_user_id AND u.is_active=true
WHERE p.case_id=l.case_id;

INSERT INTO public.client_case_activity_read_model(case_id,client_id,event_key,activity_type,title,summary,occurred_at,source_version)
SELECT p.case_id,p.client_id,'phase10:case:'||p.case_id,'case_progress','Legal workspace opened',
 CASE WHEN p.friendly_status IS NULL THEN NULL ELSE 'Current status: '||p.friendly_status END,p.updated_at,p.source_version
FROM public.client_case_read_model p ON CONFLICT(event_key) DO NOTHING;

GRANT ALL ON public.client_case_activity_read_model,public.client_document_acknowledgements TO service_role;
REVOKE ALL ON public.client_case_activity_read_model,public.client_document_acknowledgements FROM anon,authenticated;
ALTER TABLE public.client_case_activity_read_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_document_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_case_activity_service ON public.client_case_activity_read_model;
CREATE POLICY client_case_activity_service ON public.client_case_activity_read_model FOR ALL TO service_role USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS client_document_ack_service ON public.client_document_acknowledgements;
CREATE POLICY client_document_ack_service ON public.client_document_acknowledgements FOR ALL TO service_role USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION public.acknowledge_client_document(uuid,uuid,uuid,uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_client_document(uuid,uuid,uuid,uuid,text,text,text,uuid) TO service_role;