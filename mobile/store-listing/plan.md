# Store listing & launch playbook — App Store · Google Play · Huawei AppGallery

How the app is *presented, released and maintained* on the three stores.
The master plan's rule catalog (`../plan.md`, Part 3) covers what gets an app
rejected; this file covers what gets an approved app found, trusted, and
reviewed well — and the listing-level mistakes that also cause rejections.

Everything here inherits the master plan's honesty rule: policy-dated
specifics are tagged `[re-verify]` and must be checked against current store
documentation in the week before each submission.

## 1 · Identity and trust, before any metadata

- **One seller identity across all three stores**, and it is the
  AML-supervised entity — Apple Organization account (D-U-N-S), Google Play
  organization account, Huawei **enterprise** developer account (also
  D-U-N-S verified). A consumer finance-adjacent app published by an
  individual account is a trust failure and, on Apple, a guideline problem
  (master R-APL-1).
- **The web estate goes live first**: privacy policy URL, support URL,
  account-deletion page (S-3), marketing page. Every store form links to
  them; a dead URL at review time is a same-day rejection.
- EU DSA trader details completed where distributed (Apple / Play).

## 2 · Position the app honestly: it is invite-gated

The single most important listing decision. This app cannot be used without
an invitation from NPC Services, and the listing must say so plainly —
subtitle or first description line: *"For clients and partners of NPC
Services. Access is by invitation."*

Why this is a best practice and not just honesty:
- It pre-answers the reviewer's first question (see S-6 demo credentials).
- It prevents the 1-star flood every gated app earns from strangers who
  cannot register — the dominant rating killer for this category.
- It does **not** make the app "enterprise-internal": consumer apps that
  require an existing relationship (every bank app) are normal App Store
  citizens. If Apple ever pushes back on audience breadth, **unlisted app
  distribution** (full review, link-only install, no search presence) is
  the documented fallback — decide then, not preemptively.

## 3 · Metadata, per store

| Field | App Store | Google Play | AppGallery |
|---|---|---|---|
| Name (indexed) | 30 chars — "NPC Portals" + strongest term | Title, 30 chars | App name `[re-verify length]` |
| Second line | Subtitle, 30 chars — the invitation line or value line | Short description, 80 chars, **indexed** | Brief intro `[re-verify]` |
| Long text | Description (not meaningfully indexed) — write for humans | Full description, 4 000 chars, **indexed** — natural keyword coverage, no stuffing | Detailed intro `[re-verify]` |
| Hidden keywords | 100-char keyword field — no spaces after commas, no competitor names, no duplicates of name/subtitle | — (indexing comes from title + descriptions) | Keyword field per AGC `[re-verify]` |
| Editable without review | Promotional text (170 chars) | Most listing fields | Per AGC |

Rules that apply to all three:
- **en-AU** is the primary listing locale (spelling included). Add locales
  only when the app actually ships them.
- **No cross-platform mentions** in Apple metadata ("also on Android" is a
  known metadata rejection).
- **Finance wording discipline**: no "guaranteed", no returns claims, no
  advice language — the listing is marketing for *workflow tooling by the
  regulated entity* (mirrors R-GPL-4's declared posture; the listing and
  the declarations must tell the same story).
- **No purchase language anywhere** — the app sells nothing (R-APL-5), so
  the listing never mentions tokens, plans or prices.

## 4 · Visual assets

- Screenshots are **real UI over demo data** — both major stores treat
  composited or aspirational screenshots as misleading metadata, a
  rejection class of its own. The S-6 demo accounts double as the
  screenshot fixtures.
- First two screenshots carry the entire message (most users never swipe):
  1) client deal-progress view, 2) documents/messages. Ship light **and**
  dark sets — the glass design system is the visual identity; show it.
- Portal-targeted acquisition, without polluting the main listing:
  - Apple **custom product pages** — a broker-facing page (pipeline,
    purchase files) linked from finance-partner invite emails; a
    client-facing default page.
  - Play **custom store listings** — same split, URL-targeted.
  - This is the correct home for per-portal marketing; the master listing
    stays client-first.
- Play feature graphic and AppGallery banner assets from the same brand kit
  (`npc-services-design` skill owns the marks; no text-heavy icons, and the
  email-signature banner files in this repo are **not** app icons — see
  CLAUDE.md's warning about the director's mobile number).

## 5 · Category and rating

- Apple: **Business** primary, Finance secondary. Play: Business or Finance
  — pick once, aligned with the Play financial declarations (declarations
  follow *features*, not category, so this is presentation only).
- Age ratings: Apple questionnaire, Play IARC, AppGallery rating — all
  answered as: finance-adjacent tooling, no UGC exposure to the public, no
  gambling. Expect 4+/3+/Everyone with finance flags where the form asks.

## 6 · Release management

- **Tracks before public**: TestFlight → Play internal/closed → AGC testing
  track, all fed by the same build number discipline (one version bump per
  release across stores; no store-specific feature flags in v1).
- **Phased everywhere**: Apple 7-day phased release (pausable), Play staged
  rollout by percentage (haltable), AppGallery phased release per AGC
  `[re-verify mechanics]`. Nothing goes 0→100 on day one.
- The server minimum-version gate (master R-BOTH-7) is what makes a bad
  release recoverable — phased rollout limits blast radius, the version
  gate ends it.
- Release notes are written for users, localized with the listing, and
  never just "bug fixes" on a feature release.

## 7 · Ratings and reviews

- **Native prompts only**: Apple's review request (system-limited to ~3
  prompts per user per year) and Play's In-App Review API (quota-managed).
  AppGallery equivalent per AGC `[re-verify]`.
- Trigger after *success* moments — a document uploaded, a milestone
  reached — never after an error, never at launch, never gating anything
  (gating is a policy violation on both major stores).
- **Respond to reviews** on all three consoles with a support SLA; route
  "can't log in / can't register" reviews to the invitation explainer.
  This category of review is the predictable one (see §2) — the response
  template exists before launch, not after the first 1-star.

## 8 · Listing-level rejection traps (recap, all three stores)

- Misleading or composited screenshots; placeholder text anywhere.
- Broken privacy/support/deletion URLs.
- Demo credentials that don't work on review day (S-6 — the scheduled
  liveness check exists for exactly this).
- Metadata mentioning other platforms (Apple) or prices/purchases
  (contradicts the no-IAP posture).
- Listing claims that contradict the Play financial declarations or the
  privacy labels — the three surfaces are generated from one mapping
  table precisely so they cannot drift apart.

## 9 · Listing pre-flight (append to the master pre-submission gate)

```
[ ] Seller identity = AML entity on all three consoles; DUNS verifications complete
[ ] Privacy / support / deletion / marketing URLs live and linked
[ ] Invitation-gated wording present in subtitle or first description line
[ ] Screenshots regenerated from current build + demo data, light and dark
[ ] Custom product pages / custom store listings mapped to invite-email links
[ ] Category + declarations + privacy labels tell one consistent story
[ ] Phased rollout configured; halt/pause rehearsed once per store
[ ] Review-response templates and support SLA in place
[ ] [re-verify] items in this file re-checked against current store docs
```
