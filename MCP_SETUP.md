# MCP & Agent Skills Setup

This repo ships a shared **Claude Code** configuration for frontend design work:
Model Context Protocol (MCP) servers in [`.mcp.json`](./.mcp.json) and agent skills
under [`.claude/skills/`](./.claude/skills/). Everything here is checked in except
secrets — no API keys are committed.

## What's included

### MCP servers (`.mcp.json`)

| Server            | Package                        | Purpose                                                                 |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `shadcn`          | `shadcn@latest mcp`            | Browse/add shadcn/ui components and blocks (this repo already uses shadcn — see `components.json`). |
| `chrome-devtools` | `chrome-devtools-mcp@latest`   | Drive a real Chrome instance — inspect the DOM, network, console, and take screenshots. |
| `@21st-dev/magic` | `@21st-dev/magic@latest`       | Generate/refine UI components from natural language (local stdio server). **Requires an API key.** |
| `21st`            | hosted HTTP — `https://21st.dev/api/mcp` | 21st.dev's hosted component tooling. Nothing to install; authenticated with an `x-api-key` header. **Requires an API key.** |
| `vapi-mcp`        | hosted HTTP — `https://mcp.vapi.ai/mcp` | Vapi's hosted server — assistants, phone numbers, calls. Used for the Vapi leg of the account migration. **Requires an API key.** |

The `npx`-based servers launch on demand, so there is nothing to install ahead of
time — the packages are fetched the first time Claude Code starts the server. The
`21st` server is remote (streamable HTTP) and needs no local package at all.

### Agent skills (`.claude/skills/`)

| Skill                    | Source                                                                                          | Purpose                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `web-design-guidelines`  | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | Reviews UI code against Vercel's Web Interface Guidelines (accessibility, UX, best practices). |
| `frontend-design`        | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design)     | Guidance for distinctive, intentional visual design — palette, typography, layout. (Apache-2.0, see `LICENSE.txt`.) |

Skills load automatically when Claude Code detects a matching request (e.g. "review
my UI" or "design a new landing page"), and can be invoked explicitly with
`/web-design-guidelines` or `/frontend-design`.

## Setting up `vapi-mcp`

`.mcp.json` holds only the `${VAPI_TOKEN}` placeholder — the key is never committed.
Put your Vapi **private** API key (Vapi dashboard → Organization → API Keys) into the
environment and restart Claude Code from that shell:

```bash
export VAPI_TOKEN="your-vapi-private-key"
```

### Why this is a plain `http` server and not `npx mcp-remote`

The configuration Vapi's docs suggest wraps the endpoint in `mcp-remote`. That does not
work from a bare environment, and the failure is misleading rather than obvious:

- `mcp-remote` begins with OAuth discovery and a **GET** against the URL.
- `GET https://mcp.vapi.ai/mcp` returns a **404 HTML page** — Vapi only serves MCP over
  `POST` there. `mcp-remote` reports `Invalid OAuth error response` and a wall of Next.js
  markup, then falls back to SSE-only, which 404s too, and dies.
- The URL was never wrong. `POST https://mcp.vapi.ai/mcp` with a bad key returns a clean
  **`401 Invalid Vapi token`**, which is the endpoint working correctly.

Claude Code speaks streamable HTTP natively, so the `mcp-remote` hop is unnecessary here.
Pointing `type: "http"` straight at the URL skips OAuth discovery entirely and removes a
dependency on `npx` reaching the npm registry at launch. This is the same shape the
`21st` server already uses.

If you do need `mcp-remote` (for a client that only speaks stdio), force the transport so
it never attempts the GET:

```bash
npx -y mcp-remote https://mcp.vapi.ai/mcp --transport http-only \
  --header "Authorization: Bearer ${VAPI_TOKEN}"
```

There is also a `https://mcp.vapi.ai/sse` endpoint, which answers `401` to an
unauthenticated request, and a `https://mcp.vapi.ai/api/mcp` which initialises **without
any credential at all** and identifies itself as `mcp-typescript server on vercel`. That
second one is not the Vapi API surface — do not point anything at it.

## One-time setup: 21st.dev API keys

Both 21st.dev servers need an API key, and **neither key is committed**. `.mcp.json`
holds only `${…}` placeholders that Claude Code expands from your environment at
launch:

| Server            | Placeholder in `.mcp.json` | How it is passed                     |
| ----------------- | -------------------------- | ------------------------------------ |
| `@21st-dev/magic` | `${MAGIC_API_KEY}`         | `env.API_KEY` (not a CLI argument)   |
| `21st`            | `${TWENTY_FIRST_API_KEY}`  | `headers.x-api-key` request header   |

1. Sign in and create a key at the **21st.dev console**: <https://21st.dev/magic/console>
2. Provide the key(s) to your shell via **either** option:

   **Option A — shell export (simplest):**
   ```bash
   export MAGIC_API_KEY="your-key-here"
   export TWENTY_FIRST_API_KEY="your-key-here"
   ```
   Add those lines to your shell profile (`~/.zshrc`, `~/.bashrc`, …) so they persist.

   **Option B — local env file:**
   ```bash
   cp .env.example .env.local          # .env.local is git-ignored
   # edit .env.local and set MAGIC_API_KEY / TWENTY_FIRST_API_KEY
   set -a && source .env.local && set +a   # export them before launching Claude Code
   ```

3. Start (or restart) Claude Code from that shell so it can expand the placeholders.
   The `shadcn` and `chrome-devtools` servers need no key and work with no additional
   configuration.

### Registering `21st` outside this repo

The project-scoped `.mcp.json` above already covers anyone working in this repo. To
add the same server to a personal (user-scoped) config elsewhere, use the CLI —
expanding the variable in your shell rather than pasting a literal key:

```bash
claude mcp add --transport http 21st https://21st.dev/api/mcp \
  --header "x-api-key: $TWENTY_FIRST_API_KEY"
```

Note that `claude mcp add` writes the **resolved** value into `~/.claude.json`, so the
key lands on disk in plaintext there. That file is outside the repo and never
committed, but treat it as a secret-bearing file.

## Secret hygiene

- **Never commit a real key.** Only the `${MAGIC_API_KEY}` and `${TWENTY_FIRST_API_KEY}`
  placeholders live in `.mcp.json`. `MAGIC_API_KEY` must remain in the server's `env`
  configuration so it is not exposed in process arguments; `TWENTY_FIRST_API_KEY` must
  remain in the `21st` server's `headers` block.
- **A key that has been pasted into a chat, an issue, or a commit is burned.** Rotate it
  at <https://21st.dev/magic/console> rather than reusing it.
- `.env`, `.env.local`, and every `.env.*` (except `.env.example`) are git-ignored —
  see [`.gitignore`](./.gitignore). Keep the real key in one of those local files or in
  your shell environment.
- `.env.example` documents the `MAGIC_API_KEY` placeholder with an empty value; copy it
  to a local file rather than editing it in place.

## Verifying

From the repo root:

```bash
claude mcp list          # shows shadcn, chrome-devtools, @21st-dev/magic, 21st
```

Servers are listed as `⏸ Pending approval` until you approve this project's `.mcp.json`
once, from an interactive `claude` session. Any server whose key is missing from the
environment is reported under **MCP config diagnostics** as
`Missing environment variables: …`.

Inside a Claude Code session, `/mcp` shows connection status for each server, and the
`web-design-guidelines` / `frontend-design` skills appear in the skills list.
