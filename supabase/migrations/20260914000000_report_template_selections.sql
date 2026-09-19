-- Which template each report format is generated with.
--
-- ## What was missing
--
-- `report_templates` has held the design-system templates since Phase 4, and
-- `resolve_report_template()` picks one by RANKING them — scope, then variant,
-- then priority, then recency. Nobody chooses. There has never been a surface
-- anywhere in the product that binds a template to a report format for
-- generation: the only way to touch a template at all was to open the Template
-- Builder, which is an editor, not a chooser. So the person pressing "generate"
-- could not see which template their document would come out in, could not
-- change it, and could not tell whether it had changed under them.
--
-- One row here is one person's answer to "which template do Investment reports
-- come out in", and it is read before the ranking rather than instead of it: no
-- row means today's behaviour, unchanged.
--
-- ## Why the selection is per user
--
-- Because that is who makes it. A selection is not an approval — the template
-- had to pass `validateReportTemplateUpdate` (superadmin, approved, production
-- adapter, schema renders) to be `is_active` at all, and only active templates
-- are selectable. This row decides which of the already-approved templates one
-- person's reports use, which is a preference, not a permission.
--
-- The house default stays where it already lives: `is_default` and `priority`
-- on `report_templates`, applied by the ranking when nobody has chosen.
--
-- ROLLBACK: DROP TABLE IF EXISTS public.report_template_selections;

CREATE TABLE IF NOT EXISTS public.report_template_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: a preference belongs to the person who expressed it and means
  -- nothing once they are gone.
  owner_user_id uuid NOT NULL
    REFERENCES public.custom_users(id) ON DELETE CASCADE,

  -- The NORMALISED format key — the adapter's own `reportType`
  -- (`investment`, `borrowing_capacity`, …), never the raw `report_type` off a
  -- template row. Templates are stored under several spellings of the same
  -- format (`compass`, `investment_compass`, `investment_report` are all the
  -- Investment report), and a selection keyed on the spelling would be a
  -- different selection depending on which template happened to be picked.
  -- `normaliseReportType` in reportTemplateSelection.pure.ts is the one map.
  report_type text NOT NULL,

  -- CASCADE: a selection naming a deleted template is not a selection. The
  -- resolver also survives the softer case — a template that is still there but
  -- has been deactivated or retyped — by degrading to the ranking and saying so
  -- on the page rather than rendering something nobody chose.
  template_id uuid NOT NULL
    REFERENCES public.report_templates(id) ON DELETE CASCADE,

  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One answer per person per format. This is what "locked in" means: choosing
  -- again replaces the answer rather than adding a second one.
  UNIQUE (owner_user_id, report_type)
);

COMMENT ON TABLE public.report_template_selections IS
  'One row per (user, report format): the report_templates row that user''s reports of that format are generated with. Read ahead of resolve_report_template(); absent means fall back to the ranking. Written only through the manage-templates broker, which scopes every operation to the session user.';

COMMENT ON COLUMN public.report_template_selections.report_type IS
  'Normalised format key (the adapter''s reportType), never the raw report_type off a template row.';

-- The read the generation path makes: "what has this person chosen?", answered
-- in one index hit for every format at once.
CREATE INDEX IF NOT EXISTS report_template_selections_owner_idx
  ON public.report_template_selections (owner_user_id, report_type);

-- The read the template-retirement path makes: "who is still pointing at this?"
CREATE INDEX IF NOT EXISTS report_template_selections_template_idx
  ON public.report_template_selections (template_id);

DROP TRIGGER IF EXISTS report_template_selections_set_updated_at
  ON public.report_template_selections;
CREATE TRIGGER report_template_selections_set_updated_at
  BEFORE UPDATE ON public.report_template_selections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- No direct client access at all. Every read and write goes through
-- `manage-templates`, which holds a service-role client and scopes each
-- operation to `owner_user_id = <session user>` explicitly — the same treatment
-- `comparison_analysis_templates` gets, and for the same reason: a service-role
-- client bypasses RLS, so ownership has to be enforced in the broker rather
-- than assumed from the policy. RLS is enabled with no policy so that a
-- credential which somehow reached the table directly still reads nothing.

ALTER TABLE public.report_template_selections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.report_template_selections FROM anon, authenticated;
GRANT ALL ON public.report_template_selections TO service_role;
