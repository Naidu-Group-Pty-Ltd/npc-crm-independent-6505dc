# Step-up authentication: a control nobody could satisfy

Read this before touching `_shared/stepUp.ts`, `_shared/aml/step-up.ts`,
`STEP_UP_ENFORCED`, or any handler that calls `requireStepUp`.

## What was reported

Saving a credential on the Integrations page answered:

> **Not saved.** Network/CORS error calling `update-integration-secret`. Please
> check the function deployment and auth/CORS configuration.

**Both of those claims were false.** Measured 16 Sep 2026 against production:
the function was `ACTIVE` at v354, its `verify_jwt` matched
`check-integration-secrets` (which works from the same origin on the same page
load), and `createCorsHeaders`' allow-list carries
`https://command-centre.npcservices.com.au` as its first hard-coded fallback.

## What actually happened

`public.security_events` held one row, written at the instant of the click:

```
action      step_up.blocked
decision    deny
reason_code missing
capability  secrets.update
enforced    true
```

The function booted, answered the preflight, passed CSRF, authenticated the
operator and confirmed superadmin — then refused at `requireStepUp`. **The
refusal was the thing nobody could see.**

## Rule 1 — a shared refusal helper never invents CORS headers

Both step-up modules built their 401 from a module-level
`Access-Control-Allow-Origin: *`. Every call from this product is sent with
`credentials: 'include'`. A wildcard ACAO is invalid for a credentialed
request, so the browser **discards the response**, `fetch` rejects with
`TypeError: Failed to fetch`, and `secureInvoke` turns that one string into
advice about deployment and CORS. The status code and the words "Recent
reauthentication required" never reach JavaScript.

Every *other* refusal in this codebase already takes the caller's headers —
`csrfDenied`, `createUnauthorizedResponse`, `createForbiddenResponse`. These two
did not. The helper now resolves `args.cors ?? createCorsHeaders(origin)` from
the request it was already handed, so **the fix reaches all eleven call sites
without editing any of them**, including ones a future author adds.
`stepUpRefusalCors.test.ts` fails on any wildcard in either module.

The same defect sat in `_shared/aml/step-up.ts`, and that path is **live** —
`AmlGuard` mounts `StepUpAuthDialog` on ~20 routes.

## Rule 2 — a control that cannot be satisfied is an outage, not a control

`enforcementModeFor` returns `enforce` when `STEP_UP_ENFORCED` is **unset**.
That is deliberate and CI-pinned (`scripts/security/check-step-up-default.mjs`
plus six gates). Enforce mode *also* requires `assurance_level >= 2`.

Measured on the prime:

| | |
|---|---|
| superadmins | 4 |
| of those with `mfa_enrolled_at` | **0** |
| rows ever in `public.step_up_sessions` | **0** |
| callers passing `stepUpCapability` anywhere in `src/` | **0** |
| `integration_configs` rows with a value | **0 of 20** |

Password-only minting yields `assurance_level = 1`. So `secrets.update` could
not be met by any person, by any route. Five other capabilities —
`role.change`, `role.remove`, `aml.role.set`,
`commission.payout.mark_paid`, `docusign.send` — were blocked the same way.

`STEP_UP_ENFORCED` appears **nowhere** in this repository outside the three
source files that mention it: not in `.env.example`, not in `config.toml`, not
in a workflow, not in a Mission Control forwarding list. A fail-closed default
plus a variable nobody sets means every deployment where nobody set it has a
silently bricked Integrations page.

## Rule 3 — the clone proves it, and comparison is the cheapest diagnosis

| | prime `dduzbchuswwbefdunfct` | clone `plisdzywzleljorrphxv` |
|---|---|---|
| step-up events | 1 — `blocked / enforced:true` | 18 — all `audit / allow / enforced:false` |
| `secrets.update` | 1 blocked, 16 Sep | **16 audited, 12 Sep** |
| `integration_configs` filled | 0 of 20 | **6 of 6** |

Same code, different environment. Because the page writes the runtime **first**
and the table only on success, those six filled rows prove the clone's runtime
write succeeded. The remedy on the prime is the lever the design names:

> *"Audit-only mode now requires an explicit emergency configuration rather than
> being the silent production default."*

Set `STEP_UP_ENFORCED` in the project's Edge Function secrets. `off` / `false` /
`0` audits everything; a comma list enforces **only** the capabilities it names.
`mfa.manage` is hard-coded to enforce regardless and is unaffected.

## The two implementations are not one

`_shared/aml/step-up.ts` is independent: its own `aml.step_up_sessions` table
(no `assurance_level`, no `consumed_at`, no session binding), its own
`x-aml-step-up-token` header, no pepper, no kill switch, and an emailed 6-digit
code rather than a password. Changing one never changes the other.

## Still owed

`StepUpDialog` and `useStepUp` are **fully built and have zero call sites** —
the unmounted-component pattern this repo already legislates against for the
builder portal. Wiring `secrets.update` properly needs three things together:
mount the dialog, enrol MFA for the acting superadmin (enforce rejects
assurance 1), and handle that `secrets.update` is single-use and rotates the
staff session on mint.
