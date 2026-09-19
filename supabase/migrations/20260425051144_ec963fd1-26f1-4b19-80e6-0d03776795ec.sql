-- Phase 1: Additive Tier 6 rename for marketing_intelligence_reports.include_npc_strategy
ALTER TABLE public.marketing_intelligence_reports
  ADD COLUMN IF NOT EXISTS include_advisory_strategy boolean NOT NULL DEFAULT true;

-- Backfill from old column
UPDATE public.marketing_intelligence_reports
SET include_advisory_strategy = include_npc_strategy
WHERE include_advisory_strategy IS DISTINCT FROM include_npc_strategy;

-- Bidirectional sync trigger so legacy + new code both work during rollout
CREATE OR REPLACE FUNCTION public.sync_marketing_intelligence_strategy_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If only the old column changed, mirror it into the new one
  IF NEW.include_npc_strategy IS DISTINCT FROM OLD.include_npc_strategy
     AND NEW.include_advisory_strategy = OLD.include_advisory_strategy THEN
    NEW.include_advisory_strategy := NEW.include_npc_strategy;
  END IF;
  -- If only the new column changed, mirror it into the old one
  IF NEW.include_advisory_strategy IS DISTINCT FROM OLD.include_advisory_strategy
     AND NEW.include_npc_strategy = OLD.include_npc_strategy THEN
    NEW.include_npc_strategy := NEW.include_advisory_strategy;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_marketing_intelligence_strategy_flags_trg
  ON public.marketing_intelligence_reports;

CREATE TRIGGER sync_marketing_intelligence_strategy_flags_trg
BEFORE UPDATE ON public.marketing_intelligence_reports
FOR EACH ROW
EXECUTE FUNCTION public.sync_marketing_intelligence_strategy_flags();

-- Also handle INSERT: if only one is provided, mirror to the other
CREATE OR REPLACE FUNCTION public.init_marketing_intelligence_strategy_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Default values both come from column defaults (true). If caller supplied
  -- one but not the other, mirror across.
  IF NEW.include_advisory_strategy IS NULL AND NEW.include_npc_strategy IS NOT NULL THEN
    NEW.include_advisory_strategy := NEW.include_npc_strategy;
  ELSIF NEW.include_npc_strategy IS NULL AND NEW.include_advisory_strategy IS NOT NULL THEN
    NEW.include_npc_strategy := NEW.include_advisory_strategy;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS init_marketing_intelligence_strategy_flags_trg
  ON public.marketing_intelligence_reports;

CREATE TRIGGER init_marketing_intelligence_strategy_flags_trg
BEFORE INSERT ON public.marketing_intelligence_reports
FOR EACH ROW
EXECUTE FUNCTION public.init_marketing_intelligence_strategy_flags();

-- Phase 1: Additive sourced_by rename for client_properties
-- Backfill 'npc' rows to 'advisory' (new canonical value).
-- Keep 'npc' as a legal value so any in-flight client code still works.
UPDATE public.client_properties
SET sourced_by = 'advisory'
WHERE sourced_by = 'npc';