import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { hashPassword, verifyPassword } from "../_shared/password.ts";
import { validatePasswordStrength } from "../_shared/passwordValidation.ts";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createSessionCookie, extractSessionToken } from "../_shared/auth.ts";
import { isSessionUsable, resolveUserSessionRow } from "../_shared/sessionHash.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { rotateSession } from "../_shared/sessionRotate.ts";
import { requireStepUp } from "../_shared/stepUp.ts";
import { getBrandConfig } from "../_shared/brand-config.ts";
import { reserveSeat, commitSeat, releaseSeat } from "../_shared/missionControlSeats.ts";
import { releaseDevice } from "../_shared/missionControlDevices.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

interface RequestBody {
  action: 'list_users' | 'get_user' | 'create_user' | 'update_user' | 'delete_user' | 
          'assign_role' | 'remove_role' | 'update_permissions' | 'send_invite' |
          'list_modules' | 'get_user_permissions' | 'get_my_permissions' | 'set_aml_roles' | 'promote_to_superadmin' | 'demote_from_superadmin' |
          'accept_invite' | 'verify_invite' | 'update_mailbox' | 'get_own_profile' |
          'update_own_profile' |
          'update_own_mailbox' | 'update_own_signature' | 'create_subadmin' | 'update_own_credentials' |
          'reset_user_password' | 'purge_user' | 'force_logout';
  new_username?: string;
  current_password?: string;
  new_password?: string;
  session_token: string;
  user_id?: string;
  role?: 'superadmin' | 'admin' | 'user';
  aml_roles?: Array<'analyst' | 'reviewer' | 'mlro' | 'auditor'>;
  permissions?: Array<{ module_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>;
  invite_data?: {
    email: string;
    username?: string;
    invite_type: 'magic_link' | 'temp_password';
    permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>;
  };
  subadmin_data?: {
    username: string;
    password: string;
    email?: string;
    personal_mailbox?: string;
    permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>;
  };
  token?: string;
  password?: string;
  personal_mailbox?: string;
  email_signature?: string;
  // Self-service contact details (update_own_profile). Display + Stripe
  // billing prefill only — never consulted for authentication.
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  include_deleted?: boolean;
  restore?: boolean;
  idempotency_key?: string;
}

const AML_ROLES = new Set(['analyst', 'reviewer', 'mlro', 'auditor']);

// Helper to verify authentication and check if user is superadmin
async function verifySuperadmin(supabase: any, headers: Headers, body: any) {
  // First verify authentication (JWT or session token)
  const authResult = await verifyAuth(supabase, headers, body);
  if (authResult.error || !authResult.userId) {
    return { error: authResult.error || 'Authentication required', user: null };
  }

  // Check if user has superadmin role. Support both the canonical user_roles
  // record and the legacy/custom_users super_admin marker so command-centre
  // superadmins never get blocked by missing granular RBAC rows.
  const { data: currentUser, error: userError } = await supabase
    .from('custom_users')
    .select('*')
    .eq('id', authResult.userId)
    .maybeSingle();

  if (userError || !currentUser?.is_active) {
    return { error: 'Unauthorized: Active user required', user: null };
  }

  const { data: roleData, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', authResult.userId)
    .eq('role', 'superadmin')
    .maybeSingle();

  if (currentUser.role !== 'super_admin' && (roleError || !roleData)) {
    return { error: 'Unauthorized: Superadmin access required', user: null };
  }

  return { error: null, user: currentUser };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for header-only (no-cookie) callers.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body: RequestBody = await req.json();
    const { action, session_token } = body;

    // Actions that don't require superadmin auth
    if (action === 'verify_invite') {
      const { token } = body;
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'Token required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: invite, error } = await supabase
        .from('permission_invite_tokens')
        .select('*, invited_by_user:custom_users!permission_invite_tokens_invited_by_fkey(username)')
        .eq('token', token)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error || !invite) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid or expired invite' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          invite: {
            email: invite.email,
            username: invite.username,
            invite_type: invite.invite_type,
            permissions: invite.permissions,
            invited_by: invite.invited_by_user?.username
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'accept_invite') {
      const { token, password } = body;
      if (!token) {
        return new Response(
          JSON.stringify({ success: false, error: 'Token required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: invite, error: inviteError } = await supabase
        .from('permission_invite_tokens')
        .select('*')
        .eq('token', token)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (inviteError || !invite) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid or expired invite' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Determine password
      let finalPassword = password;
      if (invite.invite_type === 'temp_password' && !password) {
        finalPassword = invite.temporary_password;
      }
      if (!finalPassword) {
        return new Response(
          JSON.stringify({ success: false, error: 'Password is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Validate password strength (skip for temp passwords as they are system-generated)
      if (invite.invite_type !== 'temp_password') {
        const validation = await validatePasswordStrength(finalPassword);
        if (!validation.isValid) {
          return new Response(
            JSON.stringify({ success: false, error: validation.error }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Create user
      const username = invite.username || invite.email.split('@')[0];
      
      // Hash the password before storing
      const hashedPassword = await hashPassword(finalPassword);
      
      const { data: newUser, error: userError } = await supabase
        .from('custom_users')
        .insert({
          username,
          email: invite.email,
          password_hash: hashedPassword,
          role: 'sub_admin', // All invited users are sub_admins
          is_active: true,
        })
        .select()
        .single();

      if (userError) {
        console.error('Failed to create user:', userError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create user. Username may already exist.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Assign admin role in user_roles table (keeps compatibility, but they're still sub_admin tier)
      await supabase
        .from('user_roles')
        .insert({ user_id: newUser.id, role: 'admin' });

      // Assign permissions
      const permissions = invite.permissions as Array<{ module_key: string; can_view: boolean; can_edit: boolean; can_delete: boolean }>;
      
      for (const perm of permissions) {
        const { data: module } = await supabase
          .from('dashboard_modules')
          .select('id')
          .eq('module_key', perm.module_key)
          .single();

        if (module) {
          await supabase
            .from('user_permissions')
            .insert({
              user_id: newUser.id,
              module_id: module.id,
              can_view: perm.can_view,
              can_edit: perm.can_edit,
              can_delete: perm.can_delete,
              granted_by: invite.invited_by,
            });
        }
      }

      // Mission Control: commit the seat reservation tied to this invite.
      try {
        if (invite.mc_seat_id) {
          const commit = await commitSeat(invite.mc_seat_id);
          if (!commit.ok) {
            console.warn(`[seat] commit failed for invite ${invite.id}: ${commit.error}`);
          }
        }
      } catch (e) {
        console.warn('[seat] commit threw', e);
      }

      // Mark invite as used
      await supabase
        .from('permission_invite_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', invite.id);

      console.log(`User ${username} created via invite`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Account created successfully',
          username
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Helper to verify any authenticated user (not just superadmin).
    // Returns the active session id so callers can rotate it on privilege
    // elevation (WP-11B/C Phase 3).
    const verifySession = async (sessionToken?: string | null) => {
      // The browser can no longer read its own session: the Command Centre
      // session lives in an HttpOnly cookie, so `body.session_token` is
      // undefined for every self-service call and this used to fail with
      // "Session token required". Fall back to the cookie/header carrier.
      const token = (sessionToken && sessionToken.trim())
        ? sessionToken.trim()
        : (extractSessionToken(req.headers, body) ?? '');

      if (!token) {
        return { error: 'Session token required', user: null, sessionId: null };
      }

      // Hash-first lookup (plaintext fallback) so hash-only sessions resolve.
      const session = await resolveUserSessionRow(
        supabase,
        token,
        'id, user_id, expires_at, revoked_at, idle_expires_at',
        (q: any) => q.gt('expires_at', new Date().toISOString()).is('revoked_at', null),
      );


      if (!session || !isSessionUsable(session).ok) {
        return { error: 'Invalid or expired session', user: null, sessionId: null };
      }

      const { data: user } = await supabase
        .from('custom_users')
        .select('*')
        .eq('id', session.user_id)
        .single();

      return { error: null, user, sessionId: session.id as string };
    };

    // WP-11B/C Phase 3: revoke every active session belonging to the target
    // user so a privilege change forces a fresh login with the new grants.
    const revokeUserSessions = async (targetUserId: string, reason: string) => {
      try {
        await supabase
          .from('user_sessions')
          .update({ revoked_at: new Date().toISOString(), revocation_reason: reason })
          .eq('user_id', targetUserId)
          .is('revoked_at', null);
      } catch (e) {
        console.warn('[admin-user-management] revokeUserSessions failed:', (e as Error).message);
      }
    };

    // Actions that require authentication but NOT superadmin
    if (action === 'get_my_permissions') {
      const authResult = await verifyAuth(supabase, req.headers, body);
      if (authResult.error || !authResult.userId) {
        return new Response(
          JSON.stringify({ success: false, error: authResult.error || 'Authentication required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: currentUser } = await supabase
        .from('custom_users')
        .select('id, role, is_active')
        .eq('id', authResult.userId)
        .maybeSingle();

      if (!currentUser?.is_active) {
        return new Response(
          JSON.stringify({ success: false, error: 'Inactive or missing user' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authResult.userId);

      const roleList = (roleRows ?? []).map((row: any) => row.role);
      const isCurrentSuperadmin = currentUser.role === 'super_admin' || roleList.includes('superadmin');

      if (isCurrentSuperadmin) {
        const { data: modules, error: modulesError } = await supabase
          .from('dashboard_modules')
          .select('module_key, module_name')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (modulesError) {
          return new Response(
            JSON.stringify({ success: false, error: modulesError.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            permissions: (modules ?? []).map((module: any) => ({
              module_key: module.module_key,
              module_name: module.module_name,
              can_view: true,
              can_edit: true,
              can_delete: true,
            })),
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: permissions, error: permissionsError } = await supabase
        .from('user_permissions')
        .select(`
          can_view,
          can_edit,
          can_delete,
          dashboard_modules(module_key, module_name)
        `)
        .eq('user_id', authResult.userId);

      if (permissionsError) {
        return new Response(
          JSON.stringify({ success: false, error: permissionsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          permissions: (permissions ?? [])
            .map((permission: any) => ({
              module_key: permission.dashboard_modules?.module_key || '',
              module_name: permission.dashboard_modules?.module_name || '',
              can_view: Boolean(permission.can_view),
              can_edit: Boolean(permission.can_edit),
              can_delete: Boolean(permission.can_delete),
            }))
            .filter((permission: any) => permission.module_key),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_own_profile') {
      const { error: sessionError, user: currentUser } = await verifySession(session_token);
      if (sessionError || !currentUser) {
        return new Response(
          JSON.stringify({ success: false, error: sessionError || 'Not authenticated' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          user: {
            id: currentUser.id,
            username: currentUser.username,
            email: currentUser.email,
            first_name: currentUser.first_name ?? null,
            last_name: currentUser.last_name ?? null,
            phone: currentUser.phone ?? null,
            personal_mailbox: currentUser.personal_mailbox,
            email_signature: currentUser.email_signature || '',
            role: currentUser.role,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Self-service contact details. These feed the Stripe billing prefill (the
    // command center forwards them on the Mission Control handoff), so they are
    // deliberately editable by the user themselves rather than admin-only —
    // nothing here grants any permission.
    if (action === 'update_own_profile') {
      const { error: sessionError, user: currentUser } = await verifySession(session_token);
      if (sessionError || !currentUser) {
        return new Response(
          JSON.stringify({ success: false, error: sessionError || 'Not authenticated' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Empty string clears the field; omitting a key leaves it untouched.
      const text = (value: unknown, max: number): string | null | undefined => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim().slice(0, max);
        return trimmed === '' ? null : trimmed;
      };

      const updates: Record<string, any> = {};
      const firstName = text(body.first_name, 100);
      const lastName = text(body.last_name, 100);
      const phone = text(body.phone, 40);
      if (firstName !== undefined) updates.first_name = firstName;
      if (lastName !== undefined) updates.last_name = lastName;
      if (phone !== undefined) updates.phone = phone;

      if (Object.keys(updates).length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No profile fields supplied' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      updates.updated_at = new Date().toISOString();

      const { data: updated, error } = await supabase
        .from('custom_users')
        .update(updates)
        .eq('id', currentUser.id)
        .select('id, username, email, first_name, last_name, phone')
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`User ${currentUser.username} updated their contact details`);
      return new Response(
        JSON.stringify({ success: true, user: updated }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_own_signature') {
      const { error: sessionError, user: currentUser } = await verifySession(session_token);
      if (sessionError || !currentUser) {
        return new Response(
          JSON.stringify({ success: false, error: sessionError || 'Not authenticated' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { email_signature } = body;

      const { error } = await supabase
        .from('custom_users')
        .update({ 
          email_signature: email_signature || null,
          updated_at: new Date().toISOString() 
        })
        .eq('id', currentUser.id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`User ${currentUser.username} updated their email signature`);
      return new Response(
        JSON.stringify({ success: true, message: 'Email signature updated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_own_mailbox') {
      const { error: sessionError, user: currentUser } = await verifySession(session_token);
      if (sessionError || !currentUser) {
        return new Response(
          JSON.stringify({ success: false, error: sessionError || 'Not authenticated' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { personal_mailbox } = body;

      // SECURITY: a user can only bind their own account email as their
      // personal Microsoft mailbox. Otherwise any authenticated user could
      // point the shared app-only Graph token at another tenant user's
      // mailbox and read their email. Superadmins may set on behalf of others
      // via the `update_mailbox` action, not this one.
      const requested = (personal_mailbox || '').trim();
      if (requested) {
        const own = (currentUser.email || '').trim().toLowerCase();
        if (!own) {
          return new Response(
            JSON.stringify({ success: false, error: 'Your account has no email on file — contact an administrator.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        if (requested.toLowerCase() !== own && currentUser.role !== 'superadmin') {
          console.log(`[admin-user-management] Rejected update_own_mailbox for ${currentUser.username}: attempted to bind ${requested} (own=${own})`);
          return new Response(
            JSON.stringify({
              success: false,
              error: `You can only connect your own mailbox (${currentUser.email}). Ask a superadmin to link a different address on your behalf.`,
            }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      const { error } = await supabase
        .from('custom_users')
        .update({ 
          personal_mailbox: requested || null,
          updated_at: new Date().toISOString() 
        })
        .eq('id', currentUser.id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`User ${currentUser.username} updated their own mailbox`);
      return new Response(
        JSON.stringify({ success: true, message: 'Mailbox updated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update own credentials (username and/or password)
    if (action === 'update_own_credentials') {
      // Credential changes and the replacement cookie must be bound to the
      // HttpOnly session presented by this browser, never a token selected in
      // the JSON body. Verify it independently because verifyAuth prefers a
      // valid Bearer JWT when the browser sends both credentials; the identity
      // match below binds that JWT to the cookie session.
      const authResult = await verifyAuth(supabase, req.headers, body);
      const cookieSessionToken = extractSessionToken(req.headers, body);
      const sessionResult = await verifySession(cookieSessionToken ?? '');
      const { error: sessionError, user: currentUser, sessionId: currentSessionId } = sessionResult;
      if (
        authResult.error ||
        !authResult.userId ||
        sessionError ||
        !currentUser ||
        currentUser.id !== authResult.userId
      ) {
        return new Response(
          JSON.stringify({ success: false, error: authResult.error || sessionError || 'Not authenticated' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { new_username, current_password, new_password } = body;
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };

      // Handle username update
      if (new_username && new_username !== currentUser.username) {
        if (typeof new_username !== 'string' || new_username.length > 100) {
          return new Response(
            JSON.stringify({ success: false, error: 'Username must be no more than 100 characters' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const normalizedUsername = new_username.trim();
        if (normalizedUsername.length < 3) {
          return new Response(
            JSON.stringify({ success: false, error: 'Username must be at least 3 characters' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if username already exists
        const { data: existingUser } = await supabase
          .from('custom_users')
          .select('id')
          .eq('username', normalizedUsername)
          .neq('id', currentUser.id)
          .single();

        if (existingUser) {
          return new Response(
            JSON.stringify({ success: false, error: 'Username already taken' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        updates.username = normalizedUsername;
      }

      // Handle password update
      if (new_password) {
        if (!current_password) {
          return new Response(
            JSON.stringify({ success: false, error: 'Current password is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify current password using bcrypt
        const isValidPassword = await verifyPassword(current_password, currentUser.password_hash);
        if (!isValidPassword) {
          return new Response(
            JSON.stringify({ success: false, error: 'Current password is incorrect' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate password strength
        const validation = await validatePasswordStrength(new_password);
        if (!validation.isValid) {
          return new Response(
            JSON.stringify({ success: false, error: validation.error }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Hash the new password before storing, and release any lockout —
        // `finance-portal-change-password` already does this, and a lock left
        // standing here would refuse the password the caller just chose.
        updates.password_hash = await hashPassword(new_password);
        updates.failed_login_attempts = 0;
        updates.locked_until = null;
      }

      // Only proceed if there are actual updates
      if (Object.keys(updates).length === 1) { // Only updated_at
        return new Response(
          JSON.stringify({ success: false, error: 'No changes to update' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('custom_users')
        .update(updates)
        .eq('id', currentUser.id);

      if (error) {
        console.error('Failed to update credentials:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const changedFields = [];
      if (updates.username) changedFields.push('username');
      if (updates.password_hash) changedFields.push('password');

      // WP-11B/C Phase 3: rotate the caller's session after a password change
      // so the old cookie cannot be replayed. Username changes alone do not
      // cross a privilege boundary and skip rotation.
      const responseHeaders: Record<string, string> = { ...corsHeaders, 'Content-Type': 'application/json' };
      if (updates.password_hash && currentSessionId) {
        const rot = await rotateSession(supabase, currentSessionId, 'password_change');
        if (rot.ok && rot.newSessionToken && rot.expiresAt) {
          responseHeaders['Set-Cookie'] = createSessionCookie(rot.newSessionToken, rot.expiresAt);
        } else {
          console.warn('[admin-user-management] session rotation failed:', rot.error);
        }
      }

      console.log(`User ${currentUser.username} updated their credentials: ${changedFields.join(', ')}`);
      return new Response(
        JSON.stringify({
          success: true,
          message: `Updated: ${changedFields.join(', ')}`,
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    // All other actions require superadmin
    const { error: authError, user: adminUser } = await verifySuperadmin(supabase, req.headers, body);
    if (authError) {
      return new Response(
        JSON.stringify({ success: false, error: authError }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-11C — Require recent reauth for role/permission mutations.
    const ROLE_MUTATION_ACTIONS = new Set([
      'assign_role', 'remove_role', 'set_aml_roles',
      'promote_to_superadmin', 'demote_from_superadmin', 'update_permissions',
      'create_subadmin', 'send_invite',
    ]);
    if (ROLE_MUTATION_ACTIONS.has(action)) {
      const stepUpCap = action === 'set_aml_roles' ? 'aml.role.set'
        : action === 'remove_role' ? 'role.remove'
        : 'role.change';
      const gate = await requireStepUp(supabase, {
        userId: adminUser.id,
        capability: stepUpCap,
        req,
        body,
        logAudit: true,
      });
      if (gate) return gate;
    }


    if (action === 'list_users') {
      const includeDeleted = (body as any).include_deleted === true;
      let query = supabase
        .from('custom_users')
        .select(`
          id, username, email, role, is_active, created_at, updated_at, personal_mailbox, last_login_at, deleted_at,
          user_roles(role)
        `);
      
      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }
      
      const { data: users, error } = await query.order('created_at', { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const userIds = (users ?? []).map((entry: any) => entry.id).filter(Boolean);
      let usersWithAmlRoles = users ?? [];

      if (userIds.length > 0) {
        const { data: amlRoleRows, error: amlRoleError } = await supabase.rpc('get_aml_roles_for_users', {
          _user_ids: userIds,
        });

        if (amlRoleError) {
          console.warn('Failed to load AML roles for users:', amlRoleError.message);
        } else {
          const rolesByUser = new Map<string, string[]>();
          for (const row of amlRoleRows ?? []) {
            const current = rolesByUser.get(row.user_id) ?? [];
            current.push(row.role_name ?? row.role);
            rolesByUser.set(row.user_id, current);
          }
          usersWithAmlRoles = (users ?? []).map((entry: any) => ({
            ...entry,
            aml_roles: rolesByUser.get(entry.id) ?? [],
          }));
        }
      }

      return new Response(
        JSON.stringify({ success: true, users: usersWithAmlRoles }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_user') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: user, error } = await supabase
        .from('custom_users')
        .select(`
          id, username, email, role, is_active, created_at, updated_at,
          user_roles(id, role)
        `)
        .eq('id', user_id)
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, user }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'list_modules') {
      const { data: modules, error } = await supabase
        .from('dashboard_modules')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, modules }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_user_permissions') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: permissions, error } = await supabase
        .from('user_permissions')
        .select(`
          *,
          dashboard_modules(*)
        `)
        .eq('user_id', user_id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // The stored rows are returned exactly as they are, never synthesised.
      // For a superadmin they are usually empty, because the role grants
      // access on its own — so the editor is told who it is looking at and
      // says as much, rather than presenting an empty grid that reads as "no
      // access" for the one account that has all of it.
      const { data: targetRoleRow } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user_id)
        .eq('role', 'superadmin')
        .maybeSingle();
      const { data: targetUserRow } = await supabase
        .from('custom_users')
        .select('role')
        .eq('id', user_id)
        .maybeSingle();
      const targetIsSuperadmin = !!targetRoleRow || targetUserRow?.role === 'super_admin';

      return new Response(
        JSON.stringify({ success: true, permissions, target_is_superadmin: targetIsSuperadmin }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_permissions') {
      const { user_id, permissions } = body;
      if (!user_id || !permissions) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID and permissions required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Delete existing permissions
      await supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', user_id);

      // Insert new permissions
      for (const perm of permissions) {
        const { data: module } = await supabase
          .from('dashboard_modules')
          .select('id')
          .eq('module_key', perm.module_key)
          .single();

        if (module) {
          await supabase
            .from('user_permissions')
            .insert({
              user_id,
              module_id: module.id,
              can_view: perm.can_view,
              can_edit: perm.can_edit,
              can_delete: perm.can_delete,
              granted_by: adminUser.id,
            });
        }
      }

      // Revoking every session forces the target to sign back in under the
      // new grants. Editing your OWN grid is the one case where that is pure
      // cost: only a superadmin can reach this action, their access comes
      // from the role rather than these rows, so signing them out changes
      // nothing except throwing away the session of the person who just made
      // the change. (Losing the role revokes sessions on its own path —
      // `demote_from_superadmin` below.)
      const editingSelf = user_id === adminUser.id;
      if (!editingSelf) {
        await revokeUserSessions(user_id, 'privilege_change:permissions_updated');
      }
      console.log(
        `Permissions updated for user ${user_id} by ${adminUser.username}${editingSelf ? ' (self-edit; sessions kept)' : ''}`,
      );
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Permissions updated',
          sessions_revoked: !editingSelf,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'assign_role') {
      const { user_id, role } = body;
      if (!user_id || !role) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID and role required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('user_roles')
        .upsert({ user_id, role }, { onConflict: 'user_id,role' });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await revokeUserSessions(user_id, `privilege_change:role_assigned:${role}`);
      console.log(`Role ${role} assigned to user ${user_id} by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'Role assigned' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'remove_role') {
      const { user_id, role } = body;
      if (!user_id || !role) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID and role required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user_id)
        .eq('role', role);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await revokeUserSessions(user_id, `privilege_change:role_removed:${role}`);
      console.log(`Role ${role} removed from user ${user_id} by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'Role removed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'set_aml_roles') {
      const { user_id, aml_roles } = body;
      if (!user_id || !Array.isArray(aml_roles)) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID and AML roles are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const dedupedRoles = [...new Set(aml_roles.map((role) => String(role).toLowerCase()))];
      const invalidRole = dedupedRoles.find((role) => !AML_ROLES.has(role));
      if (invalidRole) {
        return new Response(
          JSON.stringify({ success: false, error: `Invalid AML role: ${invalidRole}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: updatedRoles, error } = await supabase.rpc('admin_set_aml_roles_for_user', {
        _target_user_id: user_id,
        _roles: dedupedRoles,
        _granted_by: adminUser.id,
      });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await revokeUserSessions(user_id, 'privilege_change:aml_roles_updated');
      console.log(`AML roles updated for user ${user_id} by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'AML roles updated', aml_roles: (updatedRoles ?? []).map((row: any) => row.role_name ?? row.role) }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_user') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const updateData: any = { updated_at: new Date().toISOString() };
      // Handle restore from soft-delete
      if ((body as any).restore === true) {
        updateData.deleted_at = null;
        updateData.is_active = true;
      }
      // Add fields that can be updated by superadmin
      const allowedFields = ['is_active', 'email', 'username', 'personal_mailbox'];
      for (const field of allowedFields) {
        if ((body as any)[field] !== undefined) {
          updateData[field] = (body as any)[field];
        }
      }

      // Email integrity guard: never allow clearing or setting a malformed email
      // (DB will reject this anyway via NOT NULL + CHECK constraint, but we surface
      //  a friendly error rather than a raw Postgres constraint violation).
      if ('email' in updateData) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const normalised = String(updateData.email || '').trim().toLowerCase();
        if (!normalised || !emailRegex.test(normalised)) {
          return new Response(
            JSON.stringify({ success: false, error: 'A valid email address is required and cannot be cleared' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        updateData.email = normalised;
      }

      const { error } = await supabase
        .from('custom_users')
        .update(updateData)
        .eq('id', user_id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`User ${user_id} updated by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'User updated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update own mailbox - available to any authenticated user for their own profile
    if (action === 'update_mailbox') {
      const { user_id, personal_mailbox } = body;
      const targetUserId = user_id || adminUser.id;
      
      // Non-superadmins can only update their own mailbox
      // Superadmins can update anyone's mailbox
      if (targetUserId !== adminUser.id) {
        // This will only be reached by superadmins due to earlier auth check
        console.log(`Superadmin ${adminUser.username} updating mailbox for user ${targetUserId}`);
      }

      const { error } = await supabase
        .from('custom_users')
        .update({ 
          personal_mailbox: personal_mailbox || null,
          updated_at: new Date().toISOString() 
        })
        .eq('id', targetUserId);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Mailbox updated for user ${targetUserId}`);
      return new Response(
        JSON.stringify({ success: true, message: 'Mailbox updated' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Soft-delete user (sets deleted_at, deactivates, clears sessions)
    if (action === 'delete_user') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Prevent deleting self
      if (user_id === adminUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot delete your own account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Look up email first so we can release the Mission Control seat.
      const { data: victim } = await supabase
        .from('custom_users')
        .select('email')
        .eq('id', user_id)
        .single();

      // Soft-delete: set deleted_at and deactivate
      const { error } = await supabase
        .from('custom_users')
        .update({ 
          deleted_at: new Date().toISOString(), 
          is_active: false,
          updated_at: new Date().toISOString() 
        })
        .eq('id', user_id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Invalidate all sessions for this user
      await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', user_id);

      // Mission Control: release the seat (idempotent — safe on repeat).
      if (victim?.email) {
        try {
          const released = await releaseSeat(victim.email, 'user_soft_deleted');
          if (!released.ok) console.warn(`[seat] release failed: ${released.error}`);
        } catch (e) {
          console.warn('[seat] release threw', e);
        }
      }
      // Mission Control: release ALL of this user's device slots too.
      try {
        const r = await releaseDevice({ externalUserId: user_id, reason: 'user_soft_deleted' });
        if (!r.ok) console.warn(`[device] release failed: ${r.error}`);
      } catch (e) {
        console.warn('[device] release threw', e);
      }

      console.log(`User ${user_id} soft-deleted by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'User deactivated and archived' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Permanently purge a soft-deleted user
    if (action === 'purge_user') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (user_id === adminUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot purge your own account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify user is soft-deleted before allowing purge
      const { data: targetUser } = await supabase
        .from('custom_users')
        .select('id, deleted_at, username, email')
        .eq('id', user_id)
        .single();

      if (!targetUser) {
        return new Response(
          JSON.stringify({ success: false, error: 'User not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!targetUser.deleted_at) {
        return new Response(
          JSON.stringify({ success: false, error: 'User must be archived (soft-deleted) before permanent purge' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Permanently delete
      const { error } = await supabase
        .from('custom_users')
        .delete()
        .eq('id', user_id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Mission Control: release the seat (idempotent even if soft-delete already did).
      if (targetUser.email) {
        try {
          const released = await releaseSeat(targetUser.email, 'user_purged');
          if (!released.ok) console.warn(`[seat] release on purge failed: ${released.error}`);
        } catch (e) {
          console.warn('[seat] release on purge threw', e);
        }
      }
      try {
        const r = await releaseDevice({ externalUserId: user_id, reason: 'user_purged' });
        if (!r.ok) console.warn(`[device] release on purge failed: ${r.error}`);
      } catch (e) {
        console.warn('[device] release on purge threw', e);
      }

      console.log(`User ${targetUser.username} (${user_id}) permanently purged by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'User permanently deleted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reset password for a user (superadmin action)
    if (action === 'reset_user_password') {
      const { user_id, new_password } = body as any;
      if (!user_id || !new_password) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID and new password required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (user_id === adminUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Use your profile settings to change your own password' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate password strength
      const validation = await validatePasswordStrength(new_password);
      if (!validation.isValid) {
        return new Response(
          JSON.stringify({ success: false, error: validation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Releasing the lockout is part of the reset, not an extra.
      //
      // This is the action an administrator reaches for when a colleague
      // cannot get in, so the account is very often locked at the moment it
      // runs — the failed attempts that prompted the call are the same ones
      // that tripped it. Writing only the hash hands back a password that is
      // refused for the rest of the window, and refused as though it were
      // wrong, so the administrator is told the reset worked and the colleague
      // is still locked out. Same reasoning as admin-password-reset.
      const hashedPassword = await hashPassword(new_password);
      const { error } = await supabase
        .from('custom_users')
        .update({
          password_hash: hashedPassword,
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', user_id);

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Invalidate all sessions so user must re-login with new password
      await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', user_id);

      console.log(`Password reset for user ${user_id} by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'Password reset successfully. User sessions invalidated.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'send_invite') {
      const { invite_data } = body;
      if (!invite_data || !invite_data.email || !invite_data.permissions) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email and permissions required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if email already exists
      const { data: existingUser } = await supabase
        .from('custom_users')
        .select('id')
        .eq('email', invite_data.email)
        .single();

      if (existingUser) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email already registered' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      // Generate temp password if needed
      let tempPassword: string | null = null;
      if (invite_data.invite_type === 'temp_password') {
        tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
      }

      // Mission Control: reserve a seat BEFORE we persist the invite, so a full
      // tenant returns HTTP 402 with `seat_limit_reached` and no invite is created.
      // Idempotency key = invite token, so a retried request reuses the reservation.
      const seatIdempotencyKey = (body as any)?.idempotency_key || token;
      let mcSeatId: string | null = null;
      try {
        const reservation = await reserveSeat({
          externalUserId: invite_data.email,
          email: invite_data.email,
          displayName: invite_data.username,
          idempotencyKey: seatIdempotencyKey,
          roleSlug: (invite_data as any).role_slug || (body as any)?.role_slug || undefined,
        });
        if (!reservation.ok) {
          if (reservation.error === 'seat_limit_reached') {
            const limitInfo = reservation as import('../_shared/missionControlSeats.ts').SeatLimitReached;
            return new Response(
              JSON.stringify({
                success: false,
                error: 'seat_limit_reached',
                message: `Seat limit reached on the ${limitInfo.plan} plan (${limitInfo.seats_used}/${limitInfo.seat_limit}). Upgrade to invite more team members.`,
                seat_limit: limitInfo.seat_limit,
                seats_used: limitInfo.seats_used,
                plan: limitInfo.plan,
              }),
              { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          console.warn(`[seat] reserve failed (${reservation.error}); continuing without seat tracking`);
        } else {
          mcSeatId = reservation.seat_id;
        }
      } catch (e) {
        console.warn('[seat] reserve threw; continuing without seat tracking', e);
      }

      // Which application does this invitation point at?
      //
      // Resolved BEFORE anything is written, because the failure below has to
      // leave no invite row and no reserved seat behind.
      //
      // The last resort used to be a literal: `https://<this repository's
      // project>.lovable.app`. On this deployment that is dead code — a browser
      // sends `Origin` on every cross-origin POST and this function is only
      // ever called from the app. On a CLONE of this repository it is live
      // poison: `APP_URL` is deployment config and is deliberately not
      // inherited, so the chain runs out and a staff invitation for one tenant
      // is emailed a link into a DIFFERENT tenant's application — where the
      // token means nothing and the recipient is asked to sign in to a company
      // they do not work for.
      //
      // There is no safe default for "which application". Refusing is
      // recoverable; sending somebody else's front door is not.
      const inviteOrigin = req.headers.get('origin')
        || req.headers.get('referer')?.replace(/\/$/, '')
        || Deno.env.get('APP_URL');
      if (!inviteOrigin) {
        console.error('[invite] no origin, referer or APP_URL — refusing to guess an application URL');
        return new Response(
          JSON.stringify({
            success: false,
            error: "Could not determine this deployment's application URL. Set APP_URL on this project and retry — nothing was created and no email was sent.",
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const appUrl = inviteOrigin.replace(/\/+$/, ''); // Remove trailing slashes

      const { error: insertError } = await supabase
        .from('permission_invite_tokens')
        .insert({
          email: invite_data.email,
          username: invite_data.username,
          invite_type: invite_data.invite_type,
          token,
          temporary_password: tempPassword,
          permissions: invite_data.permissions,
          invited_by: adminUser.id,
          expires_at: expiresAt.toISOString(),
          mc_seat_id: mcSeatId,
          mc_seat_idempotency_key: seatIdempotencyKey,
        });

      if (insertError) {
        console.error('Failed to create invite:', insertError);
        // Roll back the seat reservation so the slot isn't wasted.
        if (mcSeatId) {
          try { await releaseSeat(invite_data.email, 'invite_persist_failed'); } catch { /* ignore */ }
        }
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create invite' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const inviteUrl = `${appUrl}/accept-invite?token=${token}`;

      // Send email
      const brandCfg = await getBrandConfig(supabase);
      let emailContent = '';
      if (invite_data.invite_type === 'magic_link') {
        emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">You're Invited!</h1>
            <p>Hello${invite_data.username ? ` ${invite_data.username}` : ''},</p>
            <p>${adminUser.username} has invited you to join the ${brandCfg.companyName} Dashboard.</p>
            <div style="margin: 30px 0;">
              <a href="${inviteUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Accept Invitation
              </a>
            </div>
            <p>This invitation expires in 7 days.</p>
            <p style="color: #666; font-size: 12px;">
              If the button doesn't work, copy this link: ${inviteUrl}
            </p>
          </div>
        `;
      } else {
        emailContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Your ${brandCfg.companyName} Dashboard Account</h1>
            <p>Hello${invite_data.username ? ` ${invite_data.username}` : ''},</p>
            <p>${adminUser.username} has created an account for you on ${brandCfg.companyName} Dashboard.</p>
            <div style="background: #f4f4f4; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Username:</strong> ${invite_data.username || invite_data.email.split('@')[0]}</p>
              <p style="margin: 10px 0 0;"><strong>Temporary Password:</strong> ${tempPassword}</p>
            </div>
            <div style="margin: 30px 0;">
              <a href="${inviteUrl}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Set Up Your Account
              </a>
            </div>
            <p>Please change your password after logging in.</p>
            <p>This invitation expires in 7 days.</p>
          </div>
        `;
      }

      const { error: emailError } = await resend.emails.send({
        from: brandCfg.fromHeaderAdmin,
        to: [invite_data.email],
        subject: `You're Invited to ${brandCfg.companyName} Dashboard`,
        html: emailContent,
      });

      if (emailError) {
        console.error('Failed to send invite email:', emailError);
        // Still return success since invite was created
      }

      console.log(`Invite sent to ${invite_data.email} by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Invite sent successfully',
          invite_url: inviteUrl,
          temporary_password: tempPassword
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'promote_to_superadmin') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Remove ALL existing roles for this user first (admin, user, etc.)
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user_id);

      if (deleteError) {
        console.error('Failed to clear existing roles:', deleteError);
      }

      // Assign ONLY superadmin role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id, role: 'superadmin' });

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Update custom_users role to super_admin
      await supabase
        .from('custom_users')
        .update({ role: 'super_admin', updated_at: new Date().toISOString() })
        .eq('id', user_id);

      await revokeUserSessions(user_id, 'privilege_change:promoted_superadmin');
      console.log(`User ${user_id} promoted to superadmin by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'User promoted to superadmin' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'demote_from_superadmin') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Prevent demoting yourself
      if (user_id === adminUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot demote yourself' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Remove ALL existing roles for this user first
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user_id);

      if (deleteError) {
        return new Response(
          JSON.stringify({ success: false, error: deleteError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Assign ONLY admin role
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({ user_id, role: 'admin' });

      if (insertError) {
        console.error('Failed to assign admin role:', insertError);
      }

      // Update custom_users role back to sub_admin
      const { error: userError } = await supabase
        .from('custom_users')
        .update({ role: 'sub_admin', updated_at: new Date().toISOString() })
        .eq('id', user_id);

      if (userError) {
        console.error('Failed to update custom_users role:', userError);
      }

      await revokeUserSessions(user_id, 'privilege_change:demoted_from_superadmin');
      console.log(`User ${user_id} demoted from superadmin by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: 'User demoted from superadmin' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'create_subadmin') {
      const { subadmin_data } = body;
      if (!subadmin_data || !subadmin_data.username || !subadmin_data.password || !subadmin_data.permissions) {
        return new Response(
          JSON.stringify({ success: false, error: 'Username, password, and permissions required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Email is REQUIRED — DB now enforces NOT NULL + format on custom_users.email.
      // Validate here so we return a clean error instead of a raw constraint violation.
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const normalisedEmail = (subadmin_data.email || '').trim().toLowerCase();
      if (!normalisedEmail || !emailRegex.test(normalisedEmail)) {
        return new Response(
          JSON.stringify({ success: false, error: 'A valid email address is required for every account' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      subadmin_data.email = normalisedEmail;

      // Validate password strength
      const validation = await validatePasswordStrength(subadmin_data.password);
      if (!validation.isValid) {
        return new Response(
          JSON.stringify({ success: false, error: validation.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if username already exists
      const { data: existingUser } = await supabase
        .from('custom_users')
        .select('id')
        .eq('username', subadmin_data.username)
        .single();

      if (existingUser) {
        return new Response(
          JSON.stringify({ success: false, error: 'Username already exists' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if email already exists (if provided)
      if (subadmin_data.email) {
        const { data: existingEmail } = await supabase
          .from('custom_users')
          .select('id')
          .eq('email', subadmin_data.email)
          .single();

        if (existingEmail) {
          return new Response(
            JSON.stringify({ success: false, error: 'Email already registered' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Hash the password before storing
      const hashedPassword = await hashPassword(subadmin_data.password);
      
      // Create user
      const { data: newUser, error: userError } = await supabase
        .from('custom_users')
        .insert({
          username: subadmin_data.username,
          email: subadmin_data.email || null,
          password_hash: hashedPassword,
          personal_mailbox: subadmin_data.personal_mailbox || null,
          role: 'sub_admin',
          is_active: true,
        })
        .select()
        .single();

      if (userError) {
        console.error('Failed to create sub-admin:', userError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to create user. Username may already exist.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Assign admin role
      await supabase
        .from('user_roles')
        .insert({ user_id: newUser.id, role: 'admin' });

      // Assign permissions
      const permissions = subadmin_data.permissions;
      
      for (const perm of permissions) {
        const { data: module } = await supabase
          .from('dashboard_modules')
          .select('id')
          .eq('module_key', perm.module_key)
          .single();

        if (module) {
          await supabase
            .from('user_permissions')
            .insert({
              user_id: newUser.id,
              module_id: module.id,
              can_view: perm.can_view,
              can_edit: perm.can_edit,
              can_delete: perm.can_delete,
              granted_by: adminUser.id,
            });
        }
      }

      console.log(`Sub-admin ${subadmin_data.username} created by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Sub-admin created successfully',
          user: {
            id: newUser.id,
            username: newUser.username,
            email: newUser.email
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Force logout a user by invalidating all their sessions
    if (action === 'force_logout') {
      const { user_id } = body;
      if (!user_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'User ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Prevent self-logout
      if (user_id === adminUser.id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot force-logout yourself' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', user_id);

      if (error) {
        console.error('Force logout error:', error);
        return new Response(
          JSON.stringify({ success: false, error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch target username for logging
      const { data: targetUser } = await supabase
        .from('custom_users')
        .select('username')
        .eq('id', user_id)
        .single();

      console.log(`User ${targetUser?.username || user_id} force-logged out by ${adminUser.username}`);
      return new Response(
        JSON.stringify({ success: true, message: `${targetUser?.username || 'User'} has been logged out` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Admin user management error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
