// Phase 8 — Aurixa Agent Skill Marketplace.
// list-available: public skills the user hasn't installed yet, with metrics.
// list-installed: skills the current user has installed.
// install: snapshot the public skill into agent_skill_installs and copy into user's agent_skills.
// uninstall: mark install as uninstalled and disable the user's copy.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
  const userId = auth.userId as string;
  const action = body?.action ?? 'list-available';

  // Skills change which tools the agent will reach for, so the marketplace is an
  // agent surface and takes the same `agent` module gate ai-dashboard-agent
  // applies. Previously it only authenticated, so a workspace without the
  // licensed Aurixa Agent module could still browse and install skills.
  const marketplaceGate = await requireModulePermission(
    sb,
    { userId, authMethod: auth.authMethod ?? 'human' },
    'agent',
    action === 'list-available' || action === 'list-installed' ? 'can_view' : 'can_edit',
  );
  if (!marketplaceGate.ok) return json({ error: 'forbidden' }, 403);

  try {
    if (action === 'list-available') {
      const { data: publicSkills } = await sb.from('agent_skills')
        .select('id, slug, name, description, icon, allowed_tools, default_model, install_count, avg_success_rate, run_count, is_public')
        .eq('is_public', true).order('install_count', { ascending: false }).limit(200);
      const { data: installs } = await sb.from('agent_skill_installs')
        .select('skill_id').eq('user_id', userId).is('uninstalled_at', null);
      const installedIds = new Set((installs ?? []).map((i: any) => i.skill_id));
      return json({
        skills: (publicSkills ?? []).map((s: any) => ({ ...s, is_installed: installedIds.has(s.id) })),
      });
    }

    if (action === 'list-installed') {
      const { data } = await sb.from('agent_skill_installs')
        .select('id, skill_id, overrides, installed_at, skill_snapshot')
        .eq('user_id', userId).is('uninstalled_at', null).order('installed_at', { ascending: false });
      return json({ installs: data ?? [] });
    }

    if (action === 'install') {
      const skillId = String(body?.skill_id ?? '');
      const { data: src } = await sb.from('agent_skills').select('*').eq('id', skillId).eq('is_public', true).maybeSingle();
      if (!src) return json({ error: 'skill_not_found_or_private' }, 404);

      // Snapshot into installs (upsert reactivates if previously uninstalled)
      const { data: install, error: iErr } = await sb.from('agent_skill_installs').upsert({
        user_id: userId,
        skill_id: skillId,
        skill_snapshot: src,
        overrides: body?.overrides ?? {},
        installed_at: new Date().toISOString(),
        uninstalled_at: null,
      }, { onConflict: 'user_id,skill_id' }).select().single();
      if (iErr) return json({ error: iErr.message }, 500);

      // Copy into user's own agent_skills so the agent can dispatch it.
      const dupSlug = `${src.slug}--from-${skillId.slice(0, 8)}`;
      await sb.from('agent_skills').upsert({
        user_id: userId,
        slug: dupSlug,
        name: src.name,
        description: src.description,
        icon: src.icon,
        system_prompt: src.system_prompt,
        allowed_tools: src.allowed_tools,
        default_model: src.default_model,
        is_enabled: true,
        is_public: false,
      }, { onConflict: 'user_id,slug' });

      // Increment install_count on the public skill
      await sb.from('agent_skills').update({ install_count: (src.install_count ?? 0) + 1 }).eq('id', skillId);

      return json({ install });
    }

    if (action === 'uninstall') {
      const skillId = String(body?.skill_id ?? '');
      const { error } = await sb.from('agent_skill_installs')
        .update({ uninstalled_at: new Date().toISOString() })
        .eq('user_id', userId).eq('skill_id', skillId);
      if (error) return json({ error: error.message }, 500);

      // Disable the user's copy (best-effort; matched by prefix).
      const { data: src } = await sb.from('agent_skills').select('slug').eq('id', skillId).maybeSingle();
      if (src?.slug) {
        await sb.from('agent_skills').update({ is_enabled: false })
          .eq('user_id', userId).ilike('slug', `${src.slug}--from-%`);
      }
      return json({ ok: true });
    }

    if (action === 'publish') {
      // Owner publishes their own skill to the marketplace.
      const skillId = String(body?.skill_id ?? '');
      const { data, error } = await sb.from('agent_skills').update({ is_public: true })
        .eq('id', skillId).eq('user_id', userId).select().maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: 'not_found' }, 404);
      return json({ skill: data });
    }

    if (action === 'unpublish') {
      const skillId = String(body?.skill_id ?? '');
      const { error } = await sb.from('agent_skills').update({ is_public: false })
        .eq('id', skillId).eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'agent-skill-marketplace') }, 500);
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

