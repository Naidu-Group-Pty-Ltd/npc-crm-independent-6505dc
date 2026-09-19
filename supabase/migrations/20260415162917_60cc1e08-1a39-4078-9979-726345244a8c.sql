CREATE TABLE public.cover_page_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  report_type text NOT NULL,
  background_image_url text,
  canvas_width integer NOT NULL DEFAULT 595,
  canvas_height integer NOT NULL DEFAULT 842,
  overlay_elements jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.custom_users(id)
);

ALTER TABLE public.cover_page_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cover overlays"
  ON public.cover_page_overlays FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage cover overlays"
  ON public.cover_page_overlays FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);