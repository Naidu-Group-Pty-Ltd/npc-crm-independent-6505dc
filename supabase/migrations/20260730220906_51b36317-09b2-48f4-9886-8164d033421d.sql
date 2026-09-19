ALTER TABLE public.document_records ADD COLUMN IF NOT EXISTS allow_external_ai boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.firm_ai_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL UNIQUE REFERENCES public.solicitor_firms(id) ON DELETE CASCADE,
 external_processing_enabled boolean NOT NULL DEFAULT false, consent_version text, consented_at timestamptz, consented_by uuid,
 provider text NOT NULL DEFAULT 'lovable_gateway', allowed_models text[] NOT NULL DEFAULT ARRAY['google/gemini-3.6-flash'],
 max_input_tokens integer NOT NULL DEFAULT 120000 CHECK(max_input_tokens BETWEEN 1000 AND 250000),
 max_output_tokens integer NOT NULL DEFAULT 8000 CHECK(max_output_tokens BETWEEN 256 AND 32000),
 max_cost_usd numeric(10,4) NOT NULL DEFAULT 5 CHECK(max_cost_usd BETWEEN 0 AND 100),
 timeout_seconds integer NOT NULL DEFAULT 90 CHECK(timeout_seconds BETWEEN 5 AND 120), redaction_profile text NOT NULL DEFAULT 'legal_standard',
 circuit_open_until timestamptz, consecutive_failures integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ai_prompt_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prompt_key text NOT NULL, version integer NOT NULL CHECK(version>0),
 content text NOT NULL, content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$') CHECK(content_sha256=encode(digest(content,'sha256'),'hex')), jurisdiction text NOT NULL DEFAULT 'AU',
 active boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(prompt_key,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompt_one_active ON public.ai_prompt_versions(prompt_key,jurisdiction) WHERE active;
CREATE TABLE IF NOT EXISTS public.ai_analysis_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), firm_id uuid NOT NULL REFERENCES public.solicitor_firms(id), legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id),
 prompt_version_id uuid NOT NULL REFERENCES public.ai_prompt_versions(id), provider text NOT NULL, model text NOT NULL,
 idempotency_key text NOT NULL UNIQUE, status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','blocked')),
 review_status text NOT NULL DEFAULT 'draft' CHECK(review_status IN ('draft','review_required','confirmed','partially_confirmed','rejected','superseded')),
 redaction_profile text NOT NULL, jurisdiction text NOT NULL, request_correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'), output_hash text CHECK(output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
 input_tokens integer, output_tokens integer, cost_usd numeric(10,4), error_code text, legacy_analysis_id uuid REFERENCES public.legal_contract_analyses(id),
 requested_by uuid NOT NULL, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_runs_matter ON public.ai_analysis_runs(legal_matter_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ai_analysis_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
 document_version_id uuid NOT NULL REFERENCES public.document_versions(id), source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 permission_confirmed_at timestamptz NOT NULL, UNIQUE(run_id,document_version_id)
);
CREATE TABLE IF NOT EXISTS public.ai_analysis_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
 review_status text NOT NULL CHECK(review_status IN ('confirmed','partially_confirmed','rejected','superseded')),
 reviewer_id uuid NOT NULL, notes text, reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_reviews_run ON public.ai_analysis_reviews(run_id,reviewed_at DESC);

CREATE OR REPLACE FUNCTION public.review_ai_analysis_run(_run_id uuid,_reviewer_id uuid,_status text,_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r public.ai_analysis_runs%ROWTYPE; BEGIN
 IF _status NOT IN ('confirmed','partially_confirmed','rejected','superseded') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_AI_REVIEW_STATUS'; END IF;
 SELECT * INTO r FROM public.ai_analysis_runs WHERE id=_run_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='AI_RUN_NOT_FOUND'; END IF;
 IF r.status<>'succeeded' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='AI_RUN_NOT_REVIEWABLE'; END IF;
 INSERT INTO public.ai_analysis_reviews(run_id,review_status,reviewer_id,notes) VALUES(r.id,_status,_reviewer_id,left(_notes,4000));
 UPDATE public.ai_analysis_runs SET review_status=_status,updated_at=now() WHERE id=r.id RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;

GRANT ALL ON public.firm_ai_policies,public.ai_prompt_versions,public.ai_analysis_runs,public.ai_analysis_sources,public.ai_analysis_reviews TO service_role;
REVOKE ALL ON public.firm_ai_policies,public.ai_prompt_versions,public.ai_analysis_runs,public.ai_analysis_sources,public.ai_analysis_reviews FROM anon,authenticated;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['firm_ai_policies','ai_prompt_versions','ai_analysis_runs','ai_analysis_sources','ai_analysis_reviews'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); BEGIN EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t||'_service',t); EXCEPTION WHEN duplicate_object THEN NULL; END; END LOOP; END $$;
REVOKE ALL ON FUNCTION public.review_ai_analysis_run(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.review_ai_analysis_run(uuid,uuid,text,text) TO service_role;

INSERT INTO public.ai_prompt_versions(prompt_key,version,content,content_sha256,jurisdiction,active)
VALUES('legal_contract_review',1,'Australian conveyancing contract structured review. Assistive output only; identify uncertainty and require practitioner confirmation.','b13ae237a804da546e40627bc8b7ec3afbb3c5baab8b163c96638e83a02659c1','AU',true)
ON CONFLICT(prompt_key,version) DO NOTHING;