# The complete execution route, resolved before anything is provisioned

*Measured 18 September 2026 from this session. The instruction it answers:
"Do not request branch creation while leaving the subsequent invocation route
unresolved."*

## 1. SUPERSEDED — the egress is open, and the browser runs

**Re-measured 18 September 2026. The finding below was wrong, and the whole
route it closed is open.**

This section read: *"One leg of the route is closed, and no credential or
branch opens it. The sandbox's egress is a fixed proxy policy that denies
`CONNECT` to every web host … so the frontend half of the journey — R1 to R11
— cannot be exercised from this session against any deployment."* It recorded
`ERR_TUNNEL_CONNECTION_FAILED` against four hosts and concluded from
`example.com` that the sandbox refuses an ordinary public page.

Re-run today with the same tool against the same four hosts:

| host | then | now, default | now, validation bypassed (diagnostic) |
| --- | --- | --- | --- |
| `example.com/` | TUNNEL_CONNECTION_FAILED | CERT_AUTHORITY_INVALID | **HTTP 200** |
| `…supabase.co/functions/v1/` | TUNNEL_CONNECTION_FAILED | CERT_AUTHORITY_INVALID | reached (redirects) |
| `api.perplexity.ai/` | TUNNEL_CONNECTION_FAILED | CERT_AUTHORITY_INVALID | reached (HTTP error status) |
| `ai.gateway.lovable.dev/` | TUNNEL_CONNECTION_FAILED | CERT_AUTHORITY_INVALID | reached (redirects) |

The third column was measured with `ignoreHTTPSErrors: true`, which
**bypasses certificate validation — it does not establish that the proxy CA
is trusted**. An earlier draft of this section described that context as
"trusting the proxy CA", and that description was wrong: the probe was a
layer-isolation diagnostic (it proved the tunnel open and the failure to be
TLS), never a trust configuration, and nothing authenticated may run in it.

And from the shell, where curl already trusts the bundle, all three non-control
hosts answer **HTTP 404** in under half a second — the correct answer for an
unauthenticated GET to a bare root. **No credential was sent to any of them**;
reachability and what a provider does with a key are different questions and
this probe asked only the first.

So there is no CONNECT denial. What was left was narrower, and it is now
resolved rather than worked around. `/root/.ccr/README.md` states the browser
NSS store is "already set up"; measured with certutil, `~/.pki/nssdb` was
**empty**, which is the whole reason default-context navigation failed
`ERR_CERT_AUTHORITY_INVALID`. **The approved TLS configuration is that store
actually loaded**: every certificate of the environment's own
`/root/.ccr/ca-bundle.crt` imported as a trust anchor (`certutil -A -t "C,,"`,
152 distinct anchors), so the browser trusts exactly what every other tool in
this environment trusts and nothing else. Re-measured with a DEFAULT context —
certificate validation ON — `example.com` answers **HTTP 200** and the
Supabase functions root **HTTP 404**
(`docs/reports/evidence/BROWSER_TLS_TRUST_2026-09-18.json`;
`scripts/verify/probe-browser-tls.mjs`). `ignoreHTTPSErrors` is retired from
the route. The import lives in the container, so a fresh session re-runs the
two commands recorded in the probe's header. The proxy's own status
endpoint reports `selective: false` with no relay failures of that kind.

**The browser also needs its binary named.** `playwright@1.62.1` looks for
`chromium_headless_shell-1234`; this image ships `chromium-1194`. That is a
version pin, not a block, and the fix is one launch option:

```js
chromium.launch({
  args: ['--no-sandbox'],
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
// → Chromium 141.0.7390.37 launches, renders, and navigates.
```

Both probes are retained: `.verify/probe-browser.mjs` and
`.verify/probe-routes.mjs`.

**What this changes.** The frontend journey (R1–R11) is no longer blocked by
the environment. It is blocked only by what it needs to point AT — an
authorised isolated environment with its own data — which is a provisioning
question and not a network one. The leg table below is corrected accordingly.

**What this does not change.** The MCP servers still run outside the sandbox
and are still how production is reached. The Supabase MCP server's
authorisation has **lapsed in this session** and `execute_sql` is additionally
denied by a permission rule, so every route in the table that runs through it
is unavailable until that is restored — which is a different obstacle from the
one this section used to describe, and it is the only one now standing.

**Why the earlier measurement was believed.** It was taken, it was real at the
time, and it was recorded with its evidence. What made it dangerous was its
SCOPE: a blanket "the sandbox has no egress" is a premise every later question
inherits, so nobody re-asked it — the six register probes in
`docs/reports/evidence/PLANNING_PROBE_2026-09-18.json` were left unrun for
exactly that reason, and they answer HTTP 200. An environmental finding needs
a re-measurement date, not just a measurement date.

## 2. The route, leg by leg

| Leg | Route | Status |
| --- | --- | --- |
| Provision an isolated project | `mcp__Supabase__create_branch` | **Broken.** It rejects `confirm_cost_id` with a Zod error although its own schema requires that field, and times out without it. Neither attempt produced a resource, so there is nothing to reconcile and nothing was charged. Established in a previous session; not re-tested today, because a retry risks creating a chargeable resource. |
| Set secrets on it | Supabase Management API | **Closed from here.** No MCP tool sets a function secret, and `api.supabase.com` is behind the same 403. |
| Deploy candidate functions | `mcp__Supabase__deploy_edge_function` | **Open.** Runs through the MCP server. |
| Invoke the authenticated handlers | `execute_sql` + `pg_net` | **Open.** `pg_net 0.14.0` is installed on the project and the HTTP call is made *by the database*, outside this sandbox. Every request id is recorded in `net._http_response` and disclosed. |
| Exercise the frontend | headless Chromium | **Open**, with `executablePath` named and the CA bundle imported into the browser NSS store — certificate validation stays ON (§1). What it still needs is an authorised isolated environment to point at. |
| Retrieve evidence | `execute_sql`, `query_logs` | **Blocked today** — the Supabase MCP authorisation lapsed in this session and `execute_sql` is denied by a permission rule. Open again once re-authorised. |

## 3. What that means for the ask

The isolated environment would buy the **server half** and not the frontend
half. Specifically:

**It would close** — S5-D (the real Briefing and Snapshot condensation through
`condense-investment-report`, replacing the named stand-in), S5-G (CGR and the
financial cascade protected through a real run rather than compared on
persisted children), the server-side cases in S5-H, the fresh-generation
verification every content item is waiting on (the subject-price correction in
narrative, the composed strategy sections beside model prose, the market chart
guard firing on real output), and S5-K's ten PDFs.

**It would not close** — R1 to R11. Those need a browser that can reach the
deployment. Three ways exist and each is the owner's call rather than mine:

1. **The owner drives them**, against the branch or against production with
   the candidate build, and reports what they see. No new infrastructure.
2. **A CI job drives them** — GitHub Actions runners have ordinary egress, so
   a Playwright job on the branch can exercise the journey and upload traces,
   screenshots and a report as artefacts. This is the only route that produces
   machine-checkable evidence without a person watching, and it is a workflow
   file plus the branch's URL and an approved test login.
3. **They stay open**, declared, into S6.

Route 2 is the one I would build, because it is the only one that survives
this sandbox and produces evidence rather than assertion. It needs no
credential in this repository: the branch URL and anon key are public values,
and the test login would be a repository secret the workflow reads.

## 4. Per provider, what is actually needed

**Perplexity.** A test key is a normal API key minted by the account holder in
their own Perplexity account. I have not verified the settings URL from here
and will not assert one — the destination is the account holder's own
Perplexity API settings page. It would be set as a function secret on the
isolated project, which is the leg that is closed from this session, so it is
the owner or a CI job that sets it.

**Lovable.** `LOVABLE_API_KEY` is the AI-gateway credential Lovable provisions
into the Supabase project that a Lovable project is connected to. Verified
today: this repository's app is Lovable project
`7976d60b-c277-4851-889b-c170285f4be2` in workspace `JqcsuFgT71nlgYSNsEMB`,
and **the Lovable MCP surface available here exposes no operation that reads,
mints, rotates or copies an API key** — there is no such tool among the sixty
it offers. So the assumption that it can be copied to a second project is not
one this session can support. Two consequences:

- A Supabase **branch** is not a Lovable project, so Lovable will not
  provision a key into it.
- The condense path (`callLLMRaw` → `llmRouter` route `gateway` →
  `ai.gateway.lovable.dev`, model `google/gemini-2.5-flash` from
  `agent_model_assignments`) therefore has no credential on an isolated
  project unless one is supplied another way.

That is a real constraint on S5-D, and it is worth stating plainly before
anyone provisions anything: **the Briefing and the Snapshot are the two
outputs whose credential path a branch does not obviously reproduce.**

## 5. What was verified, and what was not

Verified today, in this session: the browser's network position (four hosts,
including `example.com`); the proxy's own policy statement; the Lovable
workspace, project and the absence of any key operation on its MCP surface;
that `pg_net` is installed on the production project and that `execute_sql`
answers.

Not verified today: `create_branch`'s two failure modes, which are carried
from a previous session and were not re-tested because a retry risks creating
a chargeable resource; the Perplexity settings URL, which is not reachable
from here and which this document therefore does not name.
