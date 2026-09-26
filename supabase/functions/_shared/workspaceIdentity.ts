/**
 * The deployment's workspace identity, read at the edge.
 *
 * `workspaceIdentity.pure.ts` decides; this reads what it decides from:
 *
 *  - the deployment, from `SUPABASE_URL` (`deploymentKind`), never from a
 *    name a settings row can hold;
 *  - on the prime, Report Settings' name through `getBrandConfig()`, and only
 *    for a caller that always read it (`readPrimeName`). A prime caller that
 *    printed a literal reads nothing at all;
 *  - on a clone, also the Branding page's name and the name Mission Control
 *    provisioned the workspace under.
 *
 * A read that fails is never a reason to fail the caller. It resolves to the
 * next name, or to none, and never to the house.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- @ts-expect-error would be an unused directive under Deno, where this import resolves.
// @ts-ignore Deno-only esm.sh import; not resolvable under Node type-checking.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getBrandConfig } from './brand-config.ts';
import { deploymentKind } from './emailIdentity.pure.ts';
import type { IssuerDeployment } from './reports/issuerIdentity.pure.ts';
import { resolveWorkspaceIdentity, type WorkspaceIdentity } from './workspaceIdentity.pure.ts';

export * from './workspaceIdentity.pure.ts';

function env(name: string): string | null {
  try {
    return Deno.env.get(name) ?? null;
  } catch {
    // No Deno.env in a test harness: treat as unset.
    return null;
  }
}

/** Which deployment this is, from its own backend. Anything that is not the prime is a clone. */
export function workspaceDeployment(): IssuerDeployment {
  return { prime: deploymentKind(env('SUPABASE_URL')) === 'prime' };
}

/**
 * `whitelabel_settings.company_name`, or null.
 *
 * A failed read is not a reason to fail anything: it resolves the caller to
 * the next name, or to no business, and never to the house.
 */
export async function brandingPageName(): Promise<string | null> {
  try {
    const client: SupabaseClient = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await client
      .from('whitelabel_settings')
      .select('company_name')
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const name = (data as { company_name?: unknown } | null)?.company_name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/**
 * The business this deployment's tools speak for.
 *
 * `readPrimeName` says what the calling site did before this module existed:
 * `true` where it read Report Settings' name (the assistants), `false` where it
 * printed a literal (everything else). On the prime that is all that happens.
 */
export async function loadWorkspaceIdentity(options: { readPrimeName: boolean }): Promise<WorkspaceIdentity> {
  const deployment = workspaceDeployment();
  if (deployment.prime) {
    if (!options.readPrimeName) return resolveWorkspaceIdentity({}, deployment);
    // Exactly the read the prime's sites always made, failure behaviour included.
    return resolveWorkspaceIdentity({ companyName: (await getBrandConfig()).companyName }, deployment);
  }
  const [companyName, brandName] = await Promise.all([
    getBrandConfig().then((brand) => brand.companyName, () => null),
    brandingPageName(),
  ]);
  return resolveWorkspaceIdentity(
    { companyName, brandName, workspaceName: env('MISSION_CONTROL_AGENCY_NAME') },
    deployment,
  );
}
