-- Phase 5: shared transaction identity; domain tables remain authoritative.
CREATE TABLE IF NOT EXISTS public.transaction_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id),
 case_type text NOT NULL DEFAULT 'property_purchase' CHECK(case_type IN ('property_purchase','property_sale','refinance','construction','commercial','other')),
 canonical_property_id uuid, property_address_normalized text, jurisdiction text,
 shared_lifecycle_status text NOT NULL DEFAULT 'open' CHECK(shared_lifecycle_status IN ('open','on_hold','completed','cancelled')),
 risk_level text NOT NULL DEFAULT 'standard' CHECK(risk_level IN ('standard','elevated','high')),
 row_version bigint NOT NULL DEFAULT 1, created_by uuid, opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_cases_client ON public.transaction_cases(client_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS public.transaction_case_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL UNIQUE REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 legal_matter_id uuid UNIQUE REFERENCES public.legal_matters(id) ON DELETE SET NULL,
 purchase_file_id uuid UNIQUE REFERENCES public.purchase_files(id) ON DELETE SET NULL,
 client_deal_id uuid UNIQUE REFERENCES public.client_deals(id) ON DELETE SET NULL,
 link_source text NOT NULL CHECK(link_source IN ('legacy_explicit','legacy_reverse','command_centre','system')),
 linked_by uuid, linked_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_case_links_legal ON public.transaction_case_links(legal_matter_id) WHERE legal_matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_case_links_purchase ON public.transaction_case_links(purchase_file_id) WHERE purchase_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_case_links_deal ON public.transaction_case_links(client_deal_id) WHERE client_deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.transaction_case_link_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.transaction_cases(id) ON DELETE CASCADE,
 domain_type text NOT NULL CHECK(domain_type IN ('legal_matter','purchase_file','client_deal')),
 domain_record_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('linked','unlinked')),
 link_source text NOT NULL, actor_user_id uuid, reason text, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transaction_case_link_history_case ON public.transaction_case_link_history(case_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.transaction_case_reconciliation_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_type text NOT NULL,
 legal_matter_id uuid, purchase_file_id uuid, client_deal_id uuid,
 expected_client_id uuid, actual_client_id uuid, details jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
 issue_key text GENERATED ALWAYS AS (issue_type||':'||COALESCE(legal_matter_id::text,'')||':'||COALESCE(purchase_file_id::text,'')||':'||COALESCE(client_deal_id::text,'')) STORED UNIQUE,
 detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 UNIQUE(issue_type,legal_matter_id,purchase_file_id,client_deal_id)
);

CREATE OR REPLACE FUNCTION public.guard_transaction_case_links() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE case_client uuid; domain_client uuid; BEGIN
 SELECT client_id INTO case_client FROM public.transaction_cases WHERE id=NEW.case_id;
 IF case_client IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_NOT_FOUND'; END IF;
 IF NEW.legal_matter_id IS NOT NULL THEN domain_client:=NULL; SELECT client_id INTO domain_client FROM public.legal_matters WHERE id=NEW.legal_matter_id; IF domain_client IS DISTINCT FROM case_client THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_CASE_LINK'; END IF; END IF;
 IF NEW.purchase_file_id IS NOT NULL THEN domain_client:=NULL; SELECT client_id INTO domain_client FROM public.purchase_files WHERE id=NEW.purchase_file_id; IF domain_client IS DISTINCT FROM case_client THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_CASE_LINK'; END IF; END IF;
 IF NEW.client_deal_id IS NOT NULL THEN domain_client:=NULL; SELECT client_id INTO domain_client FROM public.client_deals WHERE id=NEW.client_deal_id; IF domain_client IS DISTINCT FROM case_client THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_CASE_LINK'; END IF; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_transaction_case_links ON public.transaction_case_links;
CREATE TRIGGER trg_guard_transaction_case_links BEFORE INSERT OR UPDATE OF case_id,legal_matter_id,purchase_file_id,client_deal_id ON public.transaction_case_links FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_case_links();

-- Deterministic backfill. Explicit IDs and reverse IDs only; never addresses.
INSERT INTO public.transaction_case_reconciliation_issues(issue_type,legal_matter_id,details)
SELECT 'orphaned_legal_matter_client',id,jsonb_build_object('reason','legal_matter.client_id is null')
FROM public.legal_matters WHERE client_id IS NULL ON CONFLICT DO NOTHING;

DO $$ DECLARE m record; c_id uuid; BEGIN
 FOR m IN SELECT * FROM public.legal_matters WHERE client_id IS NOT NULL LOOP
  IF EXISTS(SELECT 1 FROM public.transaction_case_links WHERE legal_matter_id=m.id) THEN CONTINUE; END IF;
  INSERT INTO public.transaction_cases(client_id,case_type,property_address_normalized,jurisdiction,shared_lifecycle_status,risk_level,opened_at)
  VALUES(m.client_id,CASE WHEN m.matter_type::text='sale' THEN 'property_sale' WHEN m.matter_type::text='refinance' THEN 'refinance' WHEN m.matter_type::text='commercial' THEN 'commercial' ELSE 'property_purchase' END,lower(regexp_replace(trim(COALESCE(m.property_address,'')),'\s+',' ','g')),m.property_state,CASE WHEN m.status::text IN ('settled','post_settlement','terminated') THEN 'completed' ELSE 'open' END,CASE WHEN m.risk_flag THEN 'elevated' ELSE 'standard' END,m.opened_at) RETURNING id INTO c_id;
  INSERT INTO public.transaction_case_links(case_id,legal_matter_id,link_source) VALUES(c_id,m.id,'legacy_explicit');
  INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source) VALUES(c_id,'legal_matter',m.id,'linked','legacy_explicit');
  IF m.purchase_file_id IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM public.purchase_files p WHERE p.id=m.purchase_file_id AND p.client_id=m.client_id) AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links WHERE purchase_file_id=m.purchase_file_id) THEN UPDATE public.transaction_case_links SET purchase_file_id=m.purchase_file_id,updated_at=now() WHERE case_id=c_id; INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source) VALUES(c_id,'purchase_file',m.purchase_file_id,'linked','legacy_explicit');
   ELSE INSERT INTO public.transaction_case_reconciliation_issues(issue_type,legal_matter_id,purchase_file_id,expected_client_id,details) VALUES('invalid_or_duplicate_explicit_purchase_link',m.id,m.purchase_file_id,m.client_id,jsonb_build_object('source','legal_matters.purchase_file_id')) ON CONFLICT DO NOTHING; END IF;
  END IF;
  IF m.client_deal_id IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM public.client_deals d WHERE d.id=m.client_deal_id AND d.client_id=m.client_id) AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links WHERE client_deal_id=m.client_deal_id) THEN UPDATE public.transaction_case_links SET client_deal_id=m.client_deal_id,updated_at=now() WHERE case_id=c_id; INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source) VALUES(c_id,'client_deal',m.client_deal_id,'linked','legacy_explicit');
   ELSE INSERT INTO public.transaction_case_reconciliation_issues(issue_type,legal_matter_id,client_deal_id,expected_client_id,details) VALUES('invalid_or_duplicate_explicit_deal_link',m.id,m.client_deal_id,m.client_id,jsonb_build_object('source','legal_matters.client_deal_id')) ON CONFLICT DO NOTHING; END IF;
  END IF;
 END LOOP;
END $$;

DO $$ DECLARE p record; c_id uuid; legal_case uuid; BEGIN
 FOR p IN SELECT * FROM public.purchase_files WHERE archived_at IS NULL LOOP
  IF EXISTS(SELECT 1 FROM public.transaction_case_links WHERE purchase_file_id=p.id) THEN CONTINUE; END IF;
  SELECT l.case_id INTO legal_case FROM public.transaction_case_links l JOIN public.legal_matters m ON m.id=l.legal_matter_id WHERE m.id=p.legal_matter_id AND m.client_id=p.client_id;
  IF legal_case IS NOT NULL AND (SELECT purchase_file_id IS NULL FROM public.transaction_case_links WHERE case_id=legal_case) THEN c_id:=legal_case; UPDATE public.transaction_case_links SET purchase_file_id=p.id,link_source='legacy_reverse',updated_at=now() WHERE case_id=c_id;
  ELSE INSERT INTO public.transaction_cases(client_id,case_type,property_address_normalized,jurisdiction,shared_lifecycle_status,risk_level,opened_at) VALUES(p.client_id,CASE WHEN p.purchase_type::text='refinance' THEN 'refinance' WHEN p.purchase_type::text='commercial' THEN 'commercial' ELSE 'property_purchase' END,lower(regexp_replace(trim(COALESCE(p.property_address,'')),'\s+',' ','g')),p.property_state,CASE WHEN p.archived_at IS NOT NULL THEN 'completed' ELSE 'open' END,CASE WHEN p.risk_level IN ('elevated','high') THEN p.risk_level ELSE 'standard' END,p.created_at) RETURNING id INTO c_id; INSERT INTO public.transaction_case_links(case_id,purchase_file_id,link_source) VALUES(c_id,p.id,'system'); END IF;
  INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source) VALUES(c_id,'purchase_file',p.id,'linked',CASE WHEN legal_case IS NULL THEN 'system' ELSE 'legacy_reverse' END);
 END LOOP;
END $$;

DO $$ DECLARE d record; c_id uuid; purchase_case uuid; candidate_count integer; BEGIN
 FOR d IN SELECT * FROM public.client_deals LOOP
  IF EXISTS(SELECT 1 FROM public.transaction_case_links WHERE client_deal_id=d.id) THEN CONTINUE; END IF;
  SELECT count(DISTINCT l.case_id),(array_agg(DISTINCT l.case_id))[1] INTO candidate_count,purchase_case FROM public.transaction_case_links l JOIN public.purchase_files p ON p.id=l.purchase_file_id WHERE (p.id=d.purchase_file_id OR p.client_deal_id=d.id) AND p.client_id=d.client_id;
  IF candidate_count=1 AND (SELECT client_deal_id IS NULL FROM public.transaction_case_links WHERE case_id=purchase_case) THEN c_id:=purchase_case; UPDATE public.transaction_case_links SET client_deal_id=d.id,link_source='legacy_reverse',updated_at=now() WHERE case_id=c_id;
  ELSE
   INSERT INTO public.transaction_cases(client_id,case_type,canonical_property_id,property_address_normalized,shared_lifecycle_status,opened_at) VALUES(d.client_id,CASE WHEN d.deal_type::text='refinance' THEN 'refinance' WHEN d.deal_type::text='construction' THEN 'construction' ELSE 'property_purchase' END,d.property_id,lower(regexp_replace(trim(COALESCE(d.property_address,'')),'\s+',' ','g')),CASE WHEN d.current_stage_number>=10 THEN 'completed' ELSE 'open' END,d.created_at) RETURNING id INTO c_id;
   INSERT INTO public.transaction_case_links(case_id,client_deal_id,link_source) VALUES(c_id,d.id,'system');
   IF candidate_count>1 THEN INSERT INTO public.transaction_case_reconciliation_issues(issue_type,client_deal_id,expected_client_id,details) VALUES('ambiguous_explicit_purchase_deal_links',d.id,d.client_id,jsonb_build_object('candidate_count',candidate_count)) ON CONFLICT DO NOTHING; END IF;
  END IF;
  INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source) VALUES(c_id,'client_deal',d.id,'linked',CASE WHEN candidate_count=1 THEN 'legacy_reverse' ELSE 'system' END);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_transaction_case(_client_id uuid,_case_type text,_property_address text,_jurisdiction text,_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c public.transaction_cases%ROWTYPE; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=_client_id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CLIENT_NOT_FOUND'; END IF;
 INSERT INTO public.transaction_cases(client_id,case_type,property_address_normalized,jurisdiction,created_by) VALUES(_client_id,_case_type,lower(regexp_replace(trim(COALESCE(_property_address,'')),'\s+',' ','g')),_jurisdiction,_actor_user_id) RETURNING * INTO c; RETURN to_jsonb(c); END $$;

CREATE OR REPLACE FUNCTION public.link_transaction_case_record(_case_id uuid,_expected_version bigint,_domain_type text,_domain_record_id uuid,_actor_user_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.transaction_cases%ROWTYPE; l public.transaction_case_links%ROWTYPE; domain_client uuid; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 SELECT * INTO c FROM public.transaction_cases WHERE id=_case_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_NOT_FOUND'; END IF;
 IF c.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 SELECT * INTO l FROM public.transaction_case_links WHERE case_id=c.id FOR UPDATE;
 IF _domain_type='legal_matter' THEN SELECT client_id INTO domain_client FROM public.legal_matters WHERE id=_domain_record_id FOR UPDATE; IF l.legal_matter_id=_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_RECORD_ALREADY_LINKED'; END IF; IF l.legal_matter_id IS NOT NULL AND l.legal_matter_id<>_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_DOMAIN_SLOT_OCCUPIED'; END IF;
 ELSIF _domain_type='purchase_file' THEN SELECT client_id INTO domain_client FROM public.purchase_files WHERE id=_domain_record_id FOR UPDATE; IF l.purchase_file_id=_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_RECORD_ALREADY_LINKED'; END IF; IF l.purchase_file_id IS NOT NULL AND l.purchase_file_id<>_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_DOMAIN_SLOT_OCCUPIED'; END IF;
 ELSIF _domain_type='client_deal' THEN SELECT client_id INTO domain_client FROM public.client_deals WHERE id=_domain_record_id FOR UPDATE; IF l.client_deal_id=_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_RECORD_ALREADY_LINKED'; END IF; IF l.client_deal_id IS NOT NULL AND l.client_deal_id<>_domain_record_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_DOMAIN_SLOT_OCCUPIED'; END IF; ELSE RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_DOMAIN_TYPE'; END IF;
 IF domain_client IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_RECORD_NOT_FOUND'; END IF; IF domain_client IS DISTINCT FROM c.client_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CROSS_CLIENT_CASE_LINK'; END IF;
 IF EXISTS(SELECT 1 FROM public.transaction_case_links WHERE ((_domain_type='legal_matter' AND legal_matter_id=_domain_record_id) OR (_domain_type='purchase_file' AND purchase_file_id=_domain_record_id) OR (_domain_type='client_deal' AND client_deal_id=_domain_record_id)) AND case_id<>c.id) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_RECORD_ALREADY_LINKED'; END IF;
 IF l.id IS NULL THEN INSERT INTO public.transaction_case_links(case_id,legal_matter_id,purchase_file_id,client_deal_id,link_source,linked_by) VALUES(c.id,CASE WHEN _domain_type='legal_matter' THEN _domain_record_id END,CASE WHEN _domain_type='purchase_file' THEN _domain_record_id END,CASE WHEN _domain_type='client_deal' THEN _domain_record_id END,'command_centre',_actor_user_id) RETURNING * INTO l;
 ELSE UPDATE public.transaction_case_links SET legal_matter_id=CASE WHEN _domain_type='legal_matter' THEN _domain_record_id ELSE legal_matter_id END,purchase_file_id=CASE WHEN _domain_type='purchase_file' THEN _domain_record_id ELSE purchase_file_id END,client_deal_id=CASE WHEN _domain_type='client_deal' THEN _domain_record_id ELSE client_deal_id END,link_source='command_centre',linked_by=_actor_user_id,updated_at=now() WHERE id=l.id RETURNING * INTO l; END IF;
 -- Compatibility adapter: legacy columns are maintained in this one command.
 IF l.legal_matter_id IS NOT NULL THEN UPDATE public.legal_matters SET purchase_file_id=l.purchase_file_id,client_deal_id=l.client_deal_id,row_version=row_version+1,updated_at=now() WHERE id=l.legal_matter_id AND (purchase_file_id IS DISTINCT FROM l.purchase_file_id OR client_deal_id IS DISTINCT FROM l.client_deal_id); END IF;
 IF l.purchase_file_id IS NOT NULL THEN UPDATE public.purchase_files SET legal_matter_id=l.legal_matter_id,client_deal_id=l.client_deal_id,updated_at=now() WHERE id=l.purchase_file_id; END IF;
 IF l.client_deal_id IS NOT NULL THEN UPDATE public.client_deals SET purchase_file_id=l.purchase_file_id,updated_at=now() WHERE id=l.client_deal_id; END IF;
 UPDATE public.transaction_cases SET row_version=row_version+1,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source,actor_user_id,reason) VALUES(c.id,_domain_type,_domain_record_id,'linked','command_centre',_actor_user_id,left(trim(_reason),1000)); RETURN jsonb_build_object('case',to_jsonb(c),'links',to_jsonb(l)); END $$;

CREATE OR REPLACE FUNCTION public.unlink_transaction_case_record(_case_id uuid,_expected_version bigint,_domain_type text,_actor_user_id uuid,_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.transaction_cases%ROWTYPE; l public.transaction_case_links%ROWTYPE; old_id uuid; BEGIN
 IF NULLIF(trim(_reason),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='REASON_REQUIRED'; END IF;
 SELECT * INTO c FROM public.transaction_cases WHERE id=_case_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_NOT_FOUND'; END IF; IF c.row_version<>_expected_version THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_VERSION'; END IF;
 SELECT * INTO l FROM public.transaction_case_links WHERE case_id=c.id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CASE_LINKS_NOT_FOUND'; END IF;
 IF _domain_type='legal_matter' THEN old_id:=l.legal_matter_id; UPDATE public.legal_matters SET purchase_file_id=NULL,client_deal_id=NULL,row_version=row_version+1,updated_at=now() WHERE id=old_id; UPDATE public.purchase_files SET legal_matter_id=NULL WHERE legal_matter_id=old_id; UPDATE public.transaction_case_links SET legal_matter_id=NULL,updated_at=now() WHERE id=l.id;
 ELSIF _domain_type='purchase_file' THEN old_id:=l.purchase_file_id; UPDATE public.purchase_files SET legal_matter_id=NULL,client_deal_id=NULL WHERE id=old_id; UPDATE public.legal_matters SET purchase_file_id=NULL,row_version=row_version+1,updated_at=now() WHERE purchase_file_id=old_id; UPDATE public.client_deals SET purchase_file_id=NULL WHERE purchase_file_id=old_id; UPDATE public.transaction_case_links SET purchase_file_id=NULL,updated_at=now() WHERE id=l.id;
 ELSIF _domain_type='client_deal' THEN old_id:=l.client_deal_id; UPDATE public.client_deals SET purchase_file_id=NULL WHERE id=old_id; UPDATE public.legal_matters SET client_deal_id=NULL,row_version=row_version+1,updated_at=now() WHERE client_deal_id=old_id; UPDATE public.purchase_files SET client_deal_id=NULL WHERE client_deal_id=old_id; UPDATE public.transaction_case_links SET client_deal_id=NULL,updated_at=now() WHERE id=l.id; ELSE RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_DOMAIN_TYPE'; END IF;
 IF old_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DOMAIN_SLOT_EMPTY'; END IF;
UPDATE public.transaction_cases SET row_version=row_version+1,updated_at=now() WHERE id=c.id RETURNING * INTO c; INSERT INTO public.transaction_case_link_history(case_id,domain_type,domain_record_id,action,link_source,actor_user_id,reason) VALUES(c.id,_domain_type,old_id,'unlinked','command_centre',_actor_user_id,left(trim(_reason),1000)); RETURN to_jsonb(c); END $$;

CREATE OR REPLACE FUNCTION public.get_transaction_case_health(_case_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'case',to_jsonb(c),'links',to_jsonb(l),
  'domain_statuses',jsonb_build_object('legal',m.status,'finance',p.status,'deal',d.current_stage),
  'issues',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.detected_at DESC) FROM public.transaction_case_reconciliation_issues i WHERE i.status='open' AND (i.legal_matter_id=l.legal_matter_id OR i.purchase_file_id=l.purchase_file_id OR i.client_deal_id=l.client_deal_id)),'[]'::jsonb),
  'history',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.occurred_at DESC) FROM public.transaction_case_link_history h WHERE h.case_id=c.id),'[]'::jsonb)
 ) FROM public.transaction_cases c LEFT JOIN public.transaction_case_links l ON l.case_id=c.id LEFT JOIN public.legal_matters m ON m.id=l.legal_matter_id LEFT JOIN public.purchase_files p ON p.id=l.purchase_file_id LEFT JOIN public.client_deals d ON d.id=l.client_deal_id WHERE c.id=_case_id;
$$;

GRANT ALL ON public.transaction_cases,public.transaction_case_links,public.transaction_case_link_history,public.transaction_case_reconciliation_issues TO service_role;
REVOKE ALL ON public.transaction_cases,public.transaction_case_links,public.transaction_case_link_history,public.transaction_case_reconciliation_issues FROM anon,authenticated;
ALTER TABLE public.transaction_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE public.transaction_case_links ENABLE ROW LEVEL SECURITY; ALTER TABLE public.transaction_case_link_history ENABLE ROW LEVEL SECURITY; ALTER TABLE public.transaction_case_reconciliation_issues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY transaction_cases_service ON public.transaction_cases FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY transaction_case_links_service ON public.transaction_case_links FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY transaction_case_history_service ON public.transaction_case_link_history FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY transaction_case_issues_service ON public.transaction_case_reconciliation_issues FOR ALL TO service_role USING(true) WITH CHECK(true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE ALL ON FUNCTION public.create_transaction_case(uuid,text,text,text,uuid),public.link_transaction_case_record(uuid,bigint,text,uuid,uuid,text),public.unlink_transaction_case_record(uuid,bigint,text,uuid,text),public.get_transaction_case_health(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_transaction_case(uuid,text,text,text,uuid),public.link_transaction_case_record(uuid,bigint,text,uuid,uuid,text),public.unlink_transaction_case_record(uuid,bigint,text,uuid,text),public.get_transaction_case_health(uuid) TO service_role;
