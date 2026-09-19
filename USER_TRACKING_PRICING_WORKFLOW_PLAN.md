# User-Attributed Pricing & Purchase Workflow — Implementation Plan (Command Center / Origin Side)

---

## ⚠ REVISION 3 (2026-07-13) — Mission Control `/pricing` removed; MC billing URL constants dropped.

Mission Control no longer serves any customer `/pricing` route — the Aurixa Systems
storefront (`AURIXA_PRICING_URL`) is the only pricing page. In this repo:

- The unused `MISSION_CONTROL_BILLING_URL` / `MISSION_CONTROL_TOPUP_URL` /
  `MISSION_CONTROL_SEATS_URL` / `MISSION_CONTROL_CATALOG_URL` constants were removed from
  `src/lib/missionControl.ts` so no billing CTA can point at Mission Control again.
- Every billing CTA goes through `openMissionControlWithAttribution(intent, AURIXA_PRICING_URL)`
  (or a Mission-Control-minted storefront `topup_url`), so all purchase traffic lands on the
  Aurixa Systems `/pricing` page.

---

## ⚠ REVISION 2 (2026-07-10) — Storefront topology. Supersedes any conflicting statement below.

**Where purchases land changed; how this repo hands identity over did not.**

The corrected topology: all user-centric monetisation — tokens, plans, seats, from this prime
repo and every clone — flows through **the Aurixa Systems website's `/pricing` page** (the
customer storefront). Mission Control never fronts customers: it is the headless billing engine
(Stripe, webhook, catalog, handoffs, the purchases oversight ledger) **plus** the operators'
discretionary "secondary manner" — ad-hoc token grants, comp top-ups, and plan/seat changes at
Aurixa's discretion, every one recorded in the same ledger for 100% granular oversight.

### What this means for this repo (implemented)

1. **No handoff logic changed.** CTAs still call the `mission-control-handoff` edge function;
   Mission Control now mints those deep links against the storefront
   (`PUBLIC_PRICING_SITE_URL`), so attributed purchase traffic automatically lands on
   `aurixa-systems…/pricing?h=…`. Same for the pre-fetched packs `topup_url`.
2. **Fallbacks re-pointed.** The static fallback for every purchase CTA (used only when the
   handoff mint is unavailable) is now `AURIXA_PRICING_URL` in `src/lib/missionControl.ts` —
   the customer storefront — instead of Mission Control's operator-gated billing pages.
   ⚠ Set this constant to the production storefront domain per deployment.
3. The `MISSION_CONTROL_*_URL` constants remain, documented as **operator consoles** only.
4. Discretionary provisioning granted from Mission Control (grants/comp top-ups/plan changes)
   arrives here exactly like purchased provisioning — via the same balances/entitlements the
   `mission-control-balance` / `mission-control-seats` proxies already read, and it shows in
   the Settings Purchase History card as `admin_*` entries alongside Stripe purchases.

The sections below predate Revision 2; read "Mission Control's pricing page" as
"the Aurixa Systems storefront (backed by Mission Control's storefront API)".

---

> **Repo role in this plan:** `npc-property-dashbord` is the **origin** of purchases — the prime
> command center and the template every clone runs. Its job is to (1) capture *which signed-in
> user* clicked a purchase CTA, (2) hand that identity to Mission Control **server-to-server**
> (never via spoofable query params), and (3) open the resulting attributed deep link.
>
> **Canonical spec** (data model, API contracts, Mission Control work):
> `aurixa-mission-control` → `docs/user-tracking-pricing-workflow-plan.md`
> (same branch `claude/user-tracking-pricing-workflow-deyg3i`).
> The marketing-site entry point is covered in
> `aurixa-systems` → `docs/user-tracking-pricing-workflow-plan.md`.

---

## 1. Problem statement

Purchase CTAs in this app open Mission Control's billing/pricing pages via **static URLs** that
carry no identity at all. The signed-in user's ID (`custom_users.id`, available in every edge
function via `verifyAuth` and in the frontend via `useAuth().user.id`) is dropped at the handoff,
and Mission Control has no way to know which clone install or which end user initiated the
purchase. Report *metering* already carries `user_id` (see `_shared/missionControl.ts` →
`reserveTokens` → `request_payload.user_id`); **purchasing must reach parity**.

## 2. Current state (verified in code)

### Where purchases start (every CTA that must be rewired)

| Component | Line(s) | Opens |
|---|---|---|
| `src/components/billing/TokenBalanceBanner.tsx` | ~95 | `MISSION_CONTROL_TOPUP_URL` (static) |
| `src/components/billing/OutOfTokensBanner.tsx` | ~31, 37, 61 | dynamic `topupUrl` from `mission-control-packs`, falling back to static topup URL; seats URL static |
| `src/components/billing/ReportGenerationStatus.tsx` | ~50, 70–71 | dynamic `topupUrl` fallback static; seats URL |
| `src/components/billing/TokenBalancePill.tsx` | ~175, 184 | static topup + seats URLs |
| `src/components/settings/SeatEntitlementCard.tsx` | ~129 | static seats URL |
| `src/components/settings/PricingCatalogCard.tsx` | ~142 | static catalog URL |

All of them funnel through `openMissionControl(url)` in `src/lib/missionControl.ts:135`, and the
static URLs are the `MISSION_CONTROL_*_URL` constants at `src/lib/missionControl.ts:126-133`.

### Identity that is available but unused at the handoff

- Frontend: `useAuth().user` → `{ id, username, … }` (`src/hooks/useAuth.tsx:13-15`).
- Edge functions: `verifyAuth(supabase, req.headers, body)` → `{ userId, username }`
  (`supabase/functions/_shared/auth.ts`) — already used by every `mission-control-*` function.
- Clone identity: implicit in `MISSION_CONTROL_CLONE_API_KEY` (each install has its own key;
  Mission Control resolves `clone_id` from it) plus `AGENCY_TENANT_REF`
  (`_shared/missionControl.ts:15-19`).

### The gap

1. No purchase CTA sends the user id anywhere.
2. The dynamic `topup_url` minted by Mission Control (`/billing/topup?tenant=<uuid>`) carries the
   tenant but still no user.
3. Nothing records "user X started a purchase" on either side.

## 3. Target design (this repo's slice)

```
CTA click (React)                edge fn: mission-control-handoff        Mission Control
─────────────────                ────────────────────────────────        ───────────────
fetchBillingHandoff({            verifyAuth → userId/username            POST /api/public/billing/handoff
  intent?: "topup" | "seats",    createBillingHandoff({                  (x-clone-api-key)
  itemId?: string                  origin_user_id, origin_username,      → { ok, url, expires_at }
}) ────────────────────────────►   intent, return_url }) ─────────────►
        ◄──────────────────────  { url } ◄──────────────────────────────
openMissionControl(url)          (fallback: null → caller uses
                                  today's static URL)
```

The browser only ever carries an **opaque single-use token** (`?h=<uuid>`); the user identity
travels server-to-server under the clone API key, so it cannot be spoofed or tampered with.

## 4. Work plan

### 4.1 New edge function: `supabase/functions/mission-control-handoff/index.ts`

Mirror `mission-control-packs` exactly (CORS headers, `verifyAuth`, `MissionControlError`
handling):

1. `verifyAuth` → 401 if no valid session; capture `userId`, `username`.
2. Parse body: `{ intent?: "topup" | "seat_plan" | "setup_package" | "pricing", itemId?, returnPath? }`.
3. Call new shared helper (4.2) and return `{ url, expiresAt }` (camelCase to the frontend, per
   existing convention).
4. On Mission Control failure return `{ url: null }` with 200 — the frontend must degrade to the
   static URL, never hard-fail a purchase CTA.
5. Register the function in `supabase/config.toml` consistently with the other
   `mission-control-*` functions (same `verify_jwt` posture).

### 4.2 Shared client: extend `supabase/functions/_shared/missionControl.ts`

Add alongside `listTopupPacks`:

```ts
export interface HandoffArgs {
  originUserId: string;
  originUsername?: string | null;
  intent?: string;            // "<mode>:<item_id>" or bare mode
  returnUrl?: string;         // absolute https URL back into this app
}
export interface HandoffResult { url: string; handoffId: string; expiresAt: string; }

export async function createBillingHandoff(args: HandoffArgs): Promise<HandoffResult> {
  const res = await mcFetch("/api/public/billing/handoff", {
    method: "POST",
    body: JSON.stringify({
      tenant_ref: AGENCY_TENANT_REF,
      display_name: AGENCY_DISPLAY_NAME,
      origin_user_id: args.originUserId,
      origin_username: args.originUsername ?? undefined,
      origin_source: `prime:${AGENCY_TENANT_REF}`,   // clones get their own via their API key
      intent: args.intent,
      return_url: args.returnUrl,
    }),
  });
  const body = await parseOrThrow(res);
  return { url: body.url, handoffId: body.handoff_id, expiresAt: body.expires_at };
}
```

Notes:
- `mcFetch` already handles retry/429/5xx and attaches `x-clone-api-key` — reuse as-is.
- `return_url`: derive from a new optional env `PUBLIC_APP_ORIGIN` (or the request's `origin`
  header validated against an allowlist); Mission Control validates the host server-side.

### 4.3 Frontend: `src/lib/missionControl.ts`

1. Add:

```ts
export type HandoffIntent = "topup" | "seat_plan" | "pricing" | "catalog";

/** Server-minted attributed deep link. Returns null when unavailable (caller falls back). */
export async function fetchBillingHandoffUrl(intent: HandoffIntent, itemId?: string): Promise<string | null> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<{ url: string | null }>(
      "mission-control-handoff",
      { intent, itemId },
    );
    if (error || !data?.url) return null;
    return data.url;
  } catch {
    return null;
  }
}

/** Preferred entry point for all purchase CTAs. */
export async function openMissionControlWithAttribution(intent: HandoffIntent, fallbackUrl: string, itemId?: string) {
  const url = (await fetchBillingHandoffUrl(intent, itemId)) ?? fallbackUrl;
  openMissionControl(url);
}
```

2. Keep the `MISSION_CONTROL_*_URL` constants — they are now the documented **fallbacks only**.

UX note: the CTA click becomes async (one edge-function round-trip before `window.open`).
Popup blockers punish `window.open` calls that aren't in the synchronous click stack — open the
window synchronously on click and set `location` when the handoff resolves, or show a brief
"Opening secure checkout…" pending state on the button. Decide once, apply to all six CTAs.

### 4.4 Rewire the six CTAs (§2 table)

Replace each `openMissionControl(STATIC_URL)` with
`openMissionControlWithAttribution(intent, STATIC_URL)`:

- `TokenBalanceBanner`, `TokenBalancePill`, `OutOfTokensBanner`, `ReportGenerationStatus`
  → intent `"topup"` (topup CTAs) / `"seat_plan"` (seats CTAs);
- `SeatEntitlementCard` → `"seat_plan"`;
- `PricingCatalogCard` → `"pricing"` (full pricing page, clone pinned by the handoff).

For `OutOfTokensBanner`/`ReportGenerationStatus`, which already fetch a dynamic `topupUrl` from
`mission-control-packs`: once Mission Control's packs endpoint can mint handoff URLs
(canonical plan §4 Phase 2.5), pass the authenticated user's context through
`mission-control-packs` → `listTopupPacks` so the pre-fetched `topupUrl` is already attributed,
and the extra handoff round-trip on click disappears for these two components.

### 4.5 (Later, optional — depends on Mission Control Phase 4.5) Purchase history in Settings

- New edge function `mission-control-purchases` (same skeleton) proxying
  `GET /api/public/purchases?tenant_ref=…`.
- New card in `src/pages/Settings.tsx` next to `PricingCatalogCard`: recent purchases for this
  install (date, item, amount, status, purchased-by username) — closes the loop so clone admins
  see the same attributed data operators see in Mission Control.

### 4.6 Config / secrets

No new secrets. Reuses `MISSION_CONTROL_URL` + `MISSION_CONTROL_CLONE_API_KEY`.
**Clone provisioning note:** every clone already receives its own `mck_` API key, which is what
scopes attribution per clone — verify during rollout that no clone shares the prime key,
otherwise all purchases attribute to prime.

## 5. Sequencing & compatibility

1. Ship Mission Control Phases 1–2 first (schema, checkout metadata, handoff endpoint).
2. Then this repo's 4.1–4.4 in one PR. Fallback behaviour means it can even ship early:
   the handoff call returns null until MC deploys, and CTAs behave exactly as today.
3. 4.5 ships after Mission Control Phase 4.
4. Clones pick the change up through the normal clone-sync/cascade process; no per-clone config
   beyond their existing API key.

## 6. Test plan

| Test | Type |
|---|---|
| `createBillingHandoff` sends snake_case payload with tenant_ref + user id; parses url | unit (existing edge-function test patterns) |
| `mission-control-handoff` returns 401 without session; `{ url: null }` on MC outage; url on happy path | edge fn test |
| `fetchBillingHandoffUrl` swallows all failures → null | vitest |
| Each of the six CTAs opens the handoff URL when available and the static URL when not | component tests |
| Popup-blocker behaviour of the async open pattern on Safari/Chrome | manual QA |
| End-to-end (staging): sign in → Top up → Stripe test payment → Mission Control `purchases` row shows this user's id + this install's clone | e2e |

## 7. Risks

- **Async CTA + popup blockers** — mitigations in §4.3; verify on Safari specifically.
- **MC outage / rate limit on click path** — handoff is one extra request per click at 60 req/min
  per key; the null-fallback keeps purchases possible (just unattributed, same as today).
- **Attribution accuracy on shared logins** — attribution is per `custom_users.id`; if a clone
  shares one login among staff, attribution is only as granular as their account hygiene.
  Out of scope here; note for clone onboarding docs.
