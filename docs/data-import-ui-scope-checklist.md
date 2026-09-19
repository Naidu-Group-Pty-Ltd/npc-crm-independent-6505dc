# Data Import UI Scope Checklist

## Inspected before UI changes

- Route: `/data-import` is mounted through `ModuleGuard moduleKey="data_import"` in `src/App.tsx`.
- Dashboard token banner: `TokenBalanceBanner` is mounted by `DashboardLayout`; only the `/data-import` visual treatment was adjusted while low-balance logic and Top up behavior remain unchanged.
- Header: Data Import title and subtitle are in `src/pages/DataImport.tsx`.
- Quick Import panel: external source card and `Import Australian Suburb Directory` action are in `src/pages/DataImport.tsx`.
- Upload CSV Data form: Data Type selector, optional State/Territory selector, CSV file input, Upload Data action and result alert are in `src/pages/DataImport.tsx`.
- CSV Format Requirements renderer: all existing data type notes and column strings are in `src/pages/DataImport.tsx`.
- Validation states: invalid file type, missing data type/file and missing state toasts were reviewed and left unchanged.
- Loading states: `uploading` and `importingSuburbs` states were reviewed and left unchanged.
- Success/error states: upload result alert, upload toasts, import toasts and notifications were reviewed and left unchanged.
- API/Supabase calls: `invokeSecureFunction('import-schools-data')`, `invokeSecureFunction('manage-data-import')` and `invokeSecureFunction('import-suburb-directory')` were reviewed and left unchanged.
- External source import logic, CSV parsing, cache mapping, authentication route guard and module permissions were reviewed and left unchanged.

## Touched files

- `src/pages/DataImport.tsx` — UI-only polish, containment and theme-token alignment for the Data Import tab.
- `src/components/billing/TokenBalanceBanner.tsx` — `/data-import`-scoped token warning visual treatment only; token logic and Top up behavior unchanged.
- `docs/data-import-ui-scope-checklist.md` — local developer checklist for this safe-scope pass.

## Intentionally untouched modules

Overview, Listings, Commercial / Industrial, Calendar, Sources, Reports, Generated Reports, Cash Flow Analysis, Report Q&A, Portfolio Reports, Report Requests, Charts, Clients, Client Tracker, CRM Conversations, Portal Messages, Email Copilot, Call Logs, Deal Pipeline, Reminders, Checklists, Agreements, Game Plan, Marketing, User Guide, Token Usage, Automation, Templates, Branding, Integrations, Cloudflare, API Usage, Model Hub, Monitoring, Quality Assurance, Depreciation Comps, Error Logs, Activity Logs, Settings, User Management, Finance Portal, Portal Config, Token Audit Log, PDF Import Engine, PDF Import Diagnostics, BC Segment Engine, Reclassify Property, sidebar grouping, global routes, authentication and permissions.

## Scope lock confirmation

- No CSV parsing logic was changed.
- No external import behavior was changed.
- No API, Supabase, cache-table mapping or cache-write logic was changed.
- No route, authentication or permission logic was changed.
- No mock imported data, fake upload results or artificial cache records were added.

## Phase 9 final QA regression review

- Confirmed `/data-import` remains routed through `ModuleGuard moduleKey="data_import"`; no route, authentication or permission wiring was changed in this QA pass.
- Confirmed the Administration sidebar and mobile sidebar still list `Data Import` at `/data-import` with `moduleKey: 'data_import'`; no sidebar grouping or navigation item was changed.
- Confirmed `TokenBalanceBanner` still renders only when `lowBalance` and `balance` are present, and the `/data-import` branch changes only visual token classes while preserving the `openMissionControl(MISSION_CONTROL_TOPUP_URL)` Top up action.
- Confirmed the Data Import title, subtitle, Quick Import panel, `Import Australian Suburb Directory` action, external-source helper text, Upload CSV Data form, `Select data type...` placeholder, CSV File input, Upload Data action and CSV Format Requirements panel remain present.
- Confirmed the existing `DATA_TYPES` labels and state requirements remain unchanged for Suburb Directory, Schools Directory, ABS Census Cache, Crime Statistics Cache, Economic Data (National), Transport Data Cache, Risk Assessment Cache, Climate Data Cache and Median Rent Cache.
- Confirmed manual upload readiness still depends on the selected data type, required state selection where applicable and CSV file presence; validation toasts for wrong file type, missing data type/file and missing state remain unchanged.
- Confirmed the external suburb import still calls `invokeSecureFunction('import-suburb-directory')`; schools upload still calls `invokeSecureFunction('import-schools-data')`; other cache uploads still call `invokeSecureFunction('manage-data-import')`.
- Confirmed no mock data, fake imported rows, fake success results or artificial cache records were introduced.
- Confirmed visible long text, selected file names, helper text and CSV column strings continue to use containment classes such as `min-w-0`, `break-words`, `truncate`, `overflow-x-auto` and responsive stacking.
- Confirmed the final QA pass made no code changes to CSV parsing, validation rules, cache mappings, external import logic, upload logic, Supabase/API calls, route logic, authentication logic, permission logic or unrelated pages.
