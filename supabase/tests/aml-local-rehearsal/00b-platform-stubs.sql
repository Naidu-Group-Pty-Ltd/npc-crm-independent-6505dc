-- Platform-environment stubs the migration chain needs beyond 00-preamble.
-- Discovered during the release-candidate rehearsal and confirmed during the
-- post-merge re-rehearsal: without these, the 60-file chain stops partway
-- (first at 20260721130000_security_phase7_pin_function_search_path.sql).
-- Everything here mirrors objects a real Supabase project (or an earlier
-- non-AML platform migration outside the chain) already provides. Stubs
-- never replace an AML object — the three aml.* functions that migration
-- pins must come from the chain itself.

-- auth.users (Supabase-managed; FK target of platform tables)
CREATE TABLE IF NOT EXISTS auth.users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

-- Platform user tables referenced by helpers and FKs
CREATE TABLE IF NOT EXISTS public.custom_users(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  is_active boolean DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_roles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role text,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- storage.buckets columns later migrations reference on insert
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit bigint;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types text[];
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Generic updated_at trigger helper many platform tables use
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Realtime publication (Supabase-managed) so ALTER PUBLICATION applies.
-- Emits a wal_level warning on a plain postgres image; harmless here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- No-op bodies for the five NON-AML functions that
-- 20260721130000_security_phase7_pin_function_search_path.sql ALTERs.
-- (aml.set_updated_at / aml.tg_touch_updated_at / aml.touch_updated_at are
-- deliberately NOT stubbed — the chain must create them or the gate fails.)
CREATE OR REPLACE FUNCTION public.fp_threads_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.touch_pdf_import_chunks_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.address_values_match(text, text, text, text, text, text, text, text, text, text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.chart_config_is_live(jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
