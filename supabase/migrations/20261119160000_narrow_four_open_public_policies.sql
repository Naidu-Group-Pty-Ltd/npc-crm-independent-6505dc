-- Four tables whose RLS policy was open to `public`, narrowed to the role that
-- actually reads them.
--
-- Measured against the live catalogue on 12 September 2026: 41 policies in
-- `public` are `TO public` with an unconditional `true` predicate. Most are
-- correct — published reference data (`land_tax_rates`, `suburb_directory`,
-- seven `*_cache` tables), or a "service role full access" policy on a table
-- where `anon` and `authenticated` hold no DML grant at all, so nothing can
-- reach it.
--
-- Four are not, and they divide into two kinds.
--
-- ## Kind one: reachable today
--
--   report_templates
--       `anon` holds SELECT, and "Users can view all report templates" is
--       `TO public USING (true)`. So the publishable anon key — which is in
--       every browser bundle this deployment ships — reads every template row
--       in the database: name, schema, custom CSS, approval state. Nothing
--       anonymous needs them. Every product read goes through the
--       `manage-templates` Edge Function, and the one direct browser read
--       (`TemplateBranchingDialog`) is inside the authenticated Template
--       Builder.
--
--   client_portal_messages
--       `authenticated` holds SELECT and "Service role full access on portal
--       messages" is `TO public` with `USING (true) WITH CHECK (true)`, so
--       every signed-in principal can read every client's portal
--       correspondence. Staff reading it is the intent — all `authenticated`
--       principals here are staff, because portal users and finance partners
--       run on their own session tables as `anon` — so this one is narrowed
--       rather than closed.
--
-- ## Kind two: held back by a missing GRANT, not by a policy
--
--   report_qa_conversations
--   report_qa_messages
--       Six policies named "Anyone can view / create / update / delete", each
--       `TO public` with `USING (true)`, and they mean exactly what they say.
--       The only thing between them and the database is that `anon` and
--       `authenticated` were never granted the matching DML — `authenticated`
--       has SELECT and nothing else.
--
--       That is not a control. It is a coincidence one `GRANT` undoes, and
--       this corpus contains two `rollback_*_rls_policies.sql` scripts that
--       did exactly that class of thing. A policy that says "anyone can
--       delete" beside a table whose safety rests on nobody having noticed is
--       the shape worth removing while it is still theoretical.
--
--       Nothing in the product reads these two tables from a browser. Every
--       access is `invokeSecureFunction('manage-client-data', …)`, which runs
--       on `SUPABASE_SERVICE_ROLE_KEY` and checks the caller itself; both
--       tables are on its allow-list. So the `TO public` policies are dropped
--       outright rather than narrowed.
--
-- ## What this deliberately does NOT do
--
-- It does not touch a grant. Revoking `anon`'s DML on the tables that carry
-- one would be the better fix and is a far wider blast radius than this; the
-- policies are the half that can be corrected without guessing which of 1,040
-- migrations put a grant there and why.
--
-- It does not narrow the twelve reference-data policies. `land_tax_rates` and
-- the caches are published figures, and a login page reads `whitelabel_settings`
-- before anyone is signed in.
--
-- ## Realtime
--
-- Three `postgres_changes` subscriptions watch `client_portal_messages`:
-- `ClientPortalMessagesPanel` (filtered by client), `Messages` (unfiltered) and
-- the client portal's own `PortalMessages`. Realtime respects RLS and delivers
-- under the subscriber's role, so the staff two keep working only because the
-- SELECT below stays permissive for `authenticated`. The portal's has never
-- delivered anything — a portal user is `anon` and `anon` holds no SELECT
-- grant here — and this changes neither that fact nor the Edge Function the
-- portal actually reads through.
--
-- ## This will park in the fleet lane, and should
--
-- `assessSqlDestructiveness` flags a `DROP POLICY` that is not recreated under
-- the same name on the same table. The six Q&A drops are exactly that, so
-- Mission Control will hold this batch for a human rather than replaying it
-- onto tenants unseen. That is the gate working.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- report_templates — the anon key stops reading every template.
--
-- Recreated under the SAME NAME: the policy still exists and still admits every
-- signed-in user to every row, which is what the Template Builder needs. Only
-- the role it applies to changes.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view all report templates" ON public.report_templates;
CREATE POLICY "Users can view all report templates"
  ON public.report_templates FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- client_portal_messages — the service-role policy becomes a service-role
-- policy, and the staff read it already performs is stated separately.
--
-- Two policies where there was one, because they answer different questions:
-- what the Edge Functions may do, and what a signed-in member of staff may
-- read. Collapsing them is how "full access" came to cover a role it was never
-- named for.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access on portal messages" ON public.client_portal_messages;
CREATE POLICY "Service role full access on portal messages"
  ON public.client_portal_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Signed-in staff can read portal messages"
  ON public.client_portal_messages FOR SELECT
  TO authenticated
  USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- report_qa_conversations / report_qa_messages — the six open policies go.
--
-- No replacement. `service_role` already carries its own full set on both
-- tables, it is the only principal that touches them, and it bypasses RLS in
-- any case. Leaving a narrowed copy behind under a name that says "anyone"
-- would keep the misleading half of what is being removed.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view Q&A conversations" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "Anyone can create Q&A conversations" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "Anyone can update Q&A conversations" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "Anyone can delete Q&A conversations" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "Anyone can view Q&A messages" ON public.report_qa_messages;
DROP POLICY IF EXISTS "Anyone can create Q&A messages" ON public.report_qa_messages;

COMMIT;
