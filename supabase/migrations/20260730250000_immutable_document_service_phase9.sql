-- Phase 9: immutable, scanned document versions and audience grants.
CREATE TABLE IF NOT EXISTS public.document_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE RESTRICT,
 category text NOT NULL, title text NOT NULL, description text, owner text NOT NULL DEFAULT 'solicitor', due_date date,
 client_visible boolean NOT NULL DEFAULT false, command_visible boolean NOT NULL DEFAULT true,
 logical_status text NOT NULL DEFAULT 'requested' CHECK(logical_status IN ('requested','upload_pending','available','reviewed','superseded','retained','legal_hold')),
 current_version_id uuid, row_version bigint NOT NULL DEFAULT 1, source text NOT NULL DEFAULT 'immutable_v2',
 created_by_type text NOT NULL, created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,id), UNIQUE(legal_matter_id,id)
);
CREATE INDEX IF NOT EXISTS idx_document_records_case ON public.document_records(case_id,updated_at DESC,id);

CREATE TABLE IF NOT EXISTS public.document_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_record_id uuid NOT NULL REFERENCES public.document_records(id) ON DELETE RESTRICT,
 version_number integer NOT NULL CHECK(version_number>0), storage_bucket text NOT NULL, storage_path text NOT NULL,
 sha256 text, detected_mime_type text, byte_size bigint,
 declared_mime_type text, declared_byte_size bigint, original_filename text NOT NULL,
 malware_scan_status text NOT NULL DEFAULT 'pending' CHECK(malware_scan_status IN ('pending','scanning','clean','infected','error','legacy_unverified')),
 lifecycle_status text NOT NULL DEFAULT 'upload_pending' CHECK(lifecycle_status IN ('upload_pending','quarantined','scanning','available','reviewed','superseded','retained','legal_hold','rejected')),
 uploaded_by_type text NOT NULL, uploaded_by_id uuid, uploaded_at timestamptz,
 supersedes_version_id uuid REFERENCES public.document_versions(id) ON DELETE RESTRICT,
 scan_provider text, scan_reference text, scan_details jsonb NOT NULL DEFAULT '{}'::jsonb, scanned_at timestamptz,
 reviewed_by_type text, reviewed_by_id uuid, reviewed_at timestamptz, review_notes text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_record_id,version_number),
 CHECK(sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'), CHECK(byte_size IS NULL OR byte_size>0)
);
ALTER TABLE public.document_records DROP CONSTRAINT IF EXISTS document_records_current_version_id_fkey;
ALTER TABLE public.document_records ADD CONSTRAINT document_records_current_version_id_fkey FOREIGN KEY(current_version_id) REFERENCES public.document_versions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS idx_document_versions_record ON public.document_versions(document_record_id,version_number DESC);
CREATE INDEX IF NOT EXISTS idx_document_versions_scan_queue ON public.document_versions(malware_scan_status,created_at) WHERE malware_scan_status IN ('pending','error','legacy_unverified');

CREATE TABLE IF NOT EXISTS public.document_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_record_id uuid NOT NULL REFERENCES public.document_records(id) ON DELETE CASCADE,
 document_version_id uuid REFERENCES public.document_versions(id) ON DELETE CASCADE,
 audience text NOT NULL CHECK(audience IN ('solicitor','client','finance','command_centre')),
 grantee_id uuid, permission text NOT NULL CHECK(permission IN ('view','download')),
 granted_by_type text NOT NULL, granted_by_id uuid, granted_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz, revoked_by_type text, revoked_by_id uuid, revocation_reason text,
 grant_key text GENERATED ALWAYS AS (document_record_id::text||':'||COALESCE(document_version_id::text,'*')||':'||audience||':'||COALESCE(grantee_id::text,'*')||':'||permission) STORED,
 UNIQUE(grant_key)
);
CREATE INDEX IF NOT EXISTS idx_document_grants_active ON public.document_access_grants(document_record_id,audience,grantee_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.document_processing_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_version_id uuid NOT NULL UNIQUE REFERENCES public.document_versions(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','failed','dead_lettered')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, locked_by text,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_processing_due ON public.document_processing_jobs(available_at,created_at) WHERE status IN ('queued','failed');

CREATE TABLE IF NOT EXISTS public.document_download_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_record_id uuid NOT NULL REFERENCES public.document_records(id),
 document_version_id uuid NOT NULL REFERENCES public.document_versions(id), actor_type text NOT NULL, actor_id uuid,
 audience text NOT NULL, ip_hash text, user_agent_hash text, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), downloaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_document_download_audit_record ON public.document_download_audit(document_record_id,downloaded_at DESC);

CREATE TABLE IF NOT EXISTS public.document_migration_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legacy_document_id uuid, issue_type text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
 detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(legacy_document_id,issue_type)
);

ALTER TABLE public.legal_matter_documents ADD COLUMN IF NOT EXISTS immutable_document_record_id uuid REFERENCES public.document_records(id);
ALTER TABLE public.legal_matter_documents ADD COLUMN IF NOT EXISTS immutable_current_version_id uuid REFERENCES public.document_versions(id);

CREATE OR REPLACE FUNCTION public.guard_immutable_document_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF TG_OP='DELETE' AND current_setting('app.document_retention_override',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='IMMUTABLE_DOCUMENT_VERSION_DELETE_FORBIDDEN'; END IF;
 IF TG_OP='UPDATE' AND (OLD.document_record_id IS DISTINCT FROM NEW.document_record_id OR OLD.version_number IS DISTINCT FROM NEW.version_number OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket OR OLD.storage_path IS DISTINCT FROM NEW.storage_path OR OLD.sha256 IS DISTINCT FROM NEW.sha256 OR OLD.detected_mime_type IS DISTINCT FROM NEW.detected_mime_type OR OLD.byte_size IS DISTINCT FROM NEW.byte_size OR OLD.uploaded_by_type IS DISTINCT FROM NEW.uploaded_by_type OR OLD.uploaded_by_id IS DISTINCT FROM NEW.uploaded_by_id OR OLD.supersedes_version_id IS DISTINCT FROM NEW.supersedes_version_id) AND OLD.malware_scan_status IN ('clean','infected') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='IMMUTABLE_DOCUMENT_VERSION_MUTATION_FORBIDDEN'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_guard_immutable_document_version ON public.document_versions;
CREATE TRIGGER trg_guard_immutable_document_version BEFORE UPDATE OR DELETE ON public.document_versions FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_document_version();

CREATE OR REPLACE FUNCTION public.create_document_record(_case_id uuid,_legal_matter_id uuid,_category text,_title text,_description text,_owner text,_due_date date,_actor_type text,_actor_id uuid,_client_visible boolean,_command_visible boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.document_records%ROWTYPE; matter_client uuid; legacy public.legal_matter_documents%ROWTYPE; BEGIN
 IF NULLIF(trim(_title),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TITLE_REQUIRED'; END IF;
 SELECT m.client_id INTO matter_client FROM public.transaction_case_links l JOIN public.legal_matters m ON m.id=l.legal_matter_id JOIN public.transaction_cases c ON c.id=l.case_id AND c.client_id=m.client_id WHERE l.case_id=_case_id AND l.legal_matter_id=_legal_matter_id;
 IF matter_client IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_MATTER_LINK_INVALID'; END IF;
 INSERT INTO public.document_records(case_id,legal_matter_id,category,title,description,owner,due_date,client_visible,command_visible,created_by_type,created_by_id) VALUES(_case_id,_legal_matter_id,COALESCE(NULLIF(trim(_category),''),'other'),left(trim(_title),200),left(_description,4000),COALESCE(NULLIF(trim(_owner),''),'solicitor'),_due_date,_client_visible,_command_visible,_actor_type,_actor_id) RETURNING * INTO r;
 INSERT INTO public.legal_matter_documents(id,legal_matter_id,client_id,firm_id,category,label,description,status,visible_to_client,visible_to_npc,requested_at,source,created_by,immutable_document_record_id)
 SELECT r.id,m.id,m.client_id,m.firm_id,CASE WHEN _category IN ('contract','title','plan','disclosure_statement','strata_report','building_pest','identity_voi','transfer','stamp_duty','settlement_statement','discharge','trust_receipt','correspondence','search_result','requisition','authority','other') THEN _category::public.legal_document_category ELSE 'other'::public.legal_document_category END,r.title,r.description,'requested',_client_visible,_command_visible,now(),'immutable_v2',_actor_id,r.id FROM public.legal_matters m WHERE m.id=_legal_matter_id RETURNING * INTO legacy;
 INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type,granted_by_id) VALUES(r.id,'solicitor','download',_actor_type,_actor_id);
 IF _client_visible THEN INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type,granted_by_id) VALUES(r.id,'client','download',_actor_type,_actor_id); END IF;
 IF _command_visible THEN INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type,granted_by_id) VALUES(r.id,'command_centre','download',_actor_type,_actor_id); END IF;
 RETURN jsonb_build_object('record',to_jsonb(r),'legacy',to_jsonb(legacy));
END $$;

CREATE OR REPLACE FUNCTION public.request_document_version(_document_record_id uuid,_expected_version bigint,_filename text,_declared_mime text,_declared_size bigint,_actor_type text,_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.document_records%ROWTYPE; v public.document_versions%ROWTYPE; next_number integer; safe_name text; BEGIN
 SELECT * INTO r FROM public.document_records WHERE id=_document_record_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF;
 IF r.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 IF r.logical_status='legal_hold' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_LEGAL_HOLD'; END IF;
 IF _declared_size IS NULL OR _declared_size<1 OR _declared_size>52428800 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DECLARED_SIZE_OUT_OF_RANGE'; END IF;
 safe_name:=left(regexp_replace(regexp_replace(COALESCE(_filename,'document'),'(^|.*[/\\])','','g'),'[^A-Za-z0-9._-]+','_','g'),120); IF safe_name='' THEN safe_name:='document'; END IF;
 SELECT COALESCE(max(version_number),0)+1 INTO next_number FROM public.document_versions WHERE document_record_id=r.id;
 INSERT INTO public.document_versions(document_record_id,version_number,storage_bucket,storage_path,declared_mime_type,declared_byte_size,original_filename,uploaded_by_type,uploaded_by_id,supersedes_version_id)
 VALUES(r.id,next_number,'legal-matter-documents','immutable/'||r.case_id||'/'||r.id||'/'||gen_random_uuid()||'/'||safe_name,left(_declared_mime,255),_declared_size,safe_name,_actor_type,_actor_id,r.current_version_id) RETURNING * INTO v;
 UPDATE public.document_records SET logical_status='upload_pending',row_version=row_version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v));
END $$;

CREATE OR REPLACE FUNCTION public.update_document_record(_document_record_id uuid,_expected_version bigint,_category text,_title text,_description text,_owner text,_due_date date,_client_visible boolean,_command_visible boolean,_actor_type text,_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.document_records%ROWTYPE; BEGIN
 SELECT * INTO r FROM public.document_records WHERE id=_document_record_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF; IF r.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 UPDATE public.document_records SET category=COALESCE(NULLIF(trim(_category),''),category),title=COALESCE(NULLIF(left(trim(_title),200),''),title),description=left(_description,4000),owner=COALESCE(NULLIF(trim(_owner),''),owner),due_date=_due_date,client_visible=_client_visible,command_visible=_command_visible,row_version=row_version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 UPDATE public.legal_matter_documents SET category=CASE WHEN _category IN ('contract','title','plan','disclosure_statement','strata_report','building_pest','identity_voi','transfer','stamp_duty','settlement_statement','discharge','trust_receipt','correspondence','search_result','requisition','authority','other') THEN _category::public.legal_document_category ELSE category END,label=r.title,description=r.description,owner=CASE WHEN r.owner IN ('client','solicitor','npc','other_side','lender','builder','agent','other') THEN r.owner::public.legal_document_owner ELSE owner END,due_date=r.due_date,visible_to_client=_client_visible,visible_to_npc=_command_visible,updated_at=now() WHERE immutable_document_record_id=r.id;
 PERFORM public.set_document_access_grant(r.id,'client',NULL,'download',_client_visible,_actor_type,_actor_id,'Visibility changed');
 PERFORM public.set_document_access_grant(r.id,'command_centre',NULL,'download',_command_visible,_actor_type,_actor_id,'Visibility changed');
 RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.register_uploaded_document_version(_document_version_id uuid,_actor_type text,_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v public.document_versions%ROWTYPE; r public.document_records%ROWTYPE; j public.document_processing_jobs%ROWTYPE; BEGIN
 SELECT * INTO v FROM public.document_versions WHERE id=_document_version_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='VERSION_NOT_FOUND'; END IF;
 SELECT * INTO r FROM public.document_records WHERE id=v.document_record_id FOR UPDATE; IF v.uploaded_by_type<>_actor_type OR v.uploaded_by_id IS DISTINCT FROM _actor_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='UPLOAD_ACTOR_MISMATCH'; END IF;
 IF v.lifecycle_status<>'upload_pending' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_VERSION_STATE'; END IF;
 UPDATE public.document_versions SET lifecycle_status='quarantined',malware_scan_status='pending',uploaded_at=now(),updated_at=now() WHERE id=v.id RETURNING * INTO v;
 INSERT INTO public.document_processing_jobs(document_version_id) VALUES(v.id) ON CONFLICT(document_version_id) DO UPDATE SET status='queued',available_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=now() RETURNING * INTO j;
 RETURN jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v),'job',to_jsonb(j));
END $$;

CREATE OR REPLACE FUNCTION public.claim_document_processing_jobs(_worker_id text,_limit integer DEFAULT 10)
RETURNS TABLE(job_id uuid,version_id uuid,storage_bucket text,storage_path text,declared_mime_type text,declared_byte_size bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 RETURN QUERY WITH due AS (SELECT id FROM public.document_processing_jobs WHERE status IN ('queued','failed') AND available_at<=now() AND (locked_at IS NULL OR locked_at<now()-interval '5 minutes') ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(_limit,1),25)), claimed AS (UPDATE public.document_processing_jobs j SET status='processing',attempts=j.attempts+1,locked_at=now(),locked_by=_worker_id,updated_at=now() FROM due WHERE j.id=due.id RETURNING j.*)
 SELECT c.id,v.id,v.storage_bucket,v.storage_path,v.declared_mime_type,v.declared_byte_size FROM claimed c JOIN public.document_versions v ON v.id=c.document_version_id;
END $$;

CREATE OR REPLACE FUNCTION public.complete_document_processing(_job_id uuid,_worker_id text,_sha256 text,_detected_mime text,_byte_size bigint,_scan_status text,_scan_provider text,_scan_reference text,_scan_details jsonb,_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE j public.document_processing_jobs%ROWTYPE; v public.document_versions%ROWTYPE; r public.document_records%ROWTYPE; old_version uuid; clean boolean; terminal boolean; BEGIN
 SELECT * INTO j FROM public.document_processing_jobs WHERE id=_job_id AND locked_by=_worker_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='PROCESSING_JOB_NOT_CLAIMED'; END IF;
 SELECT * INTO v FROM public.document_versions WHERE id=j.document_version_id FOR UPDATE; SELECT * INTO r FROM public.document_records WHERE id=v.document_record_id FOR UPDATE; old_version:=r.current_version_id;
 clean:=_scan_status='clean' AND _sha256~'^[0-9a-f]{64}$' AND _detected_mime IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','image/tiff','text/plain','text/csv') AND _byte_size BETWEEN 1 AND 52428800;
 terminal:=_scan_status='infected' OR j.attempts>=10;
 IF clean THEN
  UPDATE public.document_versions SET sha256=_sha256,detected_mime_type=_detected_mime,byte_size=_byte_size,malware_scan_status='clean',lifecycle_status='available',scan_provider=_scan_provider,scan_reference=_scan_reference,scan_details=COALESCE(_scan_details,'{}'),scanned_at=now(),updated_at=now() WHERE id=v.id RETURNING * INTO v;
  IF old_version IS NOT NULL AND old_version<>v.id THEN UPDATE public.document_versions SET lifecycle_status=CASE WHEN lifecycle_status='legal_hold' THEN 'legal_hold' WHEN lifecycle_status='reviewed' THEN 'retained' ELSE 'superseded' END,updated_at=now() WHERE id=old_version; END IF;
  UPDATE public.document_records SET current_version_id=v.id,logical_status='available',row_version=row_version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  UPDATE public.legal_matter_documents SET storage_bucket=v.storage_bucket,storage_path=v.storage_path,file_name=v.original_filename,mime_type=v.detected_mime_type,file_size=v.byte_size,version=v.version_number,status='uploaded',uploaded_at=v.uploaded_at,uploaded_by_type=v.uploaded_by_type,immutable_current_version_id=v.id,updated_at=now() WHERE immutable_document_record_id=r.id;
  UPDATE public.document_processing_jobs SET status='succeeded',locked_at=NULL,locked_by=NULL,last_error=NULL,updated_at=now() WHERE id=j.id;
 ELSE
  UPDATE public.document_versions SET sha256=CASE WHEN _sha256~'^[0-9a-f]{64}$' THEN _sha256 END,detected_mime_type=_detected_mime,byte_size=_byte_size,malware_scan_status=CASE WHEN _scan_status='infected' THEN 'infected' ELSE 'error' END,lifecycle_status=CASE WHEN _scan_status='infected' THEN 'rejected' ELSE 'quarantined' END,scan_provider=_scan_provider,scan_reference=_scan_reference,scan_details=COALESCE(_scan_details,'{}'),scanned_at=now(),updated_at=now() WHERE id=v.id RETURNING * INTO v;
  UPDATE public.document_processing_jobs SET status=CASE WHEN terminal THEN 'dead_lettered' ELSE 'failed' END,available_at=now()+(LEAST(3600,power(2,attempts))::text||' seconds')::interval,locked_at=NULL,locked_by=NULL,last_error=left(COALESCE(_error,'scan_or_content_validation_failed'),2000),updated_at=now() WHERE id=j.id;
 END IF;
 INSERT INTO public.legal_matter_audit_events(legal_matter_id,client_id,firm_id,actor_type,severity,category,action,target_type,target_id,description,metadata)
 SELECT r.legal_matter_id,tc.client_id,lm.firm_id,'system',CASE WHEN v.malware_scan_status='infected' THEN 'critical' WHEN clean THEN 'info' ELSE 'warning' END,'document',CASE WHEN clean THEN 'version_scan_passed' WHEN v.malware_scan_status='infected' THEN 'malware_detected' ELSE 'version_scan_failed' END,'document_version',v.id,'Immutable document processing completed',jsonb_build_object('case_id',r.case_id,'document_record_id',r.id,'document_version_id',v.id,'sha256',v.sha256,'detected_mime_type',v.detected_mime_type,'byte_size',v.byte_size,'scan_status',v.malware_scan_status,'scan_provider',v.scan_provider)
 FROM public.transaction_cases tc LEFT JOIN public.legal_matters lm ON lm.id=r.legal_matter_id WHERE tc.id=r.case_id;
 PERFORM public.enqueue_integration_event('transaction_case',r.case_id,'document.version.processed',1,jsonb_build_object('case_id',r.case_id,'document_record_id',r.id,'document_version_id',v.id,'scan_status',v.malware_scan_status,'lifecycle_status',v.lifecycle_status),'document_version:'||v.id||':processed:'||COALESCE(v.sha256,v.malware_scan_status),NULL);
 RETURN jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v),'available',clean);
END $$;

CREATE OR REPLACE FUNCTION public.set_document_access_grant(_document_record_id uuid,_audience text,_grantee_id uuid,_permission text,_grant boolean,_actor_type text,_actor_id uuid,_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE g public.document_access_grants%ROWTYPE; BEGIN
 IF _audience NOT IN ('solicitor','client','finance','command_centre') OR _permission NOT IN ('view','download') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_DOCUMENT_GRANT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.document_records WHERE id=_document_record_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF;
 INSERT INTO public.document_access_grants(document_record_id,audience,grantee_id,permission,granted_by_type,granted_by_id,revoked_at,revoked_by_type,revoked_by_id,revocation_reason)
 VALUES(_document_record_id,_audience,_grantee_id,_permission,_actor_type,_actor_id,CASE WHEN _grant THEN NULL ELSE now() END,CASE WHEN _grant THEN NULL ELSE _actor_type END,CASE WHEN _grant THEN NULL ELSE _actor_id END,CASE WHEN _grant THEN NULL ELSE left(_reason,1000) END)
 ON CONFLICT(grant_key) DO UPDATE SET revoked_at=EXCLUDED.revoked_at,revoked_by_type=EXCLUDED.revoked_by_type,revoked_by_id=EXCLUDED.revoked_by_id,revocation_reason=EXCLUDED.revocation_reason,granted_at=CASE WHEN _grant THEN now() ELSE public.document_access_grants.granted_at END RETURNING * INTO g;
 IF NOT _grant THEN UPDATE public.document_access_grants SET revoked_at=now(),revoked_by_type=_actor_type,revoked_by_id=_actor_id,revocation_reason=left(_reason,1000) WHERE document_record_id=_document_record_id AND audience=_audience AND permission=_permission AND grantee_id IS NOT DISTINCT FROM _grantee_id AND revoked_at IS NULL; END IF;
 RETURN to_jsonb(g);
END $$;

CREATE OR REPLACE FUNCTION public.list_accessible_documents(_case_id uuid,_audience text,_grantee_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v),'grant',to_jsonb(g)) ORDER BY r.updated_at DESC),'[]'::jsonb)
 FROM public.document_records r JOIN public.document_access_grants g ON g.document_record_id=r.id AND g.audience=_audience AND g.permission IN ('view','download') AND g.revoked_at IS NULL AND (g.grantee_id IS NULL OR g.grantee_id=_grantee_id)
 LEFT JOIN public.document_versions v ON v.id=COALESCE(g.document_version_id,r.current_version_id) WHERE r.case_id=_case_id;
$$;

CREATE OR REPLACE FUNCTION public.authorize_document_download(_document_record_id uuid,_document_version_id uuid,_audience text,_grantee_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v)) FROM public.document_records r JOIN public.document_versions v ON v.document_record_id=r.id AND v.id=COALESCE(_document_version_id,r.current_version_id)
 WHERE r.id=_document_record_id AND v.malware_scan_status='clean' AND v.lifecycle_status IN ('available','reviewed','superseded','retained','legal_hold') AND (_audience<>'client' OR v.lifecycle_status IN ('reviewed','retained','legal_hold')) AND EXISTS(SELECT 1 FROM public.document_access_grants g WHERE g.document_record_id=r.id AND (g.document_version_id IS NULL OR g.document_version_id=v.id) AND g.audience=_audience AND g.permission='download' AND g.revoked_at IS NULL AND (g.grantee_id IS NULL OR g.grantee_id=_grantee_id));
$$;

CREATE OR REPLACE FUNCTION public.record_document_download(_document_record_id uuid,_document_version_id uuid,_actor_type text,_actor_id uuid,_audience text,_ip_hash text,_user_agent_hash text,_correlation_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE audit_id uuid; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.document_records r JOIN public.document_versions v ON v.document_record_id=r.id WHERE r.id=_document_record_id AND v.id=_document_version_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_VERSION_NOT_FOUND'; END IF;
 INSERT INTO public.document_download_audit(document_record_id,document_version_id,actor_type,actor_id,audience,ip_hash,user_agent_hash,correlation_id) VALUES(_document_record_id,_document_version_id,_actor_type,_actor_id,_audience,_ip_hash,_user_agent_hash,COALESCE(_correlation_id,gen_random_uuid())) RETURNING id INTO audit_id; RETURN audit_id;
END $$;

CREATE OR REPLACE FUNCTION public.review_document_version(_document_record_id uuid,_document_version_id uuid,_expected_version bigint,_actor_type text,_actor_id uuid,_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.document_records%ROWTYPE; v public.document_versions%ROWTYPE; BEGIN
 SELECT * INTO r FROM public.document_records WHERE id=_document_record_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF; IF r.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 SELECT * INTO v FROM public.document_versions WHERE id=_document_version_id AND document_record_id=r.id FOR UPDATE; IF NOT FOUND OR v.malware_scan_status<>'clean' OR v.lifecycle_status NOT IN ('available','reviewed') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_REVIEWABLE'; END IF;
 UPDATE public.document_versions SET lifecycle_status='reviewed',reviewed_by_type=_actor_type,reviewed_by_id=_actor_id,reviewed_at=now(),review_notes=left(_notes,4000),updated_at=now() WHERE id=v.id RETURNING * INTO v;
 UPDATE public.document_records SET logical_status='reviewed',row_version=row_version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.document_access_grants(document_record_id,document_version_id,audience,grantee_id,permission,granted_by_type,granted_by_id)
 SELECT r.id,v.id,'client',g.grantee_id,'download',_actor_type,_actor_id FROM public.document_access_grants g WHERE g.document_record_id=r.id AND g.audience='client' AND g.permission='download' AND g.revoked_at IS NULL ON CONFLICT(grant_key) DO UPDATE SET revoked_at=NULL,granted_at=now();
 UPDATE public.legal_matter_documents SET status='accepted',reviewed_at=now(),reviewed_by_solicitor_user_id=CASE WHEN _actor_type='solicitor_user' THEN _actor_id END,review_notes=left(_notes,4000),updated_at=now() WHERE immutable_document_record_id=r.id;
 RETURN jsonb_build_object('record',to_jsonb(r),'version',to_jsonb(v));
END $$;

CREATE OR REPLACE FUNCTION public.set_document_legal_hold(_document_record_id uuid,_expected_version bigint,_hold boolean,_actor_type text,_actor_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.document_records%ROWTYPE; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 SELECT * INTO r FROM public.document_records WHERE id=_document_record_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOCUMENT_NOT_FOUND'; END IF; IF r.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 UPDATE public.document_records SET logical_status=CASE WHEN _hold THEN 'legal_hold' WHEN current_version_id IS NULL THEN 'requested' ELSE 'retained' END,row_version=row_version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 UPDATE public.document_versions SET lifecycle_status=CASE WHEN _hold THEN 'legal_hold' WHEN lifecycle_status='legal_hold' THEN 'retained' ELSE lifecycle_status END,scan_details=scan_details||jsonb_build_object('legal_hold_reason',left(_reason,1000),'legal_hold_actor_type',_actor_type,'legal_hold_actor_id',_actor_id),updated_at=now() WHERE document_record_id=r.id;
 RETURN to_jsonb(r);
END $$;

-- Deterministic expansion backfill; legacy objects are quarantined until re-scanned.
INSERT INTO public.document_migration_issues(legacy_document_id,issue_type,details)
SELECT d.id,'missing_transaction_case',jsonb_build_object('legal_matter_id',d.legal_matter_id) FROM public.legal_matter_documents d LEFT JOIN public.transaction_case_links l ON l.legal_matter_id=d.legal_matter_id WHERE l.case_id IS NULL ON CONFLICT DO NOTHING;
INSERT INTO public.document_records(id,case_id,legal_matter_id,category,title,description,owner,due_date,client_visible,command_visible,logical_status,row_version,source,created_by_type,created_by_id,created_at,updated_at)
SELECT d.id,l.case_id,d.legal_matter_id,d.category::text,d.label,d.description,d.owner::text,d.due_date,d.visible_to_client,d.visible_to_npc,CASE WHEN d.storage_path IS NULL THEN 'requested' ELSE 'upload_pending' END,1,'legacy_backfill',COALESCE(d.uploaded_by_type,'system'),COALESCE(d.uploaded_by_solicitor_user_id,d.created_by),d.created_at,d.updated_at FROM public.legal_matter_documents d JOIN public.transaction_case_links l ON l.legal_matter_id=d.legal_matter_id ON CONFLICT(id) DO NOTHING;
INSERT INTO public.document_versions(document_record_id,version_number,storage_bucket,storage_path,declared_mime_type,declared_byte_size,original_filename,malware_scan_status,lifecycle_status,uploaded_by_type,uploaded_by_id,uploaded_at,created_at,updated_at)
SELECT d.id,GREATEST(d.version,1),COALESCE(d.storage_bucket,'legal-matter-documents'),d.storage_path,d.mime_type,d.file_size,COALESCE(d.file_name,'legacy-document'),'legacy_unverified','quarantined',COALESCE(d.uploaded_by_type,'system'),d.uploaded_by_solicitor_user_id,d.uploaded_at,COALESCE(d.uploaded_at,d.created_at),d.updated_at FROM public.legal_matter_documents d JOIN public.document_records r ON r.id=d.id WHERE d.storage_path IS NOT NULL ON CONFLICT(document_record_id,version_number) DO NOTHING;
UPDATE public.document_records r SET current_version_id=v.id FROM public.document_versions v WHERE v.document_record_id=r.id AND v.version_number=(SELECT max(v2.version_number) FROM public.document_versions v2 WHERE v2.document_record_id=r.id) AND r.current_version_id IS NULL;
UPDATE public.legal_matter_documents d SET immutable_document_record_id=r.id,immutable_current_version_id=r.current_version_id FROM public.document_records r WHERE r.id=d.id;
INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type) SELECT r.id,'solicitor','download','migration' FROM public.document_records r ON CONFLICT(grant_key) DO NOTHING;
INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type) SELECT r.id,'client','download','migration' FROM public.document_records r JOIN public.legal_matter_documents d ON d.id=r.id WHERE d.visible_to_client ON CONFLICT(grant_key) DO NOTHING;
INSERT INTO public.document_access_grants(document_record_id,audience,permission,granted_by_type) SELECT r.id,'command_centre','download','migration' FROM public.document_records r JOIN public.legal_matter_documents d ON d.id=r.id WHERE d.visible_to_npc ON CONFLICT(grant_key) DO NOTHING;
INSERT INTO public.document_processing_jobs(document_version_id) SELECT v.id FROM public.document_versions v WHERE v.malware_scan_status='legacy_unverified' ON CONFLICT(document_version_id) DO NOTHING;

GRANT ALL ON public.document_records,public.document_versions,public.document_access_grants,public.document_processing_jobs,public.document_download_audit,public.document_migration_issues TO service_role;
REVOKE ALL ON public.document_records,public.document_versions,public.document_access_grants,public.document_processing_jobs,public.document_download_audit,public.document_migration_issues FROM anon,authenticated;
ALTER TABLE public.document_records ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_access_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_processing_jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_download_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE public.document_migration_issues ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['document_records','document_versions','document_access_grants','document_processing_jobs','document_download_audit','document_migration_issues'] LOOP EXECUTE format('CREATE POLICY %I_service_role_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',n,n); END LOOP; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON FUNCTION public.create_document_record(uuid,uuid,text,text,text,text,date,text,uuid,boolean,boolean),public.update_document_record(uuid,bigint,text,text,text,text,date,boolean,boolean,text,uuid),public.request_document_version(uuid,bigint,text,text,bigint,text,uuid),public.register_uploaded_document_version(uuid,text,uuid),public.claim_document_processing_jobs(text,integer),public.complete_document_processing(uuid,text,text,text,bigint,text,text,text,jsonb,text),public.set_document_access_grant(uuid,text,uuid,text,boolean,text,uuid,text),public.list_accessible_documents(uuid,text,uuid),public.authorize_document_download(uuid,uuid,text,uuid),public.record_document_download(uuid,uuid,text,uuid,text,text,text,uuid),public.review_document_version(uuid,uuid,bigint,text,uuid,text),public.set_document_legal_hold(uuid,bigint,boolean,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_document_record(uuid,uuid,text,text,text,text,date,text,uuid,boolean,boolean),public.update_document_record(uuid,bigint,text,text,text,text,date,boolean,boolean,text,uuid),public.request_document_version(uuid,bigint,text,text,bigint,text,uuid),public.register_uploaded_document_version(uuid,text,uuid),public.claim_document_processing_jobs(text,integer),public.complete_document_processing(uuid,text,text,text,bigint,text,text,text,jsonb,text),public.set_document_access_grant(uuid,text,uuid,text,boolean,text,uuid,text),public.list_accessible_documents(uuid,text,uuid),public.authorize_document_download(uuid,uuid,text,uuid),public.record_document_download(uuid,uuid,text,uuid,text,text,text,uuid),public.review_document_version(uuid,uuid,bigint,text,uuid,text),public.set_document_legal_hold(uuid,bigint,boolean,text,uuid,text) TO service_role;
