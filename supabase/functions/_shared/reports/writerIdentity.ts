/**
 * The report writer's identity on this deployment, read at the edge.
 *
 * `writerFirm.pure.ts` decides who the writer works for; this reads what it
 * decides from. On the prime it reads exactly what the writers read before —
 * Report Settings, through `getBrandConfig` — and nothing else. On a clone it
 * also reads the Branding page's name, because a clone's documents are issued
 * under that name where Report Settings names nobody (`resolveReportIssuer`).
 */

import { getBrandConfig } from '../brand-config.ts';
import { deploymentKind } from '../emailIdentity.pure.ts';
import { brandingPageName } from '../workspaceIdentity.ts';
import { reportWriterIdentity, type ReportWriterIdentity } from './writerFirm.pure.ts';

export async function loadReportWriterIdentity(): Promise<ReportWriterIdentity> {
  const deployment = { prime: deploymentKind(Deno.env.get('SUPABASE_URL')) === 'prime' };
  const brand = await getBrandConfig();
  if (deployment.prime) return reportWriterIdentity({ companyName: brand.companyName }, deployment);
  return reportWriterIdentity(
    { companyName: brand.companyName, brandName: await brandingPageName() },
    deployment,
  );
}
