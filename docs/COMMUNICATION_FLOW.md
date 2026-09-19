# NPC Command Centre — Communication Flow

_Last updated: 2026-07-08_

## 1. Purpose

This document explains the end-to-end communication flow of the NPC Command Centre codebase. It focuses on how requests, responses, tokens, realtime events, webhooks, external integrations, and background job status updates move through the system.

Use this document when debugging:

- login/session problems;
- Supabase Edge Function CORS/auth failures;
- stale or missing notifications;
- GHL conversation sync issues;
- outbound SMS/WhatsApp/email sending;
- client portal or finance portal session issues;
- report-generation progress and completion;
- webhook ingestion from GHL, Outlook, Vapi, or external automation systems.

## 2. Communication map

```mermaid
flowchart TD
  Browser[Browser UI]
  StaffAuth[Staff AuthProvider]
  PortalAuth[Client Portal AuthProvider]
  FinanceAuth[Finance Portal AuthProvider]
  SecureInvoke[invokeSecureFunction]
  PortalInvoke[Portal invoke helpers]
  Edge[Supabase Edge Functions]
  DB[(Supabase Postgres)]
  RT[Supabase Realtime]
  Storage[(Supabase Storage)]
  GHL[GoHighLevel / LeadConnector]
  Outlook[Outlook / Email]
  Vapi[Vapi]
  Airtable[Airtable]
  DataAPIs[Property / market data APIs]
  AI[AI / report services]

  Browser --> StaffAuth
  Browser --> PortalAuth
  Browser --> FinanceAuth
  StaffAuth --> SecureInvoke
  Browser --> SecureInvoke
  PortalAuth --> PortalInvoke
  FinanceAuth --> PortalInvoke
  SecureInvoke --> Edge
  PortalInvoke --> Edge
  Edge --> DB
  Edge --> Storage
  Edge --> GHL
  Edge --> Outlook
  Edge --> Vapi
  Edge --> Airtable
  Edge --> DataAPIs
  Edge --> AI
  DB --> RT
  RT --> Browser
```

## 3. Main communication channels

| Channel | Direction | Used for |
| --- | --- | --- |
| Browser -> Supabase browser client | direct | safe table reads/writes, realtime subscriptions, selected storage operations |
| Browser -> `invokeSecureFunction` -> Edge Function | request/response | staff dashboard backend operations, third-party API calls, privileged DB operations |
| Browser -> portal invoke helpers -> Edge Function | request/response | client portal and finance portal operations |
| Edge Function -> Supabase Postgres | server-side | service-role reads/writes, status updates, webhooks, logs |
| Edge Function -> third-party API | server-side | GHL, Outlook, Airtable, property data services, AI engines |
| Third-party webhook -> Edge Function | inbound webhook | GHL events, Vapi calls, Outlook email/calendar webhooks, automation callbacks |
| Supabase Postgres -> Realtime -> Browser | event stream | notifications, conversations, message updates |
| Browser -> localStorage/sessionStorage | local state | session tokens, background job IDs, processed job IDs, UI handoff state |

## 4. Staff Command Centre request flow

Most staff dashboard operations follow this path:

```mermaid
sequenceDiagram
  participant Page as Staff page/component
  participant Invoke as invokeSecureFunction
  participant Edge as Supabase Edge Function
  participant Auth as _shared/auth.ts
  participant DB as Supabase Postgres
  participant External as External service

  Page->>Invoke: invokeSecureFunction(functionName, body)
  Invoke->>Invoke: Read access token + session token
  Invoke->>Edge: POST /functions/v1/functionName
  Edge->>Auth: verifyAuth(headers, body)
  Auth->>DB: Validate custom session or user JWT
  Auth-->>Edge: userId / auth method
  Edge->>DB: Read/write business data
  Edge->>External: Optional third-party API call
  External-->>Edge: Optional response
  Edge-->>Invoke: JSON response + status
  Invoke-->>Page: { data, error }
```

`invokeSecureFunction` is the default communication gateway for internal staff calls. It centralizes:

- token selection;
- session-token fallback;
- body token injection;
- Command Centre messaging token aliases;
- request timeout handling;
- one-shot token refresh;
- repeated-auth-failure circuit breaking;
- report token usage event emission;
- insufficient-funds event emission.

## 5. Staff authentication flow

```mermaid
sequenceDiagram
  participant User
  participant UI as AuthProvider
  participant Login as custom-auth-login
  participant Verify as custom-auth-verify
  participant Logout as custom-auth-logout
  participant DB as Supabase Postgres
  participant Device as deviceSession helpers

  User->>UI: Enter username/password
  UI->>Login: POST username/password/turnstile_token
  Login->>DB: Validate custom_users and create user_sessions row
  Login-->>UI: user, roles, access_token, session_token
  UI->>Device: registerCurrentDevice()
  Device->>DB: Insert/update active device
  UI->>UI: Store tokens and set authenticated user

  UI->>Verify: On reload/checkSession
  Verify->>DB: Validate session_token and roles
  Verify-->>UI: valid user and refreshed tokens

  User->>UI: Sign out
  UI->>Device: releaseCurrentDevice()
  UI->>Logout: POST session_token
  Logout->>DB: Invalidate session
  UI->>UI: Clear local/session storage
```

Staff browser storage keys:

```text
supabase_access_token
session_token
current_user
auth_version
```

Important auth behaviour:

- `custom-auth-verify` is used both for initial session verification and token refresh.
- If a staff session reaches device limits, the app keeps pending tokens only long enough for the user to revoke another device or cancel sign-in.
- Device heartbeat runs every five minutes while the user is signed in.

## 6. Auth token transport rules

### 6.1 Internal staff calls

Internal staff calls may carry the same session through multiple locations for resilience:

```text
Authorization: Bearer <access token or anon key>
apikey: <Supabase anon key>
x-session-token: <session_token>
x-command-centre-session-token: <session_token>   // selected messaging functions only

JSON body:
{
  ...payload,
  "session_token": "<session_token>",
  "command_centre_session_token": "<session_token>" // selected messaging functions only
}
```

### 6.2 Backend token extraction order

The shared auth helper extracts the session token in this order:

1. cookie `session_token`;
2. `x-command-centre-session-token` header;
3. `x-session-token` header;
4. `command_centre_session_token` body field;
5. `session_token` body field;
6. non-JWT bearer token.

Before session fallback, the backend also accepts:

- direct service-role bearer matches;
- service-role JWT role;
- authenticated Supabase JWTs that map to `custom_users`.

### 6.3 Body-token-only functions

Some template/PDF functions intentionally receive session tokens in the body only, because custom headers can trigger CORS preflight failures on older function deployments.

Current body-token-only function names in `secureInvoke`:

```text
template-import-pdf
template-design-agent
render-source
import-from-url
pdf-parse-dispatch
```

## 7. Client portal communication flow

Client portal calls use a separate session token and separate invoke helper.

```mermaid
sequenceDiagram
  participant Client as Client browser
  participant PortalAuth as PortalAuthProvider
  participant Edge as client-portal-* functions
  participant DB as Supabase Postgres

  Client->>PortalAuth: Login with email/password
  PortalAuth->>Edge: client-portal-login
  Edge->>DB: Validate portal client credentials
  Edge-->>PortalAuth: portal user + session_token
  PortalAuth->>PortalAuth: Store portal_session_token

  Client->>Edge: client portal action
  Edge->>DB: Validate portal_session_token
  Edge->>DB: Read/write client-scoped data
  Edge-->>Client: JSON response
```

Client portal token transport:

```text
Browser key: portal_session_token
Header: x-portal-session-token
Body: portal_session_token, session_token
Authorization: Bearer <anon key>
```

Typical functions:

- `client-portal-login`
- `client-portal-verify`
- `client-portal-logout`
- `client-portal-forgot-password`
- `client-portal-reset-password`
- `client-portal-invite`
- `client-portal-accept-invite`
- `get-portal-client-data`
- `manage-portal-client-data`
- `client-portal-comms`

## 8. Finance portal communication flow

Finance portal calls also use their own session token and invocation helper.

```mermaid
sequenceDiagram
  participant Finance as Finance browser
  participant FinanceAuth as FinancePortalAuthProvider
  participant Edge as finance-portal-* functions
  participant DB as Supabase Postgres

  Finance->>FinanceAuth: Login with email/password
  FinanceAuth->>Edge: finance-portal-login
  Edge->>DB: Validate finance contact credentials
  Edge-->>FinanceAuth: finance user + session token
  FinanceAuth->>FinanceAuth: Store finance_portal_session_token

  Finance->>Edge: finance portal action
  Edge->>DB: Validate finance_session_token
  Edge->>DB: Read/write finance-scoped data
  Edge-->>Finance: JSON response
```

Finance portal token transport:

```text
Browser key: finance_portal_session_token
Header: x-finance-session-token
Body: finance_session_token, session_token
Authorization: Bearer <anon key>
```

The finance invoke helper has a protective re-verify flow:

1. if a non-login function returns a 401 with invalid/expired session wording;
2. and the user was not very recently authenticated;
3. the helper calls `finance-portal-verify`;
4. only if verification fails does it clear the session and redirect to `/finance/login`.

This avoids logging users out because of a single transient widget or race-condition failure.

## 9. Realtime communication flow

Realtime is used for UI freshness without manually polling every table.

### 9.1 Notifications

```mermaid
sequenceDiagram
  participant Producer as UI / Edge Function / webhook
  participant DB as notifications table
  participant RT as Supabase Realtime
  participant UI as NotificationsProvider

  Producer->>DB: Insert/update notification
  DB-->>RT: postgres_changes event
  RT-->>UI: realtime event
  UI->>DB: Fetch latest 50 notifications
  UI->>UI: Update unread count and notification list
```

Notification routing is centralized in `handleNotificationClick`. Notification type controls the destination, for example:

- report notifications -> `/generated-reports?tab=investment`
- call notifications -> `/call-logs`
- appointment notifications -> `/calendar`
- client/deal/reminder notifications -> `/clients`, `/deal-pipeline`, or `/reminders`
- portal messages -> client profile tabs
- finance portal messages -> client finance message tabs
- GHL conversation replies -> `/conversations`

### 9.2 GHL conversations

The Conversations page subscribes to:

- `ghl_conversations` changes;
- inserted `ghl_conversation_messages` rows.

When matching changes arrive, the page invalidates/refetches relevant React Query caches.

## 10. Background job communication flow

Long-running work is represented by persisted status plus client-side polling.

```mermaid
flowchart TD
  UI[User starts long job] --> AddJob[addBackgroundJob event]
  AddJob --> Local[localStorage background_jobs]
  Tracker[BackgroundJobTracker] --> Poll[Poll every 3 seconds]
  Poll --> Edge[Status Edge Function]
  Edge --> DB[(Job/report table)]
  DB --> Edge
  Edge --> Tracker
  Tracker --> Done{completed or failed?}
  Done -- no --> Poll
  Done -- yes --> Clean[Remove local job]
  Done -- failed --> Notify[Add failure notification]
  Done -- completed --> ServerNotify[Use server-created notification when available]
```

Tracked job types:

```text
bulk_generation
comparison_analysis
investment_report
```

Status check routes:

- bulk generation: `manage-templates` with `bulk_generation_jobs` table;
- comparison analysis: `get-investment-reports` with `property_comparisons` table;
- investment report: `get-investment-reports` selecting `id, property_address, status, error_message`.

## 11. Airtable/property listing communication flow

```mermaid
sequenceDiagram
  participant UI as Reports/Listings UI
  participant PDS as propertyDataService
  participant Lib as airtableService
  participant Edge as airtable-proxy
  participant Airtable as Airtable API

  UI->>PDS: fetchAllListings()
  PDS->>PDS: Check local memory cache
  PDS->>Lib: getRecords(pageSize, offset, sort)
  Lib->>Edge: invokeSecureFunction("airtable-proxy")
  Edge->>Airtable: Fetch records using server-side credentials
  Airtable-->>Edge: records + offset
  Edge-->>Lib: transformed records
  Lib-->>PDS: PropertyListing[]
  PDS->>PDS: standardize + quality scoring
  PDS-->>UI: listings + debugInfo
```

The browser does not contact Airtable directly. This protects Airtable credentials and keeps record transformation centralized.

## 12. Investment report communication flow

```mermaid
sequenceDiagram
  participant UI as Report UI
  participant Edge as generate-investment-report
  participant Auth as verifyAuth
  participant DB as Supabase Postgres
  participant Data as Data service functions
  participant AI as AI/research engine
  participant Notify as notifications

  UI->>Edge: reportId, propertyAddress, propertyDetails, overrides
  Edge->>Auth: Validate staff session/service role
  Auth-->>Edge: userId
  Edge->>DB: Load existing report and manual overrides
  Edge->>Edge: Resolve report scope and effective values
  Edge->>Data: Parallel calls: Domain, ABS, RBA, SEIFA, crime, employment, climate
  Data-->>Edge: data or graceful failure
  Edge->>Data: Dependent calls: risk, SQM rent, financial calculator
  Data-->>Edge: enhanced data
  Edge->>AI: Generate report sections
  AI-->>Edge: markdown/report content
  Edge->>DB: Update investment_reports status/content/enhanced fields
  Edge->>Notify: Insert completion/failure notification when applicable
  Edge-->>UI: success/error response
```

Important communication rules:

- service-to-service data calls use the Supabase service-role bearer token;
- independent data services are fetched in parallel;
- dependent services run after initial data is available;
- failures in non-critical data services should degrade gracefully rather than failing the entire report;
- report rows must reflect status accurately: `processing`, `completed`, or `failed`;
- failures should store `error_message` for UI and operational diagnosis.

## 13. GHL conversation sync flow

```mermaid
sequenceDiagram
  participant UI as Conversations page
  participant Sync as sync-ghl-conversations
  participant DB as Supabase Postgres
  participant GHL as LeadConnector API
  participant RT as Supabase Realtime

  UI->>Sync: mode=incremental or client/contact specific
  Sync->>DB: Verify session and load GHL credentials
  Sync->>DB: Resolve clients with ghl_contact_id
  loop each contact
    Sync->>GHL: GET /conversations/search?locationId&contactId
    GHL-->>Sync: conversations
    Sync->>DB: Upsert ghl_conversations
    loop each conversation
      Sync->>GHL: GET /conversations/{id}/messages
      GHL-->>Sync: messages
      Sync->>DB: Upsert ghl_conversation_messages
    end
  end
  DB-->>RT: realtime change events
  RT-->>UI: refresh conversations/messages
  Sync-->>UI: counts and errors
```

Key implementation details:

- credentials are resolved through `getEffectiveGhlCredentials`;
- contacts can be synced by `client_id`, `ghl_contact_id`, or bulk mode;
- rate limits are respected with delays between contacts/pages;
- conversations and messages are upserted, not blindly inserted;
- message dates and channels are normalized before persistence.

## 14. Outbound GHL message flow

```mermaid
sequenceDiagram
  participant UI as Conversations page
  participant Send as send-ghl-message
  participant DB as Supabase Postgres
  participant GHL as LeadConnector API
  participant RT as Supabase Realtime

  UI->>Send: conversationId, message, type, subject optional
  Send->>DB: verifyAuth and load GHL credentials
  Send->>DB: Look up contact ID for SMS/WhatsApp
  Send->>GHL: POST /conversations/messages
  GHL-->>Send: message ID
  Send->>DB: Upsert outbound message
  Send->>DB: Update conversation metadata
  DB-->>RT: conversation/message change
  RT-->>UI: refresh local UI
  Send-->>UI: success + messageId
```

Channel handling:

- SMS/WhatsApp-style messages use `message` and may require `contactId`;
- email-style messages use `html`, `message`, and optional `subject`;
- outbound messages are persisted locally after GHL accepts them.

## 15. Email reply flow

The Conversations page can send email replies through `send-email-reply` when the selected reply channel is email.

```mermaid
sequenceDiagram
  participant UI as Conversations page
  participant Edge as send-email-reply
  participant Mail as Outlook/email provider
  participant DB as Supabase Postgres

  UI->>Edge: to, subject, body, mailboxSource
  Edge->>DB: Validate staff session and mailbox configuration
  Edge->>Mail: Send email
  Mail-->>Edge: provider result
  Edge->>DB: Optional log/sync/update
  Edge-->>UI: success/error
```

Email sending is separated from GHL message sending. The UI chooses `send-email-reply` for email and `send-ghl-message` for SMS/WhatsApp/GHL-backed channels.

## 16. Webhook communication flow

Several third-party systems call Supabase Edge Functions directly.

```mermaid
flowchart TD
  ThirdParty[External platform]
  Webhook[Webhook Edge Function]
  Verify[Shared secret / service token / in-function auth]
  DB[(Supabase Postgres)]
  Notify[notifications]
  RT[Realtime]
  UI[Browser UI]

  ThirdParty --> Webhook --> Verify
  Verify --> DB
  DB --> Notify
  Notify --> RT --> UI
```

Examples:

| Webhook function | Caller / purpose |
| --- | --- |
| `ghl-webhook-receiver` | GHL contact/lead/event ingestion |
| `vapi-call-webhook` | Vapi call events and call log updates |
| `outlook-email-webhook` | Outlook mailbox sync/change notifications |
| `mission-control-webhook` | billing/payment/token-pack events |
| `auto-report-webhook` | external automation-triggered report generation |
| `pdf-parse-callback` / `pdf-parse-chunk-callback` | PDF parsing sidecar callbacks |

Webhook functions generally keep Supabase gateway JWT verification disabled and validate the caller inside the function using a service token, secret, or custom logic appropriate to that integration.

## 17. Template/PDF parsing and rendering communication flow

```mermaid
sequenceDiagram
  participant UI as Template Builder UI
  participant Dispatch as pdf-parse-dispatch / template-import-pdf
  participant Sidecar as PDF parser/render sidecar
  participant Callback as pdf-parse-callback / chunk callback
  participant DB as Supabase Postgres
  participant Storage as Supabase Storage
  participant Render as render-source / render-template-pdf

  UI->>Dispatch: Upload/import/parse request with session token in body
  Dispatch->>DB: Verify user and create parse/import job
  Dispatch->>Sidecar: Start heavy parse/render work
  Sidecar-->>Callback: Chunk or completion callback with service token
  Callback->>DB: Store parse status/results
  Callback->>Storage: Store generated artifacts if needed
  UI->>Render: Preview/render template or source
  Render->>DB: Load template/report data
  Render->>Storage: Read/write artifacts
  Render-->>UI: rendered output/status
```

Important CORS/auth rule:

- template/PDF import and render functions often receive `session_token` in the request body instead of custom session headers to avoid broken CORS preflights on deployments where custom headers are not allowed.

## 18. Error and retry communication patterns

### 18.1 Browser-side network/auth errors

`invokeSecureFunction` returns normalized errors:

```ts
{ data: null, error: { message: string } }
```

Special cases:

- timeout -> `Request timed out. Please try again.`
- failed fetch/CORS -> diagnostic message naming the function
- 401/403/invalid session -> one-shot token refresh, then retry
- repeated auth failure -> auth circuit breaker trips and stale tokens may be cleared
- 402 insufficient funds -> global out-of-tokens event

### 18.2 Backend data-service failures

The report generator uses fallback wrappers and circuit breakers for data services. Non-critical service failures should be logged and recorded without collapsing the entire report where possible.

### 18.3 Background job failures

Failed background jobs should communicate through:

1. persisted job/report status;
2. `error_message` or equivalent error summary;
3. notification row when user-facing action is required;
4. UI cleanup in `BackgroundJobTracker`.

## 19. Debugging map

| Symptom | Start here | Likely issue |
| --- | --- | --- |
| User redirected to `/auth` | `useAuth.tsx`, `custom-auth-verify` | missing/expired staff `session_token`, stale auth version, failed verify |
| “Authentication required” from Edge Function | `secureInvoke.ts`, `_shared/auth.ts`, function `verify_jwt` config | missing body/header token, wrong auth surface, gateway JWT mismatch |
| CORS `Failed to fetch` on template import | `secureInvoke.ts` body-token list, `supabase/config.toml` function CORS/auth comments | custom header preflight blocked or stale deployment |
| Module page shows permission error | `usePermissions.tsx`, `ModuleGuard.tsx`, `user_permissions`, `dashboard_modules` | missing module permission or inactive module |
| Notifications not appearing | `NotificationsContext.tsx`, `notifications` table, realtime channel | row not inserted, target user mismatch, realtime subscription issue |
| Report job stuck | `BackgroundJobTracker.tsx`, `investment_reports.status`, report Edge Function logs | status not updated, background job not persisted, generation failure not marked |
| GHL conversations stale | `Conversations.tsx`, `sync-ghl-conversations`, GHL credentials | sync not triggered, bad credentials, contact missing `ghl_contact_id` |
| Outbound GHL message fails | `send-ghl-message`, `ghl_conversations`, GHL API response | missing conversation/contact ID, wrong channel payload, GHL credentials |
| Client portal kicks out | `usePortalAuth.tsx`, `client-portal-verify` | missing/expired `portal_session_token` |
| Finance portal kicks out | `useFinancePortalAuth.tsx`, `finance-portal-verify` | expired finance token, failed reverify, redirect guard triggered |
| Airtable listings fail | `airtable.ts`, `propertyDataService.ts`, `airtable-proxy` | Airtable secret/config issue, proxy error, table mismatch |

## 20. Communication extension rules

When adding a new communication path:

1. Decide which route surface owns it: internal, client portal, finance portal, or public.
2. Use the correct token system for that surface.
3. Use direct Supabase browser calls only for browser-safe data.
4. Use Edge Functions for secrets, third-party APIs, service-role reads/writes, webhooks, long jobs, and AI calls.
5. Reuse shared auth helpers for Edge Functions.
6. Add comments in `supabase/config.toml` when `verify_jwt=false` is required.
7. Persist long-running job state in Supabase.
8. Use realtime or polling to communicate status back to the UI.
9. Normalize external IDs into local tables, especially for GHL, Outlook, Vapi, and document pipelines.
10. Update this document whenever the request/response path crosses a new service boundary.

## 21. Quick mental model

```text
User action
  -> route surface auth/session layer
  -> component/page action
  -> direct Supabase call OR invoke helper
  -> Edge Function auth
  -> Supabase database/storage and/or external service
  -> persisted result/status/notification
  -> realtime event or polling refresh
  -> UI updates
```

This is the core communication loop of the NPC Command Centre.
