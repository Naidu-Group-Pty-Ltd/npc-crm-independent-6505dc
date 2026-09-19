# Solicitor portal — Flutter plan (phase 2)

Legal partners: matters, pipeline, compliance, workspace. Deferred to phase 2
— it shares nearly everything structural with the finance portal, so it
lands cheaply once that portal's mode exists.

## Auth

Cookie-backed like finance (server re-reads governance state through the
cookie verifier — `src/hooks/useSolicitorPortalAuth.tsx`); requires S-1's
bearer mode. Login uses Turnstile (S-2) **and this portal's login passes a
`turnstile_token` explicitly in the request body** — the S-2 server change
must cover this call path, not just the shared widget.

## Screen inventory (from `src/pages/solicitor/`)

Dashboard · Matters (+ detail) · Pipeline · Workspace · Compliance ·
Security · Settings · Onboarding · Terms · Login / AcceptInvite /
ChangePassword / ForgotPassword.

## Store-sensitive notes

- **Onboarding + Terms screens already exist** — reuse their content for the
  in-app first-run flow; stores dislike account types whose terms are only
  on the web (R-BOTH-1 completeness).
- Matter documents = legal documents → same hygiene bar as AML documents
  (R-BOTH-2), same data-safety rows.
- `SolicitorPipeline.security.test.ts` exists on web — port its assertions
  into the Flutter integration suite for this mode; the pipeline carries
  the same authorization sensitivities on mobile.

## Verification deltas

```
[ ] Turnstile-token call path covered by S-2 replacement on this login
[ ] Demo solicitor account walks matter detail + workspace
```
