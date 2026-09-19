import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireStepUp } from '../_shared/stepUp.ts';
import { ALLOWED_INTEGRATION_SECRETS } from '../_shared/integrationSecrets.ts';
import { listingsPipelineRefusal } from '../_shared/listingsPipelineSecrets.pure.ts';
import { deploymentIdentityRefusal } from '../_shared/deploymentIdentitySecrets.pure.ts';
import {
  describeSecretWriteFailure,
  integrationSecretBrokerUrl,
  brokerRoute,
  resolveIntegrationSecretRoute,
  type IntegrationSecretRoute,
} from '../_shared/integrationSecretRoute.pure.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { recordActivity } from '../_shared/activityAudit.ts';

// Allowlist of secrets that can be updated via this endpoint.
// Derived from the Integrations registry rather than hand-maintained: the previous
// hand-typed list covered 27 of the registry's 240 credential fields, so "Sync to
// Supabase" was rejected for most of the 141 integrations the page offers.
const ALLOWED_SECRETS = ALLOWED_INTEGRATION_SECRETS;

// Validation schemas
const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{2,50}$/;
const MAX_SECRET_VALUE_LENGTH = 2000;

interface UpdateSecretRequest {
  secrets: { name: string; value: string }[];
}

/**
 * Perform one write on the resolved route.
 *
 * Both branches speak the same shape — a POST of `[{name, value}]` — because
 * Mission Control's broker deliberately takes the Management API's own body
 * rather than inventing a second vocabulary for the same act.
 */
async function writeSecrets(
  route: IntegrationSecretRoute,
  secrets: { name: string; value: string }[],
): Promise<Response> {
  if (route.via === 'unconfigured') {
    throw new Error(`writeSecrets called on an unconfigured route: ${route.why}`);
  }
  if (route.via === 'broker') {
    return await fetch(integrationSecretBrokerUrl(route), {
      method: 'POST',
      headers: route.headers,
      body: JSON.stringify({ secrets }),
    });
  }
  return await fetch(`https://api.supabase.com/v1/projects/${route.projectRef}/secrets`, {
    method: 'POST',
    headers: route.headers,
    body: JSON.stringify(secrets),
  });
}

/**
 * What a brokered write actually did — which names landed, and which Mission
 * Control declined on its own account.
 *
 * Mission Control applies an INDEPENDENT deny-list, because a broker that
 * trusts its caller's validation is not a broker. So a 200 does not mean
 * everything sent was written, and reporting the names we SENT would print a
 * green toast over a name that was refused.
 *
 * A parse failure falls back to the names sent rather than throwing: the
 * secrets that did land are already written at this point, and failing the
 * request over the shape of a report would tell the operator nothing landed
 * when something did. It is reported as a warning so the fallback is never
 * silent.
 */
async function brokerOutcome(
  response: Response,
  sent: string[],
): Promise<{ updated: string[]; refused: string[] }> {
  try {
    const body = (await response.clone().json()) as { updated?: unknown; refused?: unknown };
    const updated = Array.isArray(body.updated)
      ? body.updated.filter((n): n is string => typeof n === 'string')
      : sent;
    const refused = Array.isArray(body.refused)
      ? body.refused.map((r) => {
          const row = r as { name?: unknown; reason?: unknown };
          const name = typeof row.name === 'string' ? row.name : 'a secret';
          const reason = typeof row.reason === 'string' ? row.reason : 'refused by Mission Control';
          return `${name}: ${reason}`;
        })
      : [];
    return { updated, refused };
  } catch {
    return {
      updated: sent,
      refused: ['Mission Control accepted the write but its report could not be read, so which ' +
        'names landed is this deployment\'s assumption rather than its answer.'],
    };
  }
}

/**
 * Keep the credential out of relayed error text.
 *
 * A vendor is entitled to echo what it was sent, and this handler puts a
 * response body straight into its own JSON and its own logs.
 */
function redact(text: string, secret: string): string {
  const body = text.slice(0, 500);
  return secret ? body.split(secret).join('[redacted]') : body;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    /*
     * Where this write goes is resolved AFTER authentication, not before it.
     *
     * It used to be the first thing the handler did, and it answered 400
     * `setupRequired` to any caller at all when no management token was set —
     * which on a clone is the ordinary, correct state. Two things follow from
     * moving it: an unauthenticated caller no longer learns anything about how
     * this deployment is wired, and the brokered route can be reached at all,
     * because the old bail returned before there was any route to resolve.
     */
    const sbMgmt = Deno.env.get('SB_MANAGEMENT_ACCESS_TOKEN');
    const legacyMgmt = Deno.env.get('SUPABASE_ACCESS_TOKEN');

    // SECURITY: Verify authentication and superadmin role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: UpdateSecretRequest = await req.json();
    
    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      console.log('[update-integration-secret] Auth failed:', authResult.error);
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }
    
    // Check if user has superadmin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .eq('role', 'superadmin')
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${authResult.userId} attempted to update integration secrets without superadmin role.`);
      return createForbiddenResponse('Forbidden: Superadmin access required', corsHeaders);
    }
    console.log(`Superadmin ${authResult.userId} is updating integration secrets.`);

    // WP-11C — Require recent reauth for secret rotation (dark-launch via STEP_UP_ENFORCED).
    const stepUpGate = await requireStepUp(supabase, {
      userId: authResult.userId,
      capability: 'secrets.update',
      req,
      body,
      logAudit: true,
    });
    if (stepUpGate) return stepUpGate;

    if (!body.secrets || !Array.isArray(body.secrets) || body.secrets.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No secrets provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate all secrets before updating
    const validationErrors: string[] = [];
    const validSecrets: { name: string; value: string }[] = [];

    for (const secret of body.secrets) {
      // Validate secret name format
      if (!SECRET_NAME_REGEX.test(secret.name)) {
        validationErrors.push(`Invalid secret name format: ${secret.name}`);
        continue;
      }

      // The Listings pipeline's names are refused BEFORE the allowlist, and
      // said in the operator's terms: "not in allowlist" reads as a typo, and
      // this is a rule. See listingsPipelineSecrets.pure.ts.
      const managed = listingsPipelineRefusal(secret.name);
      if (managed) {
        validationErrors.push(managed);
        continue;
      }

      // The names that decide who this deployment IS are refused before the
      // allowlist too, and for a reason that got sharper the moment this
      // endpoint learned to broker: the allowlist is GENERATED from the
      // Integrations registry, so it already carries eleven of them, and a
      // tenant reaching this endpoint through Mission Control would otherwise
      // be able to set its own MISSION_CONTROL_URL or a Supabase personal
      // access token. See deploymentIdentitySecrets.pure.ts.
      const identity = deploymentIdentityRefusal(secret.name);
      if (identity) {
        validationErrors.push(identity);
        continue;
      }

      // Check if secret is in allowlist
      if (!ALLOWED_SECRETS.has(secret.name)) {
        validationErrors.push(`Secret not in allowlist: ${secret.name}`);
        continue;
      }

      // Validate secret value length
      if (secret.value && secret.value.length > MAX_SECRET_VALUE_LENGTH) {
        validationErrors.push(`Secret value too long: ${secret.name} (max ${MAX_SECRET_VALUE_LENGTH} chars)`);
        continue;
      }

      // Only include non-empty secrets
      if (secret.value && secret.value.trim()) {
        validSecrets.push({
          name: secret.name,
          value: secret.value.trim()
        });
      }
    }

    if (validSecrets.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'No valid secrets to update',
          validationErrors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    /*
     * Resolve where this write goes. The prime holds a management token and
     * writes its own project; a clone has a Mission Control link instead and
     * the CALL travels. `integrationSecretRoute.pure.ts` carries the reasoning
     * — including why a clone must never hold the management token that would
     * make the direct route work.
     */
    const firstRoute = resolveIntegrationSecretRoute({
      managementToken: sbMgmt ?? legacyMgmt,
      managementTokenSource: sbMgmt ? 'SB_MANAGEMENT_ACCESS_TOKEN' : 'SUPABASE_ACCESS_TOKEN',
      supabaseUrl,
      missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
      cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
    });

    if (firstRoute.via === 'unconfigured') {
      console.error('[update-integration-secret] no route', { why: firstRoute.why });
      return new Response(
        JSON.stringify({
          success: false,
          error: firstRoute.why,
          // Kept so the page still raises its banner, but the REMEDY travels
          // with it now. The banner used to be hard-coded to "add a
          // SUPABASE_ACCESS_TOKEN", which on a clone sends an operator to
          // fetch the one credential this arrangement exists to keep off
          // their project.
          setupRequired: true,
          setupHint: firstRoute.why,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[update-integration-secret] writing', {
      via: firstRoute.via,
      target: firstRoute.via === 'direct' ? firstRoute.projectRef : firstRoute.missionControlUrl,
      names: validSecrets.map(s => s.name),
      ...(firstRoute.via === 'direct' ? { tokenSource: firstRoute.tokenSource } : {}),
      // A value under the management-token name that was discarded as unusable.
      ...(firstRoute.via === 'broker' && firstRoute.unusableManagementToken
        ? { unusableManagementToken: firstRoute.unusableManagementToken }
        : {}),
    });

    let route = firstRoute;
    let response = await writeSecrets(route, validSecrets);

    /*
     * A refused DIRECT write is not the end of the road when this deployment
     * can broker.
     *
     * The remedy the direct route offers is "rotate the Supabase management
     * token", and a tenant cannot perform it: that credential reaches every
     * project the account owns, which is the whole reason a clone is not meant
     * to hold one. So where a broker exists, it is tried — the same names, the
     * same allow-list (every refusal ran before the route was resolved), and
     * Mission Control derives the project from the key it is presented rather
     * than from anything sent here.
     *
     * Both attempts are logged. A silent second attempt would hide that this
     * project holds a management token that does not work, which is a setting
     * somebody still has to remove.
     */
    if (!response.ok && response.status === 401 && route.via === 'direct') {
      const fallback = brokerRoute({
        missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
        cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
      });
      if (fallback) {
        console.warn('[update-integration-secret] direct write refused, brokering instead', {
          tokenSource: route.tokenSource,
          missionControlUrl: fallback.missionControlUrl,
          names: validSecrets.map((sec) => sec.name),
        });
        route = fallback;
        response = await writeSecrets(route, validSecrets);
      }
    }

    if (!response.ok) {
      const errorText = redact(await response.text(), route.secret);
      const failure = describeSecretWriteFailure(route, response);
      console.error('[update-integration-secret] write refused', {
        status: response.status,
        code: failure.code,
        end: failure.end,
        body: errorText,
        names: validSecrets.map(s => s.name),
      });

      /*
       * A 401 means two different things and they have opposite remedies.
       *
       * On the direct route the management token this deployment holds is
       * invalid and an operator rotates it. On the brokered route it is this
       * workspace's Mission Control key that was refused, and rotating a
       * Supabase token would achieve nothing — which is exactly the wrong
       * turn the old single message sent everybody down.
       */
      if (response.status === 401) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              route.via === 'direct'
                ? `Invalid management token (source: ${route.tokenSource}). Rotate it at ` +
                  'https://supabase.com/dashboard/account/tokens and re-save via the Secrets form.'
                : 'Mission Control refused this workspace\'s key. It is unknown, revoked, or does ' +
                  'not carry the integrations:write scope. Nothing on this deployment needs ' +
                  'changing — ask for the key to be re-issued from Mission Control.',
            setupRequired: true,
            setupHint:
              route.via === 'direct'
                ? `Rotate ${route.tokenSource} at https://supabase.com/dashboard/account/tokens.`
                : 'Ask Mission Control to re-issue this workspace\'s key with the ' +
                  'integrations:write scope.',
            failingEnd: failure.end,
            failureCode: failure.code,
            managementApiStatus: response.status,
            managementApiBody: errorText,
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: `${failure.service} answered ${response.status}: ${errorText}`,
          failingEnd: failure.end,
          failureCode: failure.code,
          ...(failure.detail ? { failureDetail: failure.detail } : {}),
          managementApiStatus: response.status,
          managementApiBody: errorText,
          attemptedNames: validSecrets.map(s => s.name),
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    /*
     * Mission Control applies its OWN deny-list — a broker that trusts its
     * caller's validation is not a broker — so a brokered write can succeed
     * having refused some of what it was sent. Those refusals join the local
     * ones rather than being discarded, or an operator watches a name they
     * typed vanish with a green toast over it.
     */
    let writtenNames = validSecrets.map(s => s.name);
    if (route.via === 'broker') {
      const outcome = await brokerOutcome(response, writtenNames);
      writtenNames = outcome.updated;
      for (const r of outcome.refused) validationErrors.push(r);
    }

    if (writtenNames.length === 0) {
      // Every name we sent was refused at the far end. A 200 with an empty
      // list is not a success from where the operator is standing.
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Mission Control accepted the request and wrote none of the secrets in it.',
          validationErrors,
          attemptedNames: validSecrets.map(s => s.name),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Record the change in the audit trail.
    //
    // This used to pass `entity_type: 'settings'`, which is not one of the 26
    // values of the `activity_entity_type` enum, and discarded the insert's
    // error — so every credential change ever made here failed to record who
    // changed which secret while still answering `success: true`. `system` is
    // the enum's value for a platform-level change. Secret NAMES only: a value
    // must never reach an audit row.
    const audit = await recordActivity(supabase, {
      user_id: authResult.userId,
      username: authResult.username,
      action_type: 'update',
      entity_type: 'system',
      entity_name: 'Integration Secrets',
      metadata: {
        updated_secrets: writtenNames,
        write_route: route.via,
        validation_warnings: validationErrors.length > 0 ? validationErrors : undefined
      }
    });

    console.log(`Successfully updated ${writtenNames.length} secrets via ${route.via}`);

    // The secrets ARE written at this point, so a failed audit row must not
    // fail the request — but it must not be invisible either. The operator is
    // told the change landed and the record of it did not.
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully updated ${writtenNames.length} secret(s)`,
        updatedSecrets: writtenNames,
        // Which road the write took. The page says it, because "saved" means
        // two different things — written onto this project by this deployment,
        // or written onto it by Mission Control on this workspace's behalf —
        // and an operator debugging a key that is not taking effect needs to
        // know which one to ask about.
        via: route.via,
        validationWarnings: validationErrors.length > 0 ? validationErrors : undefined,
        auditLogged: audit.ok,
        ...(audit.ok ? {} : { auditError: audit.reason })
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error updating secrets:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'update-integration-secret'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
