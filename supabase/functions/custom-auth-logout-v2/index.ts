/**
 * Command Centre staff logout — the current entrypoint.
 *
 * The handler is `_shared/customAuth/logout.ts`, shared with the other entrypoint
 * for this operation. Both URLs are deployed and both mint or consume a staff
 * session; only one of them used to have source here, and the one that did not
 * stopped receiving every hardening the other got. See
 * `docs/security/WP28_CUSTOM_AUTH_V1.md`.
 *
 * Keep this file a shim. Anything added here is by definition something the
 * other entrypoint does not do.
 */
import { handleStaffLogout } from '../_shared/customAuth/logout.ts';

Deno.serve((req: Request) => handleStaffLogout(req, 'v2'));
