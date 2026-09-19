DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;

CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();