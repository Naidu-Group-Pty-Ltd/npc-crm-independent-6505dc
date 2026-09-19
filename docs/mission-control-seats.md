# Mission Control — Seat Entitlement Integration

Aurixa Mission Control owns the seat cap for this clone. Every invite reserves
a seat, every accepted invite commits it, and every user delete/purge releases
it. The clone never decides the limit itself — it asks MC.

## Where the key lives

Same place as the token integration:

- Supabase secret **`MISSION_CONTROL_CLONE_API_KEY`** (encrypted, project-level,
  never returned to the browser, never logged).
- Base URL: `MISSION_CONTROL_URL`.
- Webhook secret: `MISSION_CONTROL_WEBHOOK_SECRET`.

The key must have the **`seats:manage`** scope in addition to `tokens:meter`
and `clones:rotate`. Auto-provisioned keys from MC already include this scope.

## Endpoints

| Method | Path                              | Module function          |
| -----: | --------------------------------- | ------------------------ |
|  POST  | `/api/public/seats/reserve`       | `reserveSeat()`          |
|  POST  | `/api/public/seats/commit`        | `commitSeat()`           |
|  POST  | `/api/public/seats/release`       | `releaseSeat()`          |
|   GET  | `/api/public/seats/entitlement`   | `getSeatEntitlement()`   |
|   GET  | `/api/public/seats/list`          | `listSeats()`            |

All live in `supabase/functions/_shared/missionControlSeats.ts`. Use that module
— do not call MC directly from any other edge function.

### Error envelope

- `HTTP 402` + `{ error: "seat_limit_reached", seat_limit, seats_used, plan }`
  → surface "Seat limit reached — upgrade to add more team members" and **do
  not retry**. `reserveSeat()` returns this as a structured result, not a
  throw, so callers can branch cleanly.
- `HTTP 429` → one automatic retry honouring `Retry-After`.
- `HTTP 5xx` → one automatic retry with a 500 ms back-off.
- `releaseSeat()` treats `not_found` / 404 as success (idempotent).

## Signup integration

Implemented in `supabase/functions/admin-user-management/index.ts`:

1. **`send_invite`** — reserves a seat **before** persisting the invite row.
   - Idempotency key = the invite token (auto-generated UUID). A retried
     request reuses the existing reservation, so a double-click never burns
     two seats.
   - On `seat_limit_reached` → returns HTTP 402 with a friendly message; no
     invite row is created.
   - If the invite insert later fails, the reservation is rolled back via
     `releaseSeat`.
   - The returned `seat_id` is stored on the invite row as `mc_seat_id`.

2. **`accept_invite`** — after the `custom_users` row is created, calls
   `commitSeat(invite.mc_seat_id)` to convert the reservation into an active
   seat. Failure to commit is logged but does not block the user creation
   (MC will reconcile on next list).

3. **`delete_user` (soft) and `purge_user` (hard)** — call
   `releaseSeat(email, reason)` after the local mutation succeeds. Safe to
   call multiple times.

## Settings UI

`Settings → Plan & Seats` (`src/components/settings/SeatEntitlementCard.tsx`)
shows:

- Plan name + slug, with a **Manage plan** link to MC billing.
- Progress bar `seats_used / seat_limit` plus remaining count.
- "Approaching limit" banner at ≥80%, "limit reached" banner at 100%.
- List of active seats (display name / email, status badge, age).

It calls the **`mission-control-seats`** edge function, which is superadmin-only
and proxies `getSeatEntitlement()` + `listSeats()` so the API key never leaves
the server.

## Webhook events

Extends `mission-control-webhook` (signature already verified). Handlers:

| Event | What we do |
|------|-----------|
| `seats.reserved`, `seats.committed`, `seats.released` | Audit row in `token_audit_log`. |
| `seats.limit.approaching` | Insert `system_alerts` row (severity `warning`). |
| `seats.limit.reached` | Insert `system_alerts` row (severity `critical`). The Settings card surfaces the same status via the entitlement endpoint, so banner appears immediately on next refresh. |
| `seats.plan.changed` | Insert `system_alerts` row (severity `info`); the entitlement card re-fetches on next mount/refresh. |

`system_alerts` is a small superadmin-only table created by the migration. RLS
only allows superadmins to read it; the service role manages writes from the
webhook handler.

## Acceptance checks

1. **Cap enforcement** — `send_invite` against a full tenant returns HTTP 402
   with `error: "seat_limit_reached"`, message containing plan + counts, and
   no invite row is inserted.
2. **Free on delete** — `delete_user` (soft) or `purge_user` (hard) decrements
   `seats_used` on MC; the Settings card reflects it on refresh.
3. **Plan upgrade in MC** — increasing the cap on the MC side is reflected
   without redeploying this clone; the next entitlement call returns the new
   `seat_limit`.
4. **Race on last seat** — two simultaneous `send_invite` calls race; MC's
   reserve endpoint guarantees exactly one wins; the loser returns 402.
5. **Idempotency** — same invite token retried returns the same `seat_id`;
   total seat count is unchanged.

## Local debug

A superadmin can hit the seats edge function from the browser console:

```js
await (await import('/src/lib/secureInvoke.ts')).invokeSecureFunction(
  'mission-control-seats',
  { include_list: true, status: 'active' },
);
```

The same call powers the Plan & Seats card.
