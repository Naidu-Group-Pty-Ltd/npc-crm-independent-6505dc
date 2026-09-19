# Integrations Phase 1 Audit: Foundation, Theme Alignment, and Security Baseline

## Scope confirmation

This audit is intentionally scoped to the Administration Integrations tab/page only. Phase 1 records the current implementation map and security baseline before any visual enhancement work begins. No backend, API, Supabase, credential storage, encryption, authentication, permission, route, filtering, validation, sync, or unrelated dashboard logic is changed by this audit.

## Theme source inspected

`docs/dashboard-theme-foundation.md` was found and inspected before Integrations implementation work. The foundation directs dashboard UI changes to use global CSS variables, Tailwind token classes, and shared `DashboardThemeFrame` variants before introducing page-local styling.

Key theme anchors to preserve for later phases:

- Base and text tokens: `--background`, `--foreground`, `bg-background`, `text-foreground`.
- Card and panel surfaces: `--card`, `--dashboard-surface`, `--surface-1`, `bg-card`.
- Form, border, and muted treatment: `--border`, `--muted`, `border-border`, `text-muted-foreground`.
- Brand/gold accents and selected states: `--primary`, `text-primary`, `bg-primary`, `bg-primary/10`, `border-primary/*`.
- Status colours should stay semantic: success/connected via green or theme success tokens, warning/pending via amber/gold or warning tokens, destructive/error via red/destructive tokens, passive/not configured via neutral muted tokens.
- Buttons, badges, focus rings, hover states, radii, shadows, and scrollbars should continue to compose existing shadcn primitives, Tailwind token utilities, dashboard CSS variables, and `DashboardThemeFrame` where suitable.

## Current Integrations implementation inventory

Primary page component:

- `src/pages/Integrations.tsx` exports the Integrations page and owns the header, Sync Status action, status tabs, configured/pending filters, credential card rendering, credential state, saving state, Supabase secret sync state, loading state, and setup-required alert.

Roadmap component:

- `src/components/integrations/PlannedIntegrations.tsx` owns the Roadmap tab content and planned provider cards.

Integration data preserved in the page:

- Airtable: API Key and Base ID fields; Airtable docs link.
- Vapi: API Key field; Vapi docs link.
- GoHighLevel: API Key and Location ID fields; GoHighLevel docs link.
- OpenAI: API Key field; OpenAI docs link.
- Perplexity: API Key field; Perplexity docs link.
- Anthropic Claude: API Key field; Anthropic docs link.
- Google Gemini (Native): API Key field; Gemini docs link.
- OpenRouter: API Key field; OpenRouter docs link.
- Twilio: Account SID and Auth Token fields; Twilio docs link.
- Microsoft / Outlook: Client ID, Client Secret, and Tenant ID fields; Microsoft Graph docs link.
- Make.com: Webhook URL field; Make docs link.
- Cloudflare: API Token, Zone ID, and Account ID fields; Cloudflare docs link.

Visible workflow surfaces identified:

- Header title: `Integrations`.
- Header subtitle: `Configure API keys and credentials for external services`.
- Header action: `Sync Status`, wired to `checkSupabaseSecrets`.
- Status tabs: `All`, `Configured`, `Pending`, and `Roadmap`; the Roadmap trigger uses the current internal value `planned`.
- Integration card grid: rendered separately for All, Configured, and Pending tab content.
- Card header: service icon, service name, description, integration status badge, and optional Supabase secret badge.
- Credential form rows: label, required marker where applicable, controlled input value, and password reveal/hide button for secret fields.
- Secondary actions: `Docs` link and upload/import-style Supabase sync button.
- Primary action: per-card `Save` button.
- Loading state: centered spinner while integration configs are loading.
- Empty state: Configured tab empty message when no integrations are fully configured.
- Alert state: setup-required Supabase access token alert.
- Toast feedback: configuration saved, save error, no values to sync, setup required, Supabase sync success, and sync failure.

## Data, credential, and permission flows identified

Data loading:

- `loadIntegrationConfigs` calls `invokeSecureFunction('manage-templates', { operation: 'list', table: 'integration_configs' })` and loads returned `key_name` / `key_value` pairs into local controlled state.
- Non-empty loaded values populate `savedKeys`, which drives configured/partial/not-configured status.

Credential editing:

- `handleValueChange` updates local `values` state only.
- Inputs are controlled from `values[field.key] || ''`.

Secret masking and reveal:

- Secret fields are defined with `type: 'password'` in the integration metadata.
- Password fields render as `type="password"` unless the existing `showPasswords[field.key]` flag is true.
- `togglePasswordVisibility` only flips the local reveal state for that field.

Saving:

- `saveIntegration` iterates the current integration fields and calls `invokeSecureFunction('manage-templates', { operation: 'upsert', table: 'integration_configs', data: { key_name, key_value, integration_id, updated_at }, onConflict: 'key_name' })`.
- Save completion updates `savedKeys` according to whether each submitted value is non-empty.
- The Save button is disabled while saving, while syncing that integration, or when `useModulePermissions('integrations')` reports `canEdit` as false.

Supabase secret status and sync:

- `checkSupabaseSecrets` calls `invokeSecureFunction('check-integration-secrets', {})` and stores returned per-integration status in `supabaseSecrets`.
- `syncToSupabase` collects non-empty field values for the selected integration, maps frontend field keys through `getSupabaseSecretName`, and calls `invokeSecureFunction('update-integration-secret', { secrets })`.
- `getSupabaseSecretName` currently maps `AIRTABLE_API_KEY` to `AIRTABLE_TOKEN`, `GHL_API_KEY` to `GOHIGHLEVEL_API_KEY`, and `GHL_LOCATION_ID` to `GOHIGHLEVEL_LOCATION_ID`; other field names pass through unchanged.
- After a successful sync, `checkSupabaseSecrets` refreshes status.

Status filtering:

- `getIntegrationStatus` derives `not_configured`, `configured`, or `partial` from required fields and `savedKeys`.
- All tab renders every integration in declared order.
- Configured tab filters to integrations with status `configured`.
- Pending tab filters to integrations whose status is not `configured`.
- Roadmap tab renders `PlannedIntegrations`.

Permissions:

- The page calls `useModulePermissions('integrations')`.
- `canEditIntegrations` gates the Save button disabled state.

## Security baseline

The following security requirements are preserved as the baseline for later UI phases:

- Secrets are masked by default for all fields whose metadata type is `password`.
- The existing reveal/hide behaviour is local UI state only and is not replaced or recalculated.
- Credential save and sync calls continue to use `invokeSecureFunction`; this audit does not alter request payload shape, table names, key mapping, edge function names, or auth boundaries.
- The audit does not change storage, encryption, Supabase, authentication, permission, environment-variable mapping, validation, route, or database schema logic.
- No mock credentials, fake configured states, fake providers, fake roadmap entries, or fake success states are introduced.
- Existing console logging currently logs generic operation failures and error objects, not explicit credential values from form state. Later phases must not add credentials to console logs, URLs, analytics, tooltips, or error text.
- Existing Supabase status tooltips display configured and missing secret names only, not secret values.
- Existing success and error toast descriptions do not echo credential values.

## Phase 1 notes for later implementation phases

- The current page uses tokenized shadcn primitives (`Card`, `Input`, `Button`, `Badge`, `Tabs`, `Alert`, `Tooltip`) and existing theme classes such as `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-primary`, `bg-primary/10`, and `text-destructive`; later visual work should build on these rather than creating a disconnected theme.
- The Integrations page currently duplicates the card markup across All, Configured, and Pending tabs. Later UI phases can improve visual consistency either by carefully extracting a presentational card renderer or by applying identical tokenized class changes in-place, as long as field data, labels, values, handlers, and status/filtering logic remain unchanged.
- Later phases should prioritize containment on the card header flex rows, long descriptions, long provider names, action rows, long URL inputs, and tab overflow while preserving all current behaviours.
