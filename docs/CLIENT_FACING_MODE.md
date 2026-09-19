# Client-facing deployment mode

One codebase, two deployments. The internal operations console runs with
everything on; a **client-facing deployment** builds with
`VITE_CLIENT_FACING=true` and hides the developer/operator tooling from the
front-end. The client-facing repository
(`npc-client-dashboard`) is a mirror of this one with that flag committed —
it carries no code of its own, so changes land here first and are pulled over.

## What the mode is, and is not

- **It is presentation.** Module permissions, workspace entitlements and the
  edge functions' own auth checks decide *access*, exactly as before. The flag
  removes surfaces from navigation and routing; it grants and revokes nothing.
- **It is build-time only.** Unlike `editorV2Flag` / `templateLibrary` there is
  deliberately no `?param` or localStorage override: the point of a
  client-facing build is that a visitor cannot flip the operator tooling back
  on from the address bar.
- **It never touches the pipelines it hides the controls for.** Hiding the
  Integrations page does not disturb the Make.com → Airtable
  **Property Intake Master** intake (that runs server-side and never depended
  on this UI); hiding the Airtable Sync card on `/automation` stops nobody's
  scheduled sync. Nothing server-side reads this flag.

## The one list

`src/lib/clientFacing.ts` holds `CLIENT_FACING_HIDDEN_PATHS`. Both halves of
the mode read it, so what is unlinked and what is unroutable cannot drift:

- **Navigation** — `useNavigationVisibility` (`src/hooks/useNavigation.ts`)
  filters items by URL. That one hook feeds the desktop sidebar, mobile
  sidebar, bottom bar and the ⌘K command palette (including `paletteOnly`
  items, which never had a sidebar entry to lose).
- **Routing** — `ClientFacingGate` (`src/components/auth/ClientFacingGate.tsx`)
  wraps the dashboard outlet in `DashboardLayout`, so a typed URL or stale
  bookmark lands on a quiet "not available on this dashboard" screen rather
  than the tool. This also covers the internal routes that carry no
  `ModuleGuard` at all (`/admin/report-engine-inspector`,
  `/integrations/ghl-migration`, …).

A path is hidden when it equals an entry or sits beneath one. Matching is by
path segment, never raw string prefix.

## Hidden beyond the list (component-level)

Some developer tooling lives *on* client-relevant pages, so it is gated where
it renders, always through `isClientFacingDeployment()`:

| Surface | Where |
| --- | --- |
| Test Numbers / Flush Test Calls, contact-name backfill | `src/pages/CallLogs.tsx` |
| Data-integrity debug panel | `src/pages/Overview.tsx` |
| Airtable Sync card (Dry Run / Sync Now / Clear Queue) | `src/pages/Automation.tsx` |
| Comparison-score migration card | `src/pages/Settings.tsx` |
| "Change model" deep-link into the Model Hub | `src/components/agentModels/ModelUpgradeButton.tsx` (self-gates, so all six pages that mount it are covered) |
| Pricing mock (A$1 Stripe test catalogue) | `src/lib/pricingMock.ts` — forced off, banner and CTA rewrite both; a shared `?pricingMock=1` link must not sell a tier for a dollar |

## Deliberately NOT hidden

Business features a client workspace runs itself, whatever group the sidebar
files them under: Templates and the Template Builder, Branding/White-label,
Settings, User Management, the portal admin pages, Data Import, the
report-generation switches on `/automation`, Activity Logs, and the AML
workspace (role-gated on its own axis). Superadmin-only cards that already
hide themselves by role (entitlement diagnostics, Mission Control key) keep
that behaviour — the operator debugging a client workspace still needs them.

## The flag is ONE constant (and once was two)

`isClientFacingDeployment()` returns `__CLIENT_FACING__`, the `define`
`vite.config.ts` folds in. That is the whole mechanism, and it is worth saying
why it is stated so firmly.

The function used to read the environment instead:

```ts
resolveClientFacingFlag((import.meta as { env?: … })?.env?.VITE_CLIENT_FACING)
```

which looks equivalent and is not. The TypeScript cast sends the expression
through esbuild's TS transform, which lowers the optional chain into
temporaries — `(_a = import.meta) == null ? void 0 : _a.env` — so the token
`import.meta.env` no longer exists by the time Vite substitutes it.
`import.meta` survives into the browser, where it carries `url` and `resolve`
and **no `env` at all**, so the expression is `undefined` and the flag is
`false`. Written plainly as `import.meta.env.VITE_CLIENT_FACING` it would have
folded correctly; the cast was the bug, not the idea.

Nothing reproduced it. The dev server, `vitest` and every SSR-ish consumer give
`import.meta` a real `env`, so the mode worked everywhere except in a built
bundle — and the built bundle is the only place it matters. Measured on the
deployed `npc.aurixasystems.com.au` bundle: `bw()` carried the lowered
expression verbatim, and all five `__EXCLUDE_*__` chunks were correctly absent
beside it.

What that cost, on every client-facing build ever deployed:

- **The navigation filter never engaged** — `useNavigationVisibility` asked a
  flag that answered `false`, so the sidebar, mobile sidebar, bottom bar and
  command palette all listed every operator tool.
- **`ClientFacingGate` waved every hidden URL through**, including the routes
  that carry no `ModuleGuard` at all.
- **Every component-level gate in the table above rendered its control** — Test
  Numbers, the data-integrity debug panel, the Airtable Sync card, the pricing
  mock.
- **And the one visible symptom**: `/integrations` resolved to
  `RouteExcludedFromBuild`, which was `() => null`, because the build half of
  the decision HAD worked and dropped the chunk. The page drew a blank content
  area — no title, no cards, no explanation — which reads as broken rather than
  as withheld.

Three things hold it now. The runtime reads the folded constant, so the two
halves cannot disagree. `RouteExcludedFromBuild` renders the gate's own
`NotOnThisDeployment` notice, so a route with no chunk explains itself whatever
the flag says. And the rule is asserted rather than trusted —
`src/lib/__tests__/clientFacing.test.ts` fails if `clientFacing.ts` names
`import.meta` outside a comment, `scripts/check-clone-invariants.sh` repeats it,
and `src/lib/__tests__/routeExclusionGates.test.ts` cross-checks every
`__EXCLUDE_*__` against the hidden-path list.

## Keeping one named page on a deployment

`VITE_CLIENT_FACING_ALLOW` is a comma-separated list of entries from
`CLIENT_FACING_HIDDEN_PATHS` that this build keeps. An allowance can only give
back something the list took: a path that is not in the list verbatim is
ignored, so a typo cannot name a surface nobody reviewed, and a child with its
own entry (`/admin/finance-portal/health`) keeps its own decision when the
parent is allowed.

It has to reach **both** halves of the mode or it is a trap — a routable page
whose chunk was never built is exactly the blank screen above — so
`vite.config.ts` parses it once and derives the runtime list
(`__CLIENT_FACING_ALLOW__`) and each `__EXCLUDE_*__` from that one value.
Allowing a path therefore also re-admits its chunk, which for these five is the
point of hiding them; weigh that before adding one.

The prime is the internal operations console: `VITE_CLIENT_FACING` is unset,
so the constant folds to `false` and nothing here is hidden or excluded. The
module is shared with `npc-client-dashboard`, which is where the mode runs.

## Which Supabase project the build talks to

A second deployment usually wants a second backend, and that used not to be
possible for a reason unrelated to this mode: **31 source files wrote
`https://dduzbchuswwbefdunfct.supabase.co` and its publishable key into their
own module scope** — `useAuth`, `secureInvoke`, `integrations/supabase/client`,
every portal hook and lib — so setting `VITE_SUPABASE_URL` moved nothing.

All 31 now import from `src/integrations/supabase/env.ts`, the one module that
resolves it. A build that sets neither variable is byte-for-byte the old
behaviour, so this changed nothing about the internal console.

Three rules that module enforces, each of which was a live defect:

- **The URL and the key are a matched pair.** The anon key is a JWT whose `ref`
  claim names its project, so a URL from one and a key from another
  authenticate to nothing. Set both or neither — a half-configured environment
  uses *both* built-in defaults rather than mixing them, and says so on the
  console. A genuinely mismatched pair is honoured and warned about by ref,
  because that is a configuration error and should read as one.
- **The fallback is never empty.** `internalMessageAttachments.ts` read
  `VITE_SUPABASE_URL ?? ''`, which made the upload PUT relative — it went to
  the app's own origin and got HTML back.
- **The project ref is derived, never named a third time.**
  `VITE_SUPABASE_PROJECT_ID` was a third spelling of the same project, free to
  disagree with the other two; unset, `TemplateSharePreview` fetched
  `https://undefined.supabase.co/functions/v1/template-share`. Nothing live
  reads it now — `SUPABASE_PROJECT_REF` comes off the resolved URL, and the
  Integrations page's "Supabase dashboard" link is built from it rather than
  sending every deployment's operator to the prime's project.

## Adding to (or trimming) the list

Edit `CLIENT_FACING_HIDDEN_PATHS` — nav and routing follow together.
`src/lib/__tests__/clientFacing.test.ts` cross-checks the list against the
navigation registry both ways: the named operator tools must be hidden, the
client features must not be, and with the flag off nothing changes at all.
