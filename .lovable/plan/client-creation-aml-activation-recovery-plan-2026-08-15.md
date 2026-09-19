# Client Creation → AML Activation Recovery Plan

## Scope
Repair the single real-world journey: **new client created → human confirmation completed → AML case created → client marked active → verification can begin**. Preserve the rule that creation alone never creates an AML case.

## Findings to address
- The newly created client rows exist in `public.clients`, remain `is_active = false`, and have no linked open AML case.
- Recent `aml-cases` logs show authenticated client lookup/search calls but no `activate_client` request after creation. The current failure is therefore in the browser’s transition/submission path before the transactional backend is reached.
- The backend already has an atomic RPC that flips `clients.is_active` and creates `aml.cases` together, with duplicate-open-case protection. That contract should remain the only inactive-client activation path.
- The current dialog expresses its requirements only by disabling the final button. An unmet field or state can silently prevent submission, leaving the operator believing confirmation was completed.
- Post-activation audit events currently run after the atomic client/case transaction; a failure can make the browser report failure after activation already committed, creating a confusing retry/duplicate state.

## Implementation
1. **Make activation submission explicit and diagnosable**
   - Convert the dialog body/footer into a real form submission path.
   - Track attempted submission and show field-level/actionable errors for missing client, open case, subject name, activation event, reason, confirmation, and Model B approval.
   - Keep the button actionable when not actively submitting; on an incomplete attempt, focus/scroll to the first blocker instead of silently doing nothing.
   - Add a clear retry state for network/server failures without clearing the selected/new client or entered evidence.

2. **Reconcile successful or ambiguous responses**
   - Validate that the activation response contains a linked case and authoritative client activation result.
   - If a request returns an ambiguous failure, re-read the selected client’s AML summary before telling the operator to retry; if the transaction committed, treat it as success and open the existing case rather than producing a false failure/duplicate loop.
   - Await/refetch the relevant client and AML query keys so the UI cannot continue displaying stale “Inactive” state after success.

3. **Harden the backend completion contract**
   - Keep `aml_activate_client_open_case` as the only inactive-client mutation path and preserve Model B, role, human-confirmation, and duplicate guards.
   - Move the required activation audit event into the same database transaction as client activation and case creation, or return a deterministic committed result that retries can safely reconcile.
   - Make `activate_client` idempotently return the already-created case when the same confirmed activation is retried after an ambiguous response, while still rejecting a genuinely different duplicate activation.

4. **Regression coverage**
   - Cover incomplete form attempts, first-blocker guidance, retry with preserved values, new-client activation, inactive→active refresh, ambiguous-response reconciliation, duplicate/concurrent activation, permission denial, and Model B gating.
   - Run the focused AML/client tests plus lint, style audit, and production build required by the repository.

5. **Runtime verification**
   - Deploy the updated `aml-cases` function and apply any required RPC migration in safe order.
   - Exercise the journey with a controlled test client and verify: one client row, one linked open case, `is_active = true`, activation audit event present, and the UI exits the dialog into the case without stale status.

## Phase gate
Stop once this activation journey is verified. Do not alter AML reporting, screening rules, portal data exposure, or unrelated client-management behavior.
