CREATE TABLE IF NOT EXISTS public.portal_terms_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), portal text NOT NULL CHECK(portal IN ('solicitor')), version text NOT NULL,
 title text NOT NULL, content_markdown text NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), effective_at timestamptz NOT NULL DEFAULT now(), retired_at timestamptz,
 created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(portal,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_one_current_idx ON public.portal_terms_versions(portal) WHERE retired_at IS NULL;
CREATE TABLE IF NOT EXISTS public.portal_terms_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), terms_version_id uuid NOT NULL REFERENCES public.portal_terms_versions(id), portal text NOT NULL CHECK(portal='solicitor'),
 solicitor_user_id uuid NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE, accepted_at timestamptz NOT NULL DEFAULT now(), ip_hash text, user_agent_hash text,
 UNIQUE(terms_version_id,solicitor_user_id)
);
CREATE TABLE IF NOT EXISTS public.solicitor_onboarding_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitor_user_id uuid NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
 step_key text NOT NULL CHECK(step_key IN ('profile_confirmed','privacy_acknowledged','security_reviewed')), mandatory boolean NOT NULL DEFAULT true,
 completed_at timestamptz, completed_session_id uuid REFERENCES public.solicitor_portal_sessions(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(solicitor_user_id,step_key)
);
ALTER TABLE public.legal_matters ADD COLUMN IF NOT EXISTS npc_internal_notes text;
CREATE TABLE IF NOT EXISTS public.client_legal_case_summary (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid, client_id uuid NOT NULL, legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
 matter_reference text, friendly_status text NOT NULL, shared_summary text, property_address text, settlement_date date, next_client_action text,
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(legal_matter_id)
);
DO $$ BEGIN
 INSERT INTO public.portal_terms_versions(portal,version,title,content_markdown)
 VALUES('solicitor','2026-07-30','Solicitor Portal Terms','Use of this portal is subject to confidentiality, privacy, professional obligations, and authorised matter access.')
 ON CONFLICT(portal,version) DO NOTHING;
END $$;
INSERT INTO public.solicitor_onboarding_steps(solicitor_user_id,step_key)
SELECT u.id,s.step_key FROM public.solicitor_portal_users u CROSS JOIN (VALUES('profile_confirmed'),('privacy_acknowledged'),('security_reviewed')) s(step_key)
ON CONFLICT(solicitor_user_id,step_key) DO NOTHING;
CREATE OR REPLACE FUNCTION public.seed_solicitor_onboarding_steps() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 INSERT INTO public.solicitor_onboarding_steps(solicitor_user_id,step_key) VALUES(NEW.id,'profile_confirmed'),(NEW.id,'privacy_acknowledged'),(NEW.id,'security_reviewed') ON CONFLICT DO NOTHING; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_seed_solicitor_onboarding_steps ON public.solicitor_portal_users;
CREATE TRIGGER trg_seed_solicitor_onboarding_steps AFTER INSERT ON public.solicitor_portal_users FOR EACH ROW EXECUTE FUNCTION public.seed_solicitor_onboarding_steps();
CREATE OR REPLACE FUNCTION public.sync_client_legal_case_summary() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NEW.client_id IS NULL THEN DELETE FROM public.client_legal_case_summary WHERE legal_matter_id=NEW.id; RETURN NEW; END IF;
 INSERT INTO public.client_legal_case_summary(client_id,legal_matter_id,matter_reference,friendly_status,shared_summary,property_address,settlement_date,updated_at)
 VALUES(NEW.client_id,NEW.id,NEW.matter_reference,replace(initcap(NEW.status::text),'_',' '),NEW.shared_summary,NEW.property_address,NEW.settlement_date,now())
 ON CONFLICT(legal_matter_id) DO UPDATE SET client_id=EXCLUDED.client_id,matter_reference=EXCLUDED.matter_reference,friendly_status=EXCLUDED.friendly_status,shared_summary=EXCLUDED.shared_summary,property_address=EXCLUDED.property_address,settlement_date=EXCLUDED.settlement_date,updated_at=now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sync_client_legal_case_summary ON public.legal_matters;
CREATE TRIGGER trg_sync_client_legal_case_summary AFTER INSERT OR UPDATE OF client_id,matter_reference,status,shared_summary,property_address,settlement_date ON public.legal_matters FOR EACH ROW EXECUTE FUNCTION public.sync_client_legal_case_summary();
INSERT INTO public.client_legal_case_summary(client_id,legal_matter_id,matter_reference,friendly_status,shared_summary,property_address,settlement_date)
SELECT client_id,id,matter_reference,replace(initcap(status::text),'_',' '),shared_summary,property_address,settlement_date FROM public.legal_matters WHERE client_id IS NOT NULL ON CONFLICT(legal_matter_id) DO NOTHING;
GRANT ALL ON public.portal_terms_versions,public.portal_terms_acceptances,public.solicitor_onboarding_steps,public.client_legal_case_summary TO service_role;
REVOKE ALL ON public.portal_terms_versions,public.portal_terms_acceptances,public.solicitor_onboarding_steps,public.client_legal_case_summary FROM anon,authenticated;
ALTER TABLE public.portal_terms_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.portal_terms_acceptances ENABLE ROW LEVEL SECURITY; ALTER TABLE public.solicitor_onboarding_steps ENABLE ROW LEVEL SECURITY; ALTER TABLE public.client_legal_case_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_terms_versions_service ON public.portal_terms_versions; DROP POLICY IF EXISTS portal_terms_acceptances_service ON public.portal_terms_acceptances; DROP POLICY IF EXISTS solicitor_onboarding_steps_service ON public.solicitor_onboarding_steps; DROP POLICY IF EXISTS client_legal_case_summary_service ON public.client_legal_case_summary;
CREATE POLICY portal_terms_versions_service ON public.portal_terms_versions FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY portal_terms_acceptances_service ON public.portal_terms_acceptances FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY solicitor_onboarding_steps_service ON public.solicitor_onboarding_steps FOR ALL TO service_role USING(true) WITH CHECK(true);
CREATE POLICY client_legal_case_summary_service ON public.client_legal_case_summary FOR ALL TO service_role USING(true) WITH CHECK(true);