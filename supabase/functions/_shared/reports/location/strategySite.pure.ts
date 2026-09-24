/**
 * The site's registers, as the Due Diligence document's strategic read needs
 * them.
 *
 * `composeStrategicRead` lives in a canonical investment module, which may not
 * import `_shared/planning`; so this reads the planning and infrastructure
 * evidence a report row already stores (`planningEvidenceRecord.pure.ts`) and
 * hands the composer plain data — with the planning module's own qualifying
 * sentences attached verbatim, because a rule restated in another module's
 * words is how two statements of it come to disagree.
 *
 * Nothing is fetched and nothing is derived that the stored evidence did not
 * already hold: the standing is `readResidentialStanding` over the stored
 * table, the pipeline is the stored pipeline. A row written before the
 * evidence was recorded carries neither, and the reading is null — the
 * strategic read then says only what the market register supports.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */
import {
  EXISTING_DWELLING_CAVEAT,
  READING_LIMIT,
  instrumentAnchor,
  readResidentialStanding,
  type LandUseTable,
} from '../../planning/landUsePermissibility.pure.ts';
import { infrastructureEvidenceFrom, planningEvidenceFrom } from './planningEvidenceRecord.pure.ts';
import type { StrategySite } from '../investment/strategyPositions.pure.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The stored land use table, only where it was retrieved. */
function landUseOf(planning: unknown): LandUseTable | null {
  if (!isRecord(planning) || !isRecord(planning.landUse)) return null;
  const table = planning.landUse as unknown as LandUseTable;
  return table.status === 'retrieved' ? table : null;
}

/**
 * The strategic read's site reading from a stored `location_intelligence`, or
 * null where the row carries neither half.
 */
export function strategySiteFrom(locationIntelligence: unknown): StrategySite | null {
  const table = landUseOf(planningEvidenceFrom(locationIntelligence));
  const reading = table ? readResidentialStanding(table) : null;
  const landUse: StrategySite['landUse'] = table && reading
    ? {
      anchor: instrumentAnchor(table),
      dwellingHouse: reading.dwellingHouse,
      additional: reading.otherResidential.map((o) => ({ use: o.use, standing: o.standing })),
      caveat: EXISTING_DWELLING_CAVEAT,
      limit: READING_LIMIT,
    }
    : null;

  const infra = infrastructureEvidenceFrom(locationIntelligence);
  const d = isRecord(infra) && isRecord(infra.pipelineDwellings) ? infra.pipelineDwellings : null;
  const walk = isRecord(infra) && isRecord(infra.registerWalk) ? infra.registerWalk : null;
  const pipeline: StrategySite['pipeline'] = d && isNum(d.total) && d.total > 0
    ? {
      dwellings: d.total,
      council: str(d.council) ?? 'the local government area',
      window: str(d.window),
      rowsRead: walk && isNum(walk.rowsRead) ? walk.rowsRead : null,
      totalStated: walk && isNum(walk.totalStated) ? walk.totalStated : null,
    }
    : null;

  return landUse || pipeline ? { landUse, pipeline } : null;
}
