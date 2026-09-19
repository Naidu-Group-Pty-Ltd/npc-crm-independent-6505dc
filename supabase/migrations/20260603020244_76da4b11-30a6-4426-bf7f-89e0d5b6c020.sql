
CREATE TABLE public.purchase_file_applicants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'co_borrower' CHECK (role IN ('primary','co_borrower','guarantor')),
  email text,
  phone text,
  date_of_birth date,
  is_primary boolean NOT NULL DEFAULT false,
  position smallint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pf_applicants_pf ON public.purchase_file_applicants(purchase_file_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_file_applicants TO authenticated;
GRANT ALL ON public.purchase_file_applicants TO service_role;
ALTER TABLE public.purchase_file_applicants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_pf_applicants" ON public.purchase_file_applicants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.purchase_file_onboarding_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_file_id uuid NOT NULL REFERENCES public.purchase_files(id) ON DELETE CASCADE,
  client_id uuid,
  step_key text NOT NULL,
  label text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general','docs','consents','compliance','property','finance','client_action','broker_action')),
  owner text NOT NULL DEFAULT 'client' CHECK (owner IN ('client','broker','shared')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','complete','skipped','blocked')),
  position smallint NOT NULL DEFAULT 0,
  visible_to_client boolean NOT NULL DEFAULT true,
  completed_at timestamptz,
  completed_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_file_id, step_key)
);
CREATE INDEX idx_pf_onboarding_pf ON public.purchase_file_onboarding_checklist(purchase_file_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_file_onboarding_checklist TO authenticated;
GRANT ALL ON public.purchase_file_onboarding_checklist TO service_role;
ALTER TABLE public.purchase_file_onboarding_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_pf_onboarding" ON public.purchase_file_onboarding_checklist FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.finance_partner_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_duration_min smallint NOT NULL DEFAULT 30,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fp_availability_user ON public.finance_partner_availability(finance_user_id, weekday);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_partner_availability TO authenticated;
GRANT ALL ON public.finance_partner_availability TO service_role;
ALTER TABLE public.finance_partner_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_fp_avail" ON public.finance_partner_availability FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.finance_partner_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL,
  client_id uuid,
  purchase_file_id uuid REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  booked_by text NOT NULL DEFAULT 'client' CHECK (booked_by IN ('client','partner','staff')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  meeting_type text NOT NULL DEFAULT 'video' CHECK (meeting_type IN ('video','phone','in_person')),
  meeting_url text,
  topic text,
  notes text,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show','rescheduled')),
  cancelled_reason text,
  contact_email text,
  contact_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fp_bookings_user_time ON public.finance_partner_bookings(finance_user_id, start_at);
CREATE INDEX idx_fp_bookings_pf ON public.finance_partner_bookings(purchase_file_id);
CREATE INDEX idx_fp_bookings_client ON public.finance_partner_bookings(client_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_partner_bookings TO authenticated;
GRANT ALL ON public.finance_partner_bookings TO service_role;
ALTER TABLE public.finance_partner_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_fp_bookings" ON public.finance_partner_bookings FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.document_requirement_instances
  ADD COLUMN IF NOT EXISTS applicant_id uuid REFERENCES public.purchase_file_applicants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_reminder_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_level text NOT NULL DEFAULT 'gentle' CHECK (escalation_level IN ('gentle','firm','broker_notified'));

CREATE INDEX IF NOT EXISTS idx_dri_auto_reminder ON public.document_requirement_instances(auto_reminder_enabled, last_reminder_sent_at)
  WHERE auto_reminder_enabled = true;
