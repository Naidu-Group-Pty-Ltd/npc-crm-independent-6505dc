/**
 * The public projects a strategy section may name, as plain data.
 *
 * `strategyPositions.pure.ts` is a canonical investment module and may not
 * import `_shared/planning`, so the SWOT receives what the two project
 * registers read as sentence fragments already in the publisher's words:
 *
 * - the recorded register of responsible authorities' own pages
 *   (`publishedProjectRegister`) — Rouse Hill Hospital, a new school; and
 * - the government investment programmes the infrastructure evidence read
 *   (`infrastructureEvidence`) — the national programme's major transport
 *   works, a state's committed programme.
 *
 * Development applications are NOT projects in this sense: an applicant's
 * stated cost is not investment and an application is not a commitment, so
 * they stay in the infrastructure chapter's pipeline paragraph and never reach
 * a quadrant. Nor does an entry marked as a possible second reading of
 * another, because the SWOT would then count one project twice.
 *
 * Nothing here re-words a status or states a date as a completion.
 */
import type { InfrastructureEvidence, InfrastructureItem } from './infrastructureEvidence.pure.ts';
import type { NearbyProject, ProjectStage } from './publishedProjectRegister.pure.ts';

export interface OutlookProject {
  name: string;
  publisher: string;
  status: string | null;
  where: string | null;
  cost: string | null;
  timing: string | null;
}

const trim = (x: string) => (x.includes('.') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);
const money = (n: number): string => {
  if (n >= 1_000_000_000) return `$${trim((n / 1_000_000_000).toFixed(2))} billion`;
  if (n >= 1_000_000) return `$${trim((n / 1_000_000).toFixed(1))} million`;
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

/**
 * The stage a reader should be told about: the latest dated statement that
 * work has started or the thing is open, else the latest dated statement of
 * any kind. A stage announcing what is EXPECTED is never preferred over one
 * saying what has happened.
 */
function leadStage(stages: readonly ProjectStage[]): ProjectStage | null {
  if (!stages.length) return null;
  const byDate = [...stages].sort((a, b) => b.statusDate.localeCompare(a.statusDate));
  return byDate.find((s) => /\bunder ?way\b|\bopen(?:ed|s)?\b|\boperating\b/i.test(s.publishedStatus)) ?? byDate[0];
}

function fromPublished(n: NearbyProject): OutlookProject {
  const stage = leadStage(n.project.stages);
  return {
    name: n.project.name,
    publisher: n.project.authority,
    status: stage ? stage.publishedStatus : null,
    where: `${n.distanceKm.toFixed(1)} km from the property, straight-line`,
    cost: n.project.investment ? `${n.project.investment.statedAs} stated investment` : null,
    timing: stage?.timing ?? null,
  };
}

/** A programme entry: funded or estimated by a government, never an application. */
export function isProgrammeProject(item: InfrastructureItem): boolean {
  if (item.applications) return false;
  if (item.unconfirmedDuplicateOf) return false;
  if (item.costBasis === 'application') return false;
  return item.costBasis === 'committed_budget' || item.costBasis === 'estimated_project_cost'
    || !!item.statedCostRange;
}

function fromProgramme(item: InfrastructureItem): OutlookProject {
  const cost = item.statedCost !== null
    ? `${money(item.statedCost)} ${item.costBasis === 'committed_budget' ? 'committed' : 'estimated project cost'}`
    : (item.statedCostRange ? `${item.statedCostRange} (a band, not a committed figure)` : null);
  return {
    name: item.name,
    publisher: item.source,
    status: item.statedStatus,
    where: item.where,
    cost,
    timing: item.statedDelivery,
  };
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The recorded register first (nearest first, as `projectsNear` sorts it),
 * then the programme entries in the order the evidence lists them. A name
 * already given by the recorded register is not repeated.
 */
export function strategyOutlookProjects(
  evidence: Pick<InfrastructureEvidence, 'items'> | null | undefined,
  nearby: readonly NearbyProject[] | null | undefined,
): OutlookProject[] {
  const out: OutlookProject[] = [];
  const seen = new Set<string>();
  for (const n of nearby ?? []) {
    const k = key(n.project.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(fromPublished(n));
  }
  for (const item of evidence?.items ?? []) {
    if (!isProgrammeProject(item)) continue;
    const k = key(item.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(fromProgramme(item));
  }
  return out;
}
