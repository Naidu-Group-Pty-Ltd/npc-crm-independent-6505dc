# A build-time variable is read in the one form the bundler replaces

**Status:** closed, 19 Sep 2026. Guarded by
`src/integrations/supabase/__tests__/buildTimeEnvReads.spec.ts`.

## The symptom

A clone provisioned by Aurixa Mission Control could not be logged into with the
credentials Mission Control issued for it.

Everything about the provisioning read as healthy. The Supabase project
(`qvuwrvwzjyigptmnijyb`) existed and its schema was verified. The admin user was
created in it and `password_still_queued` was `false`. All five `VITE_*`
variables were present on the Vercel project, targeted at
`production`/`preview`/`development`. The build that serves the domain started
**85 minutes after** those variables were written, completed `READY`, and is the
deployment the custom domain is aliased to.

## What was actually happening

The deployed bundle carried none of those values. Loading
`https://npc-crm-independent.aurixasystems.com.au/` in a real Chromium and
recording every host it contacts:

```
16  npc-crm-independent.aurixasystems.com.au
 3  dduzbchuswwbefdunfct.supabase.co          <- the PRIME
```

with a realtime socket opened as
`wss://dduzbchuswwbefdunfct.supabase.co/realtime/v1/websocket?apikey=…ref":"dduzbchuswwbefdunfct"…`.

The clone's browser was authenticating against the prime's Supabase project. The
password Mission Control had written into the clone's project does not exist
there, so no credential it issues can ever work.

It is not one clone. Loading each live deployment in the same way, and reading
each one's entry bundle for its own project ref:

| clone | its Supabase project | what the browser contacts |
|---|---|---|
| `npc-crm-independent-6505dc` | `qvuwrvwzjyigptmnijyb` | **the prime** |
| `preflight-property-group` | `egrmsulhtmqnmhvuccxr` | **the prime** |
| `npc-test-76b3b3` | `umrtusxohxjxzodxorim` | **the prime** |
| `npc-client-dashboard` | `plisdzywzleljorrphxv` | its own |

Three of the four authenticate against the prime. The fourth escapes for a
reason that is worth stating plainly: its read is **equally broken** — the same
`readEnv` helper, the same four raw `import.meta` in the bundle — and what
saves it is that somebody rewrote its `FALLBACK_URL`/`FALLBACK_ANON_KEY`
constants to its own project. It reaches the right backend by accident of the
fallback rather than by the environment, so its `VITE_*` variables are ignored
exactly as everywhere else.

## The cause

`src/integrations/supabase/env.ts` read the environment through a helper that
took the variable's NAME:

```ts
function readEnv(key: string): string | undefined {
  const value = (import.meta as { env?: Record<string, string | undefined> })?.env?.[key];
  …
}
```

Vite substitutes the literal token sequence `import.meta.env` — and, for a named
variable, `import.meta.env.VITE_X` — at **build** time. Put anything between
`import.meta` and `.env` (an optional chain, a bracket index) and the sequence no
longer matches. Nothing is substituted; the code keeps a property access on a
browser's real `import.meta`, which has no `env`; the read is `undefined`
forever, however the environment is set.

`resolveSupabaseTarget` then did exactly what it is written to do with two
absent values: it returned the built-in fallback pair, which is the **prime's**.

### Measured, not reasoned

Built this repository locally at the deployed commit, with marker values in the
environment, and grepped the output:

| variable | read as | marker in bundle |
|---|---|---|
| `VITE_TURNSTILE_SITE_KEY` | `import.meta.env.VITE_TURNSTILE_SITE_KEY` | **yes** |
| `VITE_SUPABASE_URL` (AssetLibraryDialog) | `(import.meta as any).env?.VITE_SUPABASE_URL` | **yes** |
| `VITE_SUPABASE_URL` (env.ts) | `import.meta?.env?.[key]` | no |
| `VITE_SUPABASE_ANON_KEY` (env.ts) | `import.meta?.env?.[key]` | no |

A TypeScript cast is not the problem: esbuild removes it before the
substitution runs, so `(import.meta as any).env?.VITE_X` is replaced and
compiles to a string literal. The problem is **an optional chain or a bracket
between `import.meta` and the variable name**.

## Why nobody saw it

Two things, and each on its own is enough.

**The fallback is the prime's own pair**, so the one deployment anybody develops
and tests on is correct by accident. Only a clone is wrong, and only in a
production bundle — a test runner resolves `import.meta.env` itself, so both
forms behave identically under `vitest`.

**The module warns on a HALF-configured environment and says nothing when
neither value arrives**, because that is the prime's ordinary state. A clone
whose variables were dropped is indistinguishable, in the browser, from the
prime. Nothing on the client can tell those apart, which is why the guarantee
that a clone's build carries its OWN project belongs to the provisioner and has
to be asserted **against the deployed bundle** rather than against the variables
it set.

## The other four

The same shape was dead in four more places, and each one's absence looks
exactly like the feature simply being switched off:

| module | variable | consequence |
|---|---|---|
| `lib/templateLibrary/featureFlag.ts` | `VITE_TEMPLATE_LIBRARY` | the env lever had never once fired |
| `lib/reportTemplate/editorV2Flag.ts` | `VITE_TEMPLATE_EDITOR_V2` | same |
| `components/call-logs/CleanupTestCalls.tsx` | `VITE_TEST_CALL_NUMBERS` | list always empty |
| `lib/reportTemplate/adapters/organisation.ts` | `VITE_SUPABASE_URL` | letterhead assets fell through to the client's URL |

All five are now read statically.

## Two rules

**A build-time variable is read as `import.meta.env.VITE_NAME`, written out in
full at the point of use.** A helper that takes the name is the defect; a helper
that takes the *value* is fine, and `usable(value)` in `env.ts` is that helper.

**The form is asserted on the source, because there is nothing to unit-test.**
Both forms are valid TypeScript that returns `undefined` under a test runner.
The defect exists only in a production bundle, so the assertion is about the
SHAPE of the source: `buildTimeEnvReads.spec.ts` scans `src/`, strips comments,
strings and TypeScript casts, and refuses any `import.meta` not immediately
followed by `.env`, `.url` or `.glob`, and any `import.meta.env` that is then
indexed with a bracket. Each of the three broken forms was planted back into a
real module to confirm the gate fails on it.

## One consequence worth naming

While this was broken, `SUPABASE_PROJECT_REF` resolved to the prime on every
clone. `turnstileSiteKey.ts`'s pairing rule — *the built-in widget is used only
while the build talks to the Supabase project its secret lives in* — was
therefore being fed a lie, and handed each clone the **prime's** CAPTCHA widget:
precisely the cross-tenant share that module exists to prevent. The rule was
intact; its input was not. `turnstileSiteKey.ts` had already fixed this exact
class for its own variable, and cites `env.ts` as the precedent for the pairing
rule. It was right about the rule and wrong about the read.
