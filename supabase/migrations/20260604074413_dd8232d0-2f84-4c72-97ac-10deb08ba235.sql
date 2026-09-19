
-- ============================================================
-- Hero Image Studio: cross-report image library + per-chapter placements
-- ============================================================

CREATE TABLE public.hero_image_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  source_report_id uuid,
  prompt text NOT NULL,
  enhanced_prompt text,
  model text NOT NULL DEFAULT 'openai/gpt-image-2',
  aspect_ratio text NOT NULL DEFAULT '3:2',
  width int NOT NULL DEFAULT 1536,
  height int NOT NULL DEFAULT 1024,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending','processing','ready','failed')),
  storage_path text,
  public_url text,
  thumbnail_url text,
  tags text[] NOT NULL DEFAULT '{}',
  error text,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.hero_image_library TO service_role;
ALTER TABLE public.hero_image_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.hero_image_library
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_hil_owner ON public.hero_image_library (owner_user_id, is_archived, created_at DESC);
CREATE INDEX idx_hil_source_report ON public.hero_image_library (source_report_id);
CREATE INDEX idx_hil_model ON public.hero_image_library (model);

CREATE TRIGGER trg_hil_updated_at
  BEFORE UPDATE ON public.hero_image_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================

CREATE TABLE public.report_hero_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  section_key text NOT NULL,
  section_title text NOT NULL,
  library_image_id uuid NOT NULL REFERENCES public.hero_image_library(id) ON DELETE CASCADE,
  render_height text NOT NULL DEFAULT 'standard' CHECK (render_height IN ('compact','standard','tall','full_bleed')),
  render_width text NOT NULL DEFAULT 'content' CHECK (render_width IN ('content','full_bleed')),
  object_fit text NOT NULL DEFAULT 'cover' CHECK (object_fit IN ('cover','contain')),
  focal text NOT NULL DEFAULT 'center' CHECK (focal IN ('top','center','bottom')),
  rounded boolean NOT NULL DEFAULT true,
  position_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, section_key)
);

GRANT ALL ON public.report_hero_placements TO service_role;
ALTER TABLE public.report_hero_placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.report_hero_placements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_rhp_report ON public.report_hero_placements (report_id);
CREATE INDEX idx_rhp_library ON public.report_hero_placements (library_image_id);

CREATE TRIGGER trg_rhp_updated_at
  BEFORE UPDATE ON public.report_hero_placements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
