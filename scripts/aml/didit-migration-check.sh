#!/usr/bin/env bash
#
# Applies the Didit hosted-IDV migration to a throwaway PostgreSQL and asserts
# the three behaviours it exists for. Run it before shipping a change to
# 20260908000000 — none of these can be established by reading the SQL.
#
#   bash scripts/aml/didit-migration-check.sh
#
# Requires a local PostgreSQL (initdb/pg_ctl/psql on PATH or in
# /usr/lib/postgresql/*/bin). Exits non-zero on any failed assertion.
set -uo pipefail

PGPORT="${DIDIT_PGPORT:-54399}"
PGDIR="${DIDIT_PGDIR:-/tmp/pgdidit}"
SOCK=/tmp
# `psql` usually lives in /usr/bin while initdb/pg_ctl do not — they sit in the
# versioned server directory. Pick the directory that actually has initdb, or
# this fails as "postgres did not start" with an empty log.
PGBIN=""
for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /usr/local/pgsql/bin /usr/bin; do
  [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && PGBIN="$d"
done
if [ -z "$PGBIN" ]; then
  echo "No PostgreSQL server binaries (initdb/pg_ctl) found — skipping these checks."
  exit 0
fi
PSQL_BIN="$(command -v psql || echo "$PGBIN/psql")"
export PATH="$PGBIN:$PATH"

psql_() { "$PSQL_BIN" -h "$SOCK" -p "$PGPORT" -U postgres "$@"; }
q() { psql_ -tAc "$1"; }

fails=0
ok() {
  if [ "$2" == "$3" ]; then printf '  ✓ %s\n' "$1"
  else printf '  ✗ %s — expected %s, got %s\n' "$1" "$3" "$2"; fails=$((fails+1)); fi
}

# ── Fresh cluster ──────────────────────────────────────────────────────────
# Note: no `pkill -f postgres...` cleanup here. That pattern also matches the
# command line of the shell running this script, so it kills the run rather
# than the leftover. `pg_ctl` on the data directory is the correct tool.
if [ -d "$PGDIR" ]; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true
  sleep 1
  rm -rf "$PGDIR"
fi
rm -f "$SOCK/.s.PGSQL.$PGPORT" 2>/dev/null || true
mkdir -p "$PGDIR" && chown postgres:postgres "$PGDIR"
su postgres -c "$PGBIN/initdb -U postgres -A trust -D $PGDIR" >/dev/null 2>&1
su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k $SOCK' -l /tmp/pg-didit.log start" >/dev/null 2>&1
for _ in $(seq 1 30); do q 'select 1' >/dev/null 2>&1 && break; sleep 1; done
q 'select 1' >/dev/null 2>&1 || {
  echo "postgres did not start on :$PGPORT"; echo "--- log ---"
  cat /tmp/pg-didit.log 2>/dev/null; exit 1; }

# ── Enough of the platform schema for the AML migrations to run ────────────
# Deliberately minimal: this proves the Didit migration, not the whole product.
psql_ -q >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA aml; CREATE SCHEMA storage;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.integration_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_type text, aggregate_id uuid,
  event_type text, event_version int, payload jsonb, idempotency_key text UNIQUE,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.client_portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, title text, message text,
  type text, category text, action_url text, metadata jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE aml.tenant_settings (tenant_id text PRIMARY KEY);
INSERT INTO aml.tenant_settings VALUES ('default');
CREATE TABLE aml.cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_display_name text, client_id uuid);
CREATE TABLE aml.consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE aml.identity_checks (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE aml.screening_checks (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE aml.consent_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, version text, title text, summary text, body text, acknowledgement_type text,
  statutory_basis text[], reference_links jsonb, sort_order int, required boolean DEFAULT true,
  superseded_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE aml.client_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid, kind text, subject text, message text, status text,
  created_at timestamptz DEFAULT now(), due_at timestamptz);
CREATE TABLE aml.provider_configs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  capability text NOT NULL, provider_key text NOT NULL, display_label text,
  priority integer NOT NULL DEFAULT 1, cost_per_unit_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD', active boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'simulator', secret_ref text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb, last_health_at timestamptz, last_health_status text,
  last_health_message text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, capability, provider_key));
CREATE TABLE aml.provider_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, event_type TEXT NOT NULL, dedup_key TEXT NOT NULL,
  signature_ok BOOLEAN NOT NULL DEFAULT false, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  identity_check_id UUID REFERENCES aml.identity_checks(id) ON DELETE SET NULL,
  screening_check_id UUID REFERENCES aml.screening_checks(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ, error TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, dedup_key));
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text,
  name text, owner uuid, created_at timestamptz DEFAULT now(), metadata jsonb);
CREATE OR REPLACE FUNCTION public.has_any_aml_role(_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION aml.has_any_aml_role(_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
-- Production carries this guard and the local rehearsal did not, which is why
-- the migration passed here and failed against dduzbchuswwbefdunfct. Modelled
-- now so the gap cannot reopen.
CREATE OR REPLACE FUNCTION aml.tg_reject_simulator_idv() RETURNS trigger
  LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.capability = 'idv' AND NEW.mode = 'simulator' THEN
    RAISE EXCEPTION
      'Identity-verification providers are live-only. Configure the selfhosted provider as live.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER trg_aml_reject_simulator_idv
  BEFORE INSERT OR UPDATE ON aml.provider_configs
  FOR EACH ROW EXECUTE FUNCTION aml.tg_reject_simulator_idv();
SQL

echo "Applying the verification-check migration chain…"
for f in \
  supabase/migrations/20260728120000_*.sql \
  supabase/migrations/20260728160000_*.sql \
  supabase/migrations/20260831000000_*.sql \
  supabase/migrations/20260831000100_*.sql \
  supabase/migrations/20260901000200_*.sql \
  supabase/migrations/20260908000000_*.sql
do
  errs=$(psql_ -q -f "$f" 2>&1 | grep -ci 'ERROR' || true)
  printf '  %-58s errors=%s\n' "$(basename "$f")" "$errs"
  # Only the Didit migration is under test here; earlier ones touch platform
  # objects this cut-down schema deliberately does not carry.
  case "$f" in *20260908000000*) ok "Didit migration applies cleanly" "$errs" "0";; esac
done

psql_ -q -c "INSERT INTO aml.cases (id, subject_display_name)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Test Subject') ON CONFLICT DO NOTHING;" >/dev/null 2>&1

echo
echo "Behaviour:"

# 1. A self-hosted check still reaches the outbox worker.
psql_ -q -c "INSERT INTO aml.verification_checks
  (case_id, party_label, check_type, status, provider, processing_status,
   capture_sequence, attempt_number, document_reference)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Self Hosted','electronic_idv','pending',
          'selfhosted','queued',1,1,'case/doc.jpg');" >/dev/null 2>&1
ok "selfhosted check emits aml.verification.requested" \
   "$(q "SELECT count(*) FROM public.integration_outbox WHERE event_type='aml.verification.requested'")" "1"

# 2. A hosted check does not — this is the storage_unreadable defence.
psql_ -q -c "INSERT INTO aml.verification_checks
  (case_id, party_label, check_type, status, provider, processing_status,
   capture_sequence, attempt_number, document_reference)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Didit Party','electronic_idv','pending',
          'didit','queued',2,2,NULL);" >/dev/null 2>&1
ok "hosted check emits NOTHING (stays out of the image worker)" \
   "$(q "SELECT count(*) FROM public.integration_outbox WHERE event_type='aml.verification.requested'")" "1"

# 3. One active hosted session per party, enforced by the database.
dup=$(psql_ -q -c "INSERT INTO aml.verification_checks
  (case_id, party_label, check_type, status, provider, processing_status,
   capture_sequence, attempt_number, document_reference)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Didit Party','electronic_idv','pending',
          'didit','queued',3,3,NULL);" 2>&1 | grep -c 'uq_aml_verification_active_hosted_session' || true)
ok "a second active hosted session is refused (23505)" "$dup" "1"

# 4. …and releasing the first frees the slot, so a customer who abandoned one
#    session is never locked out.
psql_ -q -c "UPDATE aml.verification_checks
  SET processing_status='cancelled', superseded_at=now(), superseded_reason='abandoned'
  WHERE provider='didit' AND processing_status='queued';" >/dev/null 2>&1
psql_ -q -c "INSERT INTO aml.verification_checks
  (case_id, party_label, check_type, status, provider, processing_status,
   capture_sequence, attempt_number, document_reference)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','Didit Party','electronic_idv','pending',
          'didit','queued',4,4,NULL);" >/dev/null 2>&1
# Asserted on resulting STATE, not on psql's output: `-q` suppresses the
# "INSERT 0 1" line, so grepping for it reports a false failure.
ok "releasing an abandoned session frees the slot" \
   "$(q "SELECT count(*) FROM aml.verification_checks
          WHERE provider='didit' AND processing_status='queued' AND capture_sequence=4")" "1"

# 5. Attempt accounting is untouched by any of the above.
ok "no attempt consumed by session creation" \
   "$(q "SELECT aml.verification_attempts_used('aaaaaaaa-0000-4000-8000-000000000001'::uuid, NULL)")" "0"

# 6. Objects, and the provider seeded INACTIVE.
ok "active-session unique index exists" \
   "$(q "SELECT count(*) FROM pg_indexes WHERE schemaname='aml' AND indexname='uq_aml_verification_active_hosted_session'")" "1"
ok "provider_events.verification_check_id exists" \
   "$(q "SELECT count(*) FROM information_schema.columns WHERE table_schema='aml' AND table_name='provider_events' AND column_name='verification_check_id'")" "1"
ok "didit provider row is seeded INACTIVE" \
   "$(q "SELECT active FROM aml.provider_configs WHERE provider_key='didit'")" "f"
# Live-only: the column default is 'simulator' and production rejects that.
ok "didit provider row is mode=live (production rejects simulator idv)" \
   "$(q "SELECT mode FROM aml.provider_configs WHERE provider_key='didit'")" "live"

# 7. Re-applying must be a no-op.
reerrs=$(psql_ -q -f supabase/migrations/20260908000000_*.sql 2>&1 | grep -ci 'ERROR' || true)
ok "migration is idempotent" "$reerrs" "0"
ok "re-apply does not duplicate the provider row" \
   "$(q "SELECT count(*) FROM aml.provider_configs WHERE provider_key='didit'")" "1"

su postgres -c "$PGBIN/pg_ctl -D $PGDIR stop" >/dev/null 2>&1 || true
rm -rf "$PGDIR"

echo
if [ "$fails" -eq 0 ]; then echo "All migration behaviour checks passed."; exit 0; fi
echo "$fails check(s) FAILED."; exit 1
