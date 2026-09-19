# NPC Portals — Flutter mobile app: master plan

This directory is the seed of the cross-platform (iOS + Android) Flutter
translation of the four partner/client portals. It exists so the mobile effort
starts from **audited facts about this codebase** — its auth mechanisms, its
API surface, its design tokens, its store-sensitive features — rather than
from someone's memory of them.

Read this file first. Then the portal plan for the surface you are building:

| Portal | Plan | Users | Phase |
|---|---|---|---|
| Client | [`portals/client/plan.md`](./portals/client/plan.md) | Property-buying clients | 1 |
| Finance | [`portals/finance/plan.md`](./portals/finance/plan.md) | Broker partners | 1 |
| Solicitor | [`portals/solicitor/plan.md`](./portals/solicitor/plan.md) | Legal partners | 2 |
| Builder | [`portals/builder/plan.md`](./portals/builder/plan.md) | Builder/developer partners | 2 |

The staff Command Centre is **not** part of this app (see R-ARCH-2).

Distribution targets **three stores**: Apple App Store, Google Play, and
Huawei AppGallery (Huawei devices ship without Google services — see the
AppGallery rules in Part 3, which reshape two server prerequisites).
How the app is *listed, launched and maintained* on all three is its own
playbook: [`store-listing/plan.md`](./store-listing/plan.md).

## Generated inputs — regenerate, never hand-edit

| Artefact | Generator | What it is |
|---|---|---|
| [`design-tokens.json`](./design-tokens.json) | `npm run mobile:tokens` | Every design token (light, dark, financeMidnight, financeGraphite) parsed from `src/styles/tokens.css` + `src/styles/finance-portal.css`. Verbatim values; the Flutter `design_system` package owns resolution. |
| [`api-surface.json`](./api-surface.json) | `npm run mobile:api` | All 412 edge functions from the audited security registry, classified into `portal` (69) / `public` (40) — the v1 surface — plus `staff` (237, phase ≥2) and `server-only` (66, never client-called). |

Both have `--check` drift modes (`mobile:tokens:check`, `mobile:api:check`).
They are **not yet wired into `ci.yml`** — do that in the PR that creates the
Flutter workspace, so the gates start existing at the same moment code can
drift against them.

## The honest line on "guaranteed approval"

No plan can make store approval literally 100% certain: both stores retain
subjective review clauses (Apple 4.0 "design", Google "spam and minimum
functionality"), policies change between authoring and submission, and
review outcomes vary by reviewer. What a plan *can* do is eliminate every
**deterministic** rejection class — the ones triggered mechanically by a
missing capability, declaration, or artefact — and minimise the subjective
surface. That is what the rules below are: each one is either a hard store
requirement this app is known to trip today, or a known rejection trigger
this app's feature set makes live. Treat every rule as a release gate:
**a submission with any rule unmet is expected to be rejected.**

Store requirements drift. Every rule tagged `[re-verify]` must be checked
against current published policy in the week before each submission — in
particular Google's target-API-level deadline and Apple's privacy-manifest
SDK list, which both move on annual cycles.

---

## Part 1 — Architecture decisions (settled here, not re-litigated per portal)

**R-ARCH-1 · One app, four portal modes — not four apps.**
Apple Guideline 4.3 (spam) flags near-identical binaries from one developer;
four portal apps sharing a design system and backend is exactly the pattern
it catches. Ship a single "NPC Portals" app that routes to the correct portal
after authentication, the same way the web app does. Product pages describe
one multi-portal app.

**R-ARCH-2 · The staff Command Centre stays out of the binary.**
It is 237 staff-scoped functions of admin surface behind a different auth
model, and its presence in a consumer-visible app invites review questions
(and expands the data-safety declarations) for no user benefit. If a staff
app is ever wanted, it is a separate phase-2 product with its own listing.

**R-ARCH-3 · Native Flutter UI. A WebView wrapper is an automatic rejection.**
Apple 4.2 (minimum functionality) rejects apps that repackage a website.
WebView is permitted for exactly two embedded jobs: rendering generated PDF
reports and, if S-2 chooses that route, the Turnstile challenge. Navigation,
lists, forms, dashboards are Flutter widgets.

**R-ARCH-4 · Backend is unchanged.** The app consumes the same Supabase edge
functions the web portals do, enumerated in `api-surface.json`. A Flutter PR
that calls a function outside the `portal`/`public` scopes fails review — the
scope field exists so a lint can enforce this.

**R-ARCH-5 · Package layout.** Flutter workspace at `mobile/app/` with local
packages `packages/npc_design_system` (consumes `design-tokens.json`),
`packages/npc_api_client` (generated against `api-surface.json`), and
`packages/npc_auth` (session handling per S-1). Keeping these as packages is
what lets four portal features share one contract.

## Part 2 — Server-side prerequisites (work in THIS repo, blocking)

These are gaps found by auditing this codebase, not hypotheticals. The mobile
app cannot pass review until they exist, and they are all server work.

**S-1 · Bearer-token session mode for the cookie portals. [blocking]**
The client portal already issues a bearer token (`portal_session_token`,
`src/hooks/usePortalAuth.tsx`). Finance, solicitor and builder sessions live
only in HttpOnly `__Host-*` cookies (WP-11B/C) — correct for browsers,
wrong for a native client. Add an explicit, opt-in bearer response mode to
those portals' auth functions (request flag → token in body; same rotation
and revocation semantics as the cookie). Mobile stores it in
Keychain/Keystore (`flutter_secure_storage`), never in plain preferences.
Every new/changed function goes through `SECURITY_REGISTRY.json` — the
registry gate now also rejects duplicate entries, so add entries once.

**S-2 · A native-capable human-verification path. [blocking]**
All four portal logins embed Cloudflare Turnstile
(`src/components/auth/TurnstileWidget.tsx`), which is a browser widget.
Decide once, in this order of preference: (a) server accepts platform
attestation — App Attest / DeviceCheck on iOS, Play Integrity on Android —
as the human signal for mobile logins, keeping Turnstile for web; or
(b) render Turnstile inside an in-app WebView on the login screen only.
(a) is stronger and removes the WebView from the auth path; it needs a
server-side verifier and a registry entry. **The verifier must accept more
than Play Integrity**: Huawei devices have no Google services, so the
attestation path is per-platform — App Attest (iOS), Play Integrity (GMS
Android), Huawei's device attestation `[re-verify current kit]` on HMS
Android — behind one server endpoint.

**S-3 · Account deletion, in-app and by URL. [blocking — confirmed absent]**
A codebase search finds **no account-deletion flow for any portal**. Apple
5.1.1(v) requires in-app account deletion in any app with account creation
(invite-based creation counts); Google Play additionally requires a web URL
for deletion discoverable from the store listing. Required: per-portal
deletion edge functions (delete or anonymise per AML retention duties — see
below), a settings entry point in-app, and a hosted web deletion page.
**AML tension, resolved explicitly:** compliance records that must be
retained by law are exempt from deletion, but the exemption must be stated
in the deletion flow and the privacy policy, and everything outside the
retention duty must actually delete. Do not ship a deletion flow that
silently deletes nothing.

**S-4 · Deep-link attestation files on the web origin.**
`public/.well-known/apple-app-site-association` and
`public/.well-known/assetlinks.json` on the production web app, so portal
invite/handoff links (`PortalHandoff.tsx`, `*AcceptInvite.tsx`) open the app.
Cannot be seeded now — both require the real Team ID / signing-cert
fingerprints. Template + gate here so it is not forgotten.

**S-5 · Native push registration.**
Web push is service-worker based (`src/lib/pushNotifications.ts`); native
needs token registration endpoints and a send path keyed by device token —
for **three transports**: APNs (iOS), FCM (GMS Android), HMS Push Kit
(Huawei). The client hides all three behind one push abstraction
(R-HAG-3); the server stores `(device, transport, token)`. Push must never
gate a core flow (R-BOTH-6).

**S-6 · Review sandbox accounts. [blocking for review, easy to forget]**
Every portal is invite-gated. App Review cannot create an account, and
"we couldn't log in" is a same-day rejection (Apple 2.1 / Play App Access).
Required: one standing, seeded, non-production demo account **per portal
mode**, with instructions in App Review notes / Play App Access / the
AppGallery review remarks, kept alive by a scheduled check — a dead demo
account rejects an otherwise perfect submission on any of the three
stores.

## Part 3 — Store-verification prerequisite rules

Each rule: requirement → how it is verified before submission.

### Apple App Store

**R-APL-1 · Publish from an Organization developer account** (D-U-N-S), not
an individual — this is a financial-services adjacent product and the seller
name must match the AML-supervised entity. EU DSA trader details completed.
*Verify:* App Store Connect account type + seller name.

**R-APL-2 · In-app account deletion** reachable from Settings in ≤ 3 taps
(depends on S-3). *Verify:* UI test per portal mode.

**R-APL-3 · Privacy manifest + nutrition labels.** `PrivacyInfo.xcprivacy`
declaring collected data and required-reason APIs; third-party SDKs from
Apple's list must ship their own manifests and signatures `[re-verify]`.
App Privacy answers must match `api-surface.json` reality: identity data,
financial info, documents, messages. *Verify:* archive validation passes +
a written mapping table from data type → collecting function.

**R-APL-4 · Permission strings that tell the truth.**
`NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` (AML identity
documents — `IdentityVerificationStep.tsx`), `NSMicrophoneUsageDescription`
(voice notes — `VoiceToTextButton.tsx` uses `getUserMedia` on web).
**No location permission in v1**: the listings map (Leaflet/OSM on web)
renders without device location, and an unjustified location prompt is a
rejection. *Verify:* Info.plist contains exactly the used permissions,
each triggered only in context (no launch-time prompt walls).

**R-APL-5 · No digital-goods purchase in the app (3.1.1).** Token/billing
purchases exist only in the staff Command Centre on web and stay there.
The portal app sells nothing, shows no price list, and does not link out to
purchase. If in-app purchasing is ever wanted, it is IAP or a then-current
entitlement `[re-verify — steering rules are in active litigation flux]`.
*Verify:* grep gate on the Flutter repo for store/checkout/price URLs.

**R-APL-6 · Sign in with Apple is not required while auth is email+invite
only** (4.8 triggers on third-party/social login). Adding any social login
later triggers the requirement. *Verify:* auth methods list at submission.

**R-APL-7 · Export compliance:** standard TLS only →
`ITSAppUsesNonExemptEncryption = false`. *Verify:* Info.plist key present.

**R-APL-8 · No tracking, no ATT.** No ad SDKs, no cross-app identifiers;
App Privacy declares no tracking, so no App Tracking Transparency prompt.
*Verify:* dependency audit of the Flutter lockfile.

**R-APL-9 · Review notes** explain the invite model, the demo accounts
(S-6), and that AML identity capture is a regulatory feature of the
publishing entity — reviewers reject KYC flows they cannot understand.
*Verify:* notes drafted and stored beside the release checklist.

### Google Play

**R-GPL-1 · Target API level within Google's current window** `[re-verify]`
(API 35 as of authoring), AAB upload, Play App Signing. Flutter + NDK kept
current for the 16 KB page-size requirement on Android 15+ devices
`[re-verify]`. *Verify:* `flutter build appbundle` + Play pre-launch report.

**R-GPL-2 · Data safety form** consistent with R-APL-3's mapping table —
the two stores' declarations must not contradict each other. *Verify:* one
source table generates both answers.

**R-GPL-3 · Account deletion web URL** in the store listing (S-3's hosted
page) plus the in-app flow. *Verify:* listing field populated; URL live.

**R-GPL-4 · Financial-features declaration.** The finance portal surfaces
mortgage-broking workflow; Play's finance declarations (and any regional
personal-loan policies) must be answered accurately as *facilitation
tooling by the regulated entity, not a lending product* `[re-verify]`.
*Verify:* Play Console declaration screenshots archived with the release.

**R-GPL-5 · App Access credentials** for review (S-6 accounts, all four
portal modes documented). *Verify:* Play Console App Access section.

**R-GPL-6 · IARC content rating** completed (finance category, no user-
generated public content, no gambling). *Verify:* rating certificate issued.

### Huawei AppGallery

Huawei devices have shipped without Google Mobile Services since 2019, so
AppGallery is not "Play with a different console" — it is a third platform
target whose constraints reach back into the architecture. The web recon
already established one good fact: nothing in this product depends on
Google services (the listings map is Leaflet + OSM tiles, not Google Maps),
so the Flutter app can honour R-HAG-3 from day one instead of retrofitting.

**R-HAG-1 · Global AppGallery only; mainland China excluded in v1.**
Distribute to the regions where NPC's clients and partners are (AU first).
Mainland China distribution requires a local entity and ICP filing
`[re-verify]` — a business decision, not an engineering one; excluded until
someone makes it.

**R-HAG-2 · Huawei enterprise developer account** (D-U-N-S verified),
seller name = the AML-supervised entity — same identity rule as R-APL-1.
*Verify:* AGC account type + seller name.

**R-HAG-3 · Zero-GMS rule.** The app must be fully functional on a device
with no Google services: push through the S-5 abstraction (HMS Push Kit on
Huawei), attestation through the S-2 per-platform verifier, maps via
`flutter_map` + OSM tiles (already GMS-free), and **no transitive
Play-Services dependency** in the Android build. *Verify:* dependency
audit of the lockfile + a full app walkthrough on an HMS-only device or
Huawei cloud-test device farm.

**R-HAG-4 · AppGallery review parity.** AppGallery's review requires the
same fundamentals the other stores do: privacy policy linked, permissions
declared and justified, account deletion available (S-3 covers all three
stores), review credentials supplied (S-6). The three-store data/privacy
mapping table is one table — AGC's privacy declarations are generated from
the same source as Apple's labels and Play's data safety form (R-APL-3 /
R-GPL-2). *Verify:* AGC declaration screenshots archived with the release.

**R-HAG-5 · Packaging and signing per current AGC requirements**
`[re-verify]` (AAB supported; AGC manages signing). Huawei Flutter plugins
(e.g. `huawei_push`) pinned and audited like any other dependency.
*Verify:* AGC upload validation + release build smoke test.

**R-HAG-6 · No Huawei IAP obligations** — the app sells nothing (R-APL-5's
posture applies storewide), so AppGallery's payment-kit requirements for
digital goods are never triggered. *Verify:* same grep gate as R-APL-5.

### All stores

These rules apply on Apple, Google **and** Huawei alike (ids keep the
R-BOTH prefix for continuity with the portal plans).

**R-BOTH-1 · Login-wall completeness:** every pre-auth screen (login, invite
acceptance, forgot/change password — all four portals have them) works
without an account, renders offline errors gracefully, and never dead-ends.
Blank screens behind network failure are the classic "2.1 performance"
rejection. *Verify:* airplane-mode walkthrough of every pre-auth route.

**R-BOTH-2 · Sensitive-document hygiene.** AML identity captures never enter
the OS photo library by default, uploads are TLS-only to registry-listed
functions, local temp files are wiped after upload, and screens showing
identity documents set `FLAG_SECURE` / iOS screen-capture obscuring.
*Verify:* code review checklist + manual capture walkthrough.

**R-BOTH-3 · Accessibility parity with the web work:** honor platform
reduced-motion and reduced-transparency (the glass material collapses to
opaque exactly as the web does — the policy is already encoded in
`tokens.css` fallback branches; reimplement the *policy*, not the media
queries), 44pt/48dp touch floors (already the web standard after the
pointer-ergonomics work), and TalkBack/VoiceOver labels on every control.
*Verify:* the Flutter accessibility test suite + manual screen-reader pass
of login → dashboard → document upload.

**R-BOTH-4 · Glass performance budget carries over.** The web audit measured
blur-per-repeated-element as the one catastrophic cost; the same is true of
Flutter's `BackdropFilter`. Containers blur; list items never do. Budget:
≤ 8 live blur layers per screen, verified with the Flutter performance
overlay on a mid-range Android device before each release.

**R-BOTH-5 · Deep links verified end-to-end** (S-4): invite mail → app
install → invite acceptance in-app; and web handoff links open the right
portal mode. *Verify:* physical-device test matrix, both stores' link
validators.

**R-BOTH-6 · Push is optional.** Permission requested in context (first
relevant feature), never at launch, and every flow works with it denied.
*Verify:* denied-permission walkthrough.

**R-BOTH-7 · Version/deprecation policy:** minimum OS iOS 15 / Android 8
(covers the Flutter floor `[re-verify]`), and a forced-upgrade mechanism
(server minimum-version check at session refresh) so broken releases can be
retired without stranding sessions.

## Part 4 — Design-system translation

- `design-tokens.json` is the contract. The Dart generator in
  `npc_design_system` resolves `var()` references and HSL triplets into
  `ThemeData` + a `GlassTheme` extension (fills, strokes, sheen, blur radii,
  shadows, motion durations — all present in the export).
- Theme parity: `light`, `dark`, and the finance palettes map to the same
  semantics the web applies (`data-palette="dark"` behaviour → Flutter
  `Brightness.dark` for midnight/graphite).
- The glass recipe translates as: container decoration = fill + stroke +
  sheen gradient; `BackdropFilter` only on the container tier (R-BOTH-4);
  scrims darken *and* blur exactly as `.glass-scrim` does.
- Typography: the web uses system stacks (`--font-sans`); Flutter uses the
  platform default type family per OS — do not embed a webfont to imitate
  the other platform's system face.

## Part 5 — Phasing

1. **Phase 0 (this repo, now):** S-1…S-6 server work; wire
   `mobile:tokens:check` + `mobile:api:check` into CI alongside the Flutter
   workspace PR.
2. **Phase 1:** Workspace + packages; client portal + finance portal modes;
   all Part-3 rules gated in the release checklist; TestFlight / internal
   track with review-sandbox accounts. **The push and attestation
   abstractions are built three-platform from the start** (APNs/FCM/HMS —
   R-HAG-3): retrofitting HMS into a GMS-shaped abstraction later is the
   expensive path.
3. **Phase 2:** Solicitor + builder modes (their plans note the deltas);
   App Store + Play submission; **AppGallery submission** follows once the
   HMS transport is exercised on real Huawei hardware.
4. **Phase 3 (optional, separate product):** staff Command Centre.

## Part 6 — Pre-submission gate (run in full, every release)

```
[ ] mobile:tokens:check and mobile:api:check green
[ ] S-1..S-6 all live in production
[ ] Every R-APL / R-GPL / R-BOTH rule checked by its named verification
[ ] [re-verify] items re-checked against current store policy (dated note)
[ ] Demo accounts logged into from a clean device, all four portal modes
[ ] Airplane-mode pass, denied-permissions pass, screen-reader pass
[ ] Performance overlay pass on mid-range Android hardware
[ ] Zero-GMS walkthrough on an HMS-only device (R-HAG-3), before any AppGallery release
[ ] Listing pre-flight from store-listing/plan.md §9 completed for every store shipping
```
