# Phase 12 — Solicitor frontend architecture and usability

## Delivered
- One nested authenticated layout with governance routes outside the protected workspace chrome.
- Stable React Query keys, typed request errors, server-side matter pagination, debounced search, cancellation awareness, and mutation invalidation.
- Recoverable stale-write dialog preserving the user's draft until they choose to reload.
- Matter feature-module boundaries and controlled realtime invalidation for access, notifications, canonical messages, and shared tasks.
- Responsive, keyboard-labelled navigation and actionable empty/error states.

## Rollout
No schema changes. Existing session, feature flags, matter authorization, and Edge Function transport remain authoritative. Realtime only invalidates governed queries.
