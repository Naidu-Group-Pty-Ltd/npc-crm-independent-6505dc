# ADR 013: Nested Solicitor layout and query-owned data

- **Status:** Accepted for Phase 12
- **Date:** 2026-07-30

## Decision
A single `SolicitorPortalProtectedRoute` and nested `SolicitorPortalLayout` own session governance, navigation, transport, and realtime invalidation. Pages render through an `Outlet`; no page wraps itself in an authentication boundary.

React Query owns server state through stable `solicitorKeys`. Lists use server-side pagination and debounced search, superseded requests observe cancellation, mutations invalidate exact aggregates, and stale `row_version` responses open a recoverable conflict dialog rather than overwriting newer data.

The matter workspace exposes feature boundaries for overview, parties, milestones, documents, searches, requisitions, disbursements, communications, Finance summary, compliance, contract intelligence, audit, and realtime. Existing mature panels remain intact behind these boundaries while the large legacy page is incrementally decomposed.

Supabase Realtime is an invalidation signal only. Every refreshed record still passes through cookie-authenticated Edge Functions and matter-scoped authorization; subscriptions do not become an alternate data API.
