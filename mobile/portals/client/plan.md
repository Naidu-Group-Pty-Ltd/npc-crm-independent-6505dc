# Client portal — Flutter plan (phase 1)

The consumer-facing surface: property-buying clients tracking their purchase,
documents, appointments and compliance steps. This is the portal App Review
will actually exercise, so its store posture leads the app's.

## Auth — the easy one

Bearer token already exists on web (`portal_session_token`,
`src/hooks/usePortalAuth.tsx` — sessionStorage/localStorage). Mobile stores
the same token in Keychain/Keystore. Login, invite acceptance
(`PortalAcceptInvite`), and handoff (`PortalHandoff`) come through `public`-
scope functions in `api-surface.json`. Turnstile on login follows S-2's
decision. Deep links for invite + handoff follow S-4.

## Screen inventory (from `src/pages/portal/`)

Dashboard · Deal progress · Properties · Property insights · Documents ·
Reports · Messages · Emails · Notifications · Appointments · Booking ·
Action items · Finance hub · Lenders · Legal (+ detail) · AML ·
Employment · Profile · Auth / AcceptInvite / Handoff.

Phase-1 cut: Dashboard, Deal progress, Documents, Messages, Notifications,
Appointments, Action items, AML, Profile, and the auth trio. The rest ships
behind the same navigation when ready — do not stub visible dead ends
(R-BOTH-1: no screen may dead-end).

## Store-sensitive features in THIS portal

- **AML identity verification** (`IdentityVerificationStep`, `PortalAml`):
  camera + photo library permissions (R-APL-4), capture hygiene (R-BOTH-2),
  and the review-notes explanation (R-APL-9). This is the single most
  rejection-prone flow in the app; it gets its own review-notes paragraph
  and a demo path that works without real identity documents.
- **Document vault** (`PortalDocuments`, `PortalLegalDetail`): file
  picker + PDF rendering (WebView permitted per R-ARCH-3 for PDFs only).
- **Account deletion** entry point lives in Profile (S-3 / R-APL-2 /
  R-GPL-3) — with the AML retention exemption stated in the flow.
- **Messages/Emails**: user content → data-safety declarations (R-APL-3 /
  R-GPL-2 mapping table rows: messages, email metadata).

## Verification deltas beyond the master gate

```
[ ] Invite mail on a clean device → store page → install → invite accepted in-app
[ ] AML capture demo path with synthetic documents, camera denied AND granted
[ ] Account deletion visible in Profile within 3 taps, exemption text present
```
