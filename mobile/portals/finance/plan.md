# Finance portal — Flutter plan (phase 1)

Broker partners working purchase files, pipeline, compliance and commissions.
B2B surface, but it drives the app's **financial-services declarations** on
both stores, so its facts must be stated precisely.

## Auth — needs S-1 before any mobile work

Web sessions live only in the HttpOnly `__Host-finance_session_token` cookie
(WP-11B/C, `src/hooks/useFinancePortalAuth.tsx`); there is deliberately no
storage mirror. Mobile requires the bearer response mode from S-1 with the
same rotation/revocation semantics. Login uses Turnstile → S-2.

## Screen inventory (from `src/pages/finance-portal/`)

Dashboard · Purchase files (+ detail) · Pipeline · Clients (+ profile,
inbox) · Messages · Compliance workspace · AML case snapshot · Earnings ·
Insights · Lender intelligence · Reports · Partner referral inbox ·
Settings · Login / AcceptInvite / ChangePassword.

Phase-1 cut: Dashboard, Purchase files (+ detail), Pipeline, Clients,
Messages, Settings, auth screens. Compliance workspace and AML snapshot in
phase 1 only if the demo account can exercise them safely (S-6).

## Store-sensitive features in THIS portal

- **Financial-services posture (R-GPL-4)**: this portal *coordinates*
  mortgage-broking workflow for the regulated publishing entity. It does
  not originate loans, take deposits, or quote credit products to
  consumers. The Play declarations and the App Review notes use exactly
  that framing; drift here is a policy rejection.
- **Earnings/commissions**: financial info about the *partner*, another
  data-safety row (R-APL-3 / R-GPL-2).
- **Theming**: the finance dark palettes ship in `design-tokens.json`
  (`financeMidnight`, `financeGraphite`); apply as `Brightness.dark`
  themes — same policy as the web's `data-palette="dark"`.
- **No payments anywhere** in this portal (verified: web hits for
  "purchase" here are property purchase files) — keeps R-APL-5 clean.

## Verification deltas

```
[ ] S-1 bearer mode: login → token in Keystore → revocation kills session
[ ] Play financial declaration answers archived, matching the posture above
[ ] Demo broker account exercises pipeline + one purchase file end-to-end
```
