
-- Phase 1: Variant + scope awareness for report_templates resolver
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agency_id uuid,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- Constrain enum values via CHECK (allows NULL for variant = any)
DO $$ BEGIN
  ALTER TABLE public.report_templates
    ADD CONSTRAINT report_templates_variant_check
    CHECK (variant IS NULL OR variant IN ('composite','financial','due_diligence'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.report_templates
    ADD CONSTRAINT report_templates_scope_check
    CHECK (scope IN ('global','agency','user'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Resolver hot-path index
CREATE INDEX IF NOT EXISTS report_templates_resolver_idx
  ON public.report_templates (report_type, variant, scope, is_active, priority DESC, updated_at DESC);

-- Per-scope lookups
CREATE INDEX IF NOT EXISTS report_templates_agency_idx
  ON public.report_templates (agency_id) WHERE agency_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS report_templates_owner_idx
  ON public.report_templates (owner_user_id) WHERE owner_user_id IS NOT NULL;
