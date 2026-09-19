# Builder portal — Flutter plan (phase 2)

Builder/developer partners: projects, construction, inventory, transactions.
The widest screen surface of the four portals and the only one with an
organisation-switching step, so it goes last.

## Auth

Cookie-backed with server-side rotation ("server rotated the cookie and
revoked every other session" — `src/hooks/useBuilderPortalAuth.tsx`);
requires S-1's bearer mode *including that rotation semantic*: a mobile
session must be revocable the same way. Includes
`BuilderSelectOrganisation` — multi-org accounts pick a scope post-login;
the mobile session object must carry the selected org exactly as the web
cookie flow does.

## Screen inventory (from `src/pages/builder/`)

Dashboard · Projects (+ detail) · Construction (+ detail) · Inventory ·
Unit detail · Transactions (+ detail) · Delivery detail · Tasks ·
Activity · Documents · Messages · Notifications · Compliance · Settings ·
Onboarding · Terms · Login / AcceptInvite / ChangePassword /
ForgotPassword / ResetPassword.

## Store-sensitive notes

- Org-switching UI must not look like a tenant picker for arbitrary
  companies (Apple 4.2.6-style "container app" suspicion): the product
  page describes a partner app for NPC's builder network, and review notes
  (R-APL-9) explain the invite-only org model.
- Construction/delivery photos, if added on mobile, join the camera
  permission scope (R-APL-4) — do not add `capture` behaviour before the
  permission strings and data-safety rows are updated.
- Transactions are *records*, not payments — no checkout anywhere
  (R-APL-5 stays clean).

## Verification deltas

```
[ ] Multi-org demo account: org switch on mobile matches web scope exactly
[ ] Session rotation on the server revokes the mobile bearer session
```
