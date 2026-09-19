-- ============================================================
-- Two writes the database refused, both of which reported as success.
--
-- Found by the 19 Sep 2026 clone audit, on the prime and the clone alike.
-- ============================================================

-- ── 1. `client_files.storage_bucket` did not know the bucket was renamed ────
--
-- `client_files_storage_bucket_check` was written on 2026-07-23 and allows
-- ('client-files', 'client-documents', 'vownet-forms'). Eight days later the
-- Client Forms feature was renamed: the storage bucket became `formara-forms`
-- (20260731005447, which rewrote the bucket's policies) and the category check
-- gained 'formara' (20260731005818). The bucket CHECK was not touched, and
-- nothing pointed at it.
--
-- So `ClientFormaraForms` uploads the workbook to `formara-forms` — that half
-- works, the object is stored — and then writes the `client_files` row naming
-- `storage_bucket: 'formara-forms'`, which violates the constraint. The insert
-- is rejected, and because the import does not read the result of that write it
-- still reports "Import Complete!" over a list that reads "Imported Client
-- Detail Forms (0)". The parsed client data really is imported; only the record
-- of the file it came from is lost, which is what makes it invisible.
--
-- The list is widened to the buckets that exist. `vownet-forms` stays: it is
-- the pre-rename name and rows written before 2026-07-31 still carry it (the
-- client reads it through a scoped legacy resolver).
ALTER TABLE public.client_files
  DROP CONSTRAINT IF EXISTS client_files_storage_bucket_check;

ALTER TABLE public.client_files
  ADD CONSTRAINT client_files_storage_bucket_check
  CHECK (
    storage_bucket IS NULL
    OR storage_bucket IN (
      'client-files',
      'client-documents',
      'formara-forms',
      -- Pre-rename rows. Read-only in practice; nothing writes it any more.
      'vownet-forms'
    )
  );

COMMENT ON CONSTRAINT client_files_storage_bucket_check ON public.client_files IS
  'The private buckets a client file may live in. Must name every bucket `secureStorageUpload` is called with for a client file — a bucket missing here rejects the row while the object upload succeeds, which looks exactly like an import that worked.';

-- ── 2. Re-assert the finance-partner accrual triggers ───────────────────────
--
-- `20260902000000_fix_fp_accrual_client_name_and_isolation.sql` corrected both
-- accrual functions: they read CONCAT(first_name, ' ', last_name) FROM
-- public.clients, columns that table has never had (the real ones are
-- primary_first_name / primary_surname), so Postgres raised 42703 inside an
-- AFTER trigger and aborted the statement that fired it.
--
-- On 18 Sep 2026 the prime still answered "Failed to update record (column
-- \"first_name\" does not exist)" when a commission was marked received, which
-- means the deployed function is still the pre-fix definition — a migration
-- recorded as applied does not prove the function it defines is the one in the
-- database, and there is no way to tell from here which it is. Re-asserting is
-- idempotent either way: `CREATE OR REPLACE FUNCTION` with the same body is a
-- no-op where the fix landed, and the repair where it did not.
--
-- The bodies below are byte-identical to 20260902000000's. Two properties
-- matter and are restated here so a future reader does not have to find them:
-- the client's name is read from the columns `clients` actually has, and each
-- accrual body is wrapped so a fault in it is logged as a WARNING rather than
-- vetoing the operational write. Accrual is bookkeeping; the payment update is
-- the act, and bookkeeping must never be able to refuse it.
CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_build_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id UUID;
  v_rate NUMERIC;
  v_gst BOOLEAN;
  v_basis NUMERIC;
  v_gross NUMERIC;
  v_gst_amt NUMERIC;
  v_net NUMERIC;
  v_partner_name TEXT;
  v_partner_company TEXT;
  v_client_name TEXT;
  v_deal_type TEXT;
  v_client_id UUID;
BEGIN
  IF NEW.is_commission_trigger IS NOT TRUE THEN RETURN NEW; END IF;
  IF NEW.commission_received IS NOT TRUE THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.commission_received IS TRUE) THEN RETURN NEW; END IF;

  BEGIN
    SELECT * INTO v_partner_id, v_rate, v_gst
    FROM public.fp_resolve_partner_for_deal(NEW.deal_id);

    IF v_partner_id IS NULL THEN RETURN NEW; END IF;

    SELECT d.client_id, d.deal_type INTO v_client_id, v_deal_type
    FROM public.client_deals d WHERE d.id = NEW.deal_id;

    SELECT name, company INTO v_partner_name, v_partner_company
    FROM public.finance_agent_contacts WHERE id = v_partner_id;

    SELECT COALESCE(NULLIF(TRIM(CONCAT(primary_first_name, ' ', primary_surname)), ''), 'Client')
      INTO v_client_name FROM public.clients WHERE id = v_client_id;

    v_basis := COALESCE(NEW.amount, 0);
    v_gross := ROUND(v_basis * COALESCE(v_rate, 0) / 100.0, 2);
    v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
    v_net := v_gross - v_gst_amt;

    INSERT INTO public.finance_partner_commissions (
      finance_contact_id, client_id, deal_id, build_payment_id,
      partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
      commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
      trigger_event, status, notes
    ) VALUES (
      v_partner_id, v_client_id, NEW.deal_id, NEW.id,
      v_partner_name, v_partner_company, v_client_name, v_deal_type,
      'build_payment', v_basis, COALESCE(v_rate, 0), v_gross, v_gst_amt, v_net,
      'build_payment_received', 'pending',
      CONCAT('Auto-accrued from build payment: ', NEW.stage_name)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fp_accrue_commission_from_build_payment failed for payment % (deal %): %',
      NEW.id, NEW.deal_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fp_accrue_commission_from_deal_settlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner_id UUID;
  v_rate NUMERIC;
  v_gst BOOLEAN;
  v_basis NUMERIC;
  v_gross NUMERIC;
  v_gst_amt NUMERIC;
  v_net NUMERIC;
  v_partner_name TEXT;
  v_partner_company TEXT;
  v_client_name TEXT;
BEGIN
  IF NEW.deal_type NOT IN ('refinance', 'existing_property') THEN RETURN NEW; END IF;
  IF NEW.current_stage IS NULL THEN RETURN NEW; END IF;
  IF NEW.current_stage !~* '(settled|settlement complete|unconditional)' THEN RETURN NEW; END IF;
  IF (TG_OP = 'UPDATE' AND OLD.current_stage = NEW.current_stage) THEN RETURN NEW; END IF;

  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.finance_partner_commissions
      WHERE deal_id = NEW.id AND trigger_event = 'deal_settled' AND status <> 'void'
    ) THEN RETURN NEW; END IF;

    SELECT * INTO v_partner_id, v_rate, v_gst
    FROM public.fp_resolve_partner_for_deal(NEW.id);

    IF v_partner_id IS NULL THEN RETURN NEW; END IF;

    SELECT name, company INTO v_partner_name, v_partner_company
    FROM public.finance_agent_contacts WHERE id = v_partner_id;

    SELECT COALESCE(NULLIF(TRIM(CONCAT(primary_first_name, ' ', primary_surname)), ''), 'Client')
      INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

    v_basis := COALESCE((to_jsonb(NEW)->>'loan_amount')::NUMERIC, 0);
    v_gross := ROUND(v_basis * COALESCE(v_rate, 0) / 100.0, 2);
    v_gst_amt := CASE WHEN v_gst THEN ROUND(v_gross * 0.10, 2) ELSE 0 END;
    v_net := v_gross - v_gst_amt;

    INSERT INTO public.finance_partner_commissions (
      finance_contact_id, client_id, deal_id,
      partner_name_snapshot, partner_company_snapshot, client_name_snapshot, deal_type_snapshot,
      commission_basis, basis_amount, rate_pct, gross_amount, gst_amount, net_amount,
      trigger_event, status, notes
    ) VALUES (
      v_partner_id, NEW.client_id, NEW.id,
      v_partner_name, v_partner_company, v_client_name, NEW.deal_type,
      'loan_amount', v_basis, COALESCE(v_rate, 0), v_gross, v_gst_amt, v_net,
      'deal_settled', 'pending',
      CONCAT('Auto-accrued on settlement (', NEW.current_stage, ')',
             CASE WHEN v_basis = 0 THEN ' — loan amount required' ELSE '' END)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fp_accrue_commission_from_deal_settlement failed for deal %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ── 3. The invitation ledger could only hold finance partners ───────────────
--
-- `appointment_secondary_recipients` is the record of who was invited to a
-- booking. It is what the booking's detail panel lists, what a reschedule
-- notice is addressed to, and what a cancellation reads back to know whom to
-- tell — the command centre itself holds none of that.
--
-- The table was written for finance partners and never widened:
-- `finance_contact_id UUID NOT NULL`. An additional contact has no finance
-- contact id and the client has none either, so every insert for one of them
-- violated the constraint and no row was written. The ledger therefore held
-- finance partners and nobody else, which is why the 19 Sep 2026 clone audit
-- found three symptoms of one fault: the booking's detail window listed no
-- additional contact, a reschedule did not reach them, and a cancellation did
-- not either.
--
-- The column becomes nullable and a `role` is recorded beside it, so the
-- ledger says what each person was rather than leaving it to be inferred from
-- whether an id happens to be present.
ALTER TABLE public.appointment_secondary_recipients
  ALTER COLUMN finance_contact_id DROP NOT NULL;

ALTER TABLE public.appointment_secondary_recipients
  ADD COLUMN IF NOT EXISTS recipient_role TEXT;

DO $$ BEGIN
  ALTER TABLE public.appointment_secondary_recipients
    ADD CONSTRAINT appointment_secondary_recipients_role_check
    CHECK (recipient_role IS NULL OR recipient_role IN ('client', 'additional_contact', 'finance_partner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Every row written so far is a finance partner, because no other kind could
-- be written. Stamping them says so rather than leaving the column ambiguous
-- between "a finance partner" and "written before this migration".
UPDATE public.appointment_secondary_recipients
   SET recipient_role = 'finance_partner'
 WHERE recipient_role IS NULL
   AND finance_contact_id IS NOT NULL;

COMMENT ON COLUMN public.appointment_secondary_recipients.finance_contact_id IS
  'The finance partner this invitation is for, when it is one. NULL for a client or an additional contact — they have no finance contact id, and requiring one meant they could never be recorded as invited at all.';
COMMENT ON COLUMN public.appointment_secondary_recipients.recipient_role IS
  'client | additional_contact | finance_partner. What this person is to the booking, recorded rather than inferred from whether finance_contact_id is set.';

-- ===========================================================================
-- 4. Close EXECUTE on the two accrual functions this migration re-asserted
-- ===========================================================================
--
-- `CREATE OR REPLACE FUNCTION` on a SECURITY DEFINER function re-grants EXECUTE
-- to PUBLIC, and this project's default privileges grant it DIRECTLY to `anon`
-- and `authenticated` besides — so re-asserting a function body verbatim, which
-- is what section 2 does, reopens it to the publishable key in the browser
-- bundle. Revoking from PUBLIC alone is a no-op for `anon` here (20261129090000)
-- and revoking from `anon` alone is a no-op because the grant is PUBLIC's
-- (RLS-W5, 20260725096000), which is why all three are named.
--
-- Nothing is granted back. Both are `RETURNS TRIGGER`: Postgres checks EXECUTE
-- when a trigger is CREATED, never when one fires, and the triggers that call
-- these already exist and are not recreated here. No caller anywhere invokes
-- either function directly — they are reached only through
-- `builder_payment_milestones` and `client_deals` writes.
REVOKE EXECUTE ON FUNCTION public.fp_accrue_commission_from_build_payment()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fp_accrue_commission_from_deal_settlement()
  FROM PUBLIC, anon, authenticated;
