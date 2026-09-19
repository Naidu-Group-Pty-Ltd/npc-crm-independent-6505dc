# Mission Control Device Cap Integration

Mission Control enforces a per-seat **device limit** (Starter 2 / Growth 3 / Pro 5 / Enterprise 10). This clone wires the cap into the existing auth flow.

## Flow

1. **Sign-in** (`useAuth.signIn`): after `custom-auth-login` succeeds, tokens are stored but `user`/`roles` are NOT set yet. We call `registerCurrentDevice()` which proxies `POST /api/public/seats/devices/register` through the `mission-control-devices` edge function.
2. On success → device id stored in storage, `user`/`roles` set, login completes.
3. On 402 `device_limit_reached` → `<ManageDevicesDialog>` opens listing active devices. User revokes one → `retryDeviceRegistration()` runs register again. If the user closes the dialog → `cancelPendingSession()` logs out the orphan tokens.
4. **Heartbeat**: AuthProvider runs `heartbeatCurrentDevice()` every 5 minutes while signed in.
5. **Sign-out**: `releaseCurrentDevice()` runs before `custom-auth-logout`.
6. **User delete / purge** (`admin-user-management`): `releaseDevice({ externalUserId: user_id })` releases **all** of that user's slots.

## Files

- `src/lib/deviceFingerprint.ts` — stable per-browser fingerprint + device id storage.
- `src/lib/deviceSession.ts` — frontend client (`registerCurrentDevice`, `heartbeatCurrentDevice`, `releaseCurrentDevice`, `listMyDevices`, `revokeDevice`).
- `src/components/auth/ManageDevicesDialog.tsx` — revoke-a-device modal shown on 402.
- `src/hooks/useAuth.tsx` — `signIn`, pending-session ref, `retryDeviceRegistration`, `cancelPendingSession`, heartbeat interval.
- `supabase/functions/_shared/missionControlDevices.ts` — MC API client (uses `MISSION_CONTROL_URL` + `MISSION_CONTROL_CLONE_API_KEY`).
- `supabase/functions/mission-control-devices/index.ts` — authenticated proxy with actions: `register`, `heartbeat`, `release`, `list`, `revoke`. Superadmin may target another user via `external_user_id`.
- `supabase/functions/admin-user-management/index.ts` — releases device slots on `delete_user` and `purge_user`.
- `supabase/functions/mission-control-webhook/index.ts` — handles `devices.registered`, `devices.released`, `devices.limit.reached` (writes `system_alerts` + `token_audit_log`).

## Identifiers

- `external_user_id` for devices = prime `auth.userId` (UUID) — distinct from seats which use email.
- Fingerprint is stored in `localStorage` under `aurixa.device.fp`; device id under `aurixa.device.id` (session + local).

## Webhook events

- `devices.registered` `{ device_id, external_user_id, devices_active }`
- `devices.released` `{ device_id }`
- `devices.limit.reached` `{ external_user_id, devices_active, device_limit }` → recorded in `system_alerts` as `warning`.

Same HMAC-SHA256 signature scheme as `seats.*` and `tokens.*`.
