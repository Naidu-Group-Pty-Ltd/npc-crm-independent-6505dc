/**
 * Bushfire and flood, as the hazard maps read at the property answered.
 *
 * ## What was wrong
 *
 * The 37 Bolin Street suite (27 Sep 2026) printed bushfire and flood as
 * "Not assessed" in every risk register, and its Environment section said "a
 * specific flood or bushfire risk level has not been established", although
 * the NSW Planning Portal's hazard maps had been asked at the lot and had
 * answered — nothing mapped. Two things were lost between the answer and the
 * page:
 *
 *  - The Environment section's hazard table was fed ONLY by the older
 *    `risk-assessment-service`, which the generator calls without the
 *    property's coordinate, so it answers "Unknown" by construction and the
 *    table never drew. The planning answer sat one module away, unread.
 *  - The register's rule could not tell two very different absences apart. A
 *    STATUTORY DESIGNATION published for the whole state that shows nothing
 *    over a lot says the lot is not designated — in NSW, the Bush Fire Prone
 *    Land map is what the planning certificate reports and what switches on
 *    the bush fire provisions for building — while a map that only some
 *    councils publish into says nothing about the councils that did not.
 *    Both became "Not assessed".
 *
 * ## The rules
 *
 * 1. **A reading is what the map answered, at this point.** `mapped` carries
 *    the publisher's own label; `not_mapped` is a map that was asked and
 *    answered nothing; `not_checked` is a map that was never asked or could not
 *    be reached, which is evidence of nothing.
 * 2. **An absence is a finding only where the map is the designation.**
 *    `HAZARD_DESIGNATION` names, per jurisdiction and hazard, whether the map
 *    read is the complete statutory designation. Only then does `not_mapped`
 *    become "Not mapped" in the register, with evidence "Verified". Everywhere
 *    else it stays "Not assessed", with the reason in words — never Low.
 * 3. **Nothing here rates a hazard.** "Mapped" and "Not mapped" state what the
 *    map shows; neither is a position on a scale, and neither may be drawn on
 *    a chart.
 *
 * Pure: types and constants in, sentences out.
 */
import {
  ACT_BPA_SOURCE,
  NSW_HAZARD_SOURCE,
  VIC_BPA_SOURCE,
  WA_BUSHFIRE_SOURCE,
  type ConstraintFamily,
  type PlanningConstraintReading,
} from './planningConstraints.pure.ts';
import type { PlanningJurisdiction } from './planningSources.pure.ts';
import { auDate } from './auDate.pure.ts';

export type HazardFamily = 'bushfire' | 'flood';
export const HAZARD_FAMILIES: readonly HazardFamily[] = ['bushfire', 'flood'];

export type HazardState = 'mapped' | 'not_mapped' | 'not_checked';

/** What a map IS, for one hazard in one jurisdiction. */
export interface HazardDesignation {
  /** The map, as a reader would name it. */
  map: string;
  /**
   * True only where the map is the complete statutory designation for the
   * whole jurisdiction, so that nothing mapped over a lot is a statement that
   * the lot is not designated.
   */
  complete: boolean;
  /**
   * The register, as the planning answer names it, that IS the designation.
   * A complete designation counts only where this register answered: the
   * family can be "asked" through another register (Victoria's planning
   * overlays ask bushfire through the BMO), and that answer says nothing about
   * the designation map.
   */
  register?: string;
  /** What "nothing mapped" means here, in one or two sentences. */
  absence: string;
  /** What settles it for the lot. */
  settles: string;
}

/**
 * The designations this report can speak to.
 *
 * Deliberately short. A jurisdiction or hazard not listed falls back to the
 * generic partial reading, which never lets an absence become a finding —
 * the conservative side, because calling a partial map a designation would
 * tell a buyer a lot is clear on the strength of a map that never covered it.
 */
export const HAZARD_DESIGNATION: Partial<Record<PlanningJurisdiction, Partial<Record<HazardFamily, HazardDesignation>>>> = {
  NSW: {
    bushfire: {
      map: 'the NSW Bush Fire Prone Land map',
      complete: true,
      register: NSW_HAZARD_SOURCE,
      absence: 'The property is not mapped as bush fire prone land. That map is the statutory designation a NSW '
        + 'planning certificate reports, and it decides whether the bush fire provisions apply to building on the lot.',
      settles: 'The s. 10.7 planning certificate states the designation for the lot; an insurer or a bush fire '
        + 'consultant assesses the risk itself, which a map does not.',
    },
    flood: {
      map: 'the flood planning map published through the NSW Planning Portal',
      complete: false,
      absence: 'That map holds the flood planning areas councils have published into it, and many councils hold '
        + 'their flood mapping elsewhere — in flood studies and development control plans — so nothing mapped there is '
        + 'not a finding that the lot is free of flooding.',
      settles: 'The s. 10.7 planning certificate states any flood-related development controls for the lot, and the '
        + 'council can provide its flood information for the property.',
    },
  },
  VIC: {
    bushfire: {
      map: 'the Victorian bushfire prone area map',
      complete: true,
      register: VIC_BPA_SOURCE,
      absence: 'The property is not in a designated bushfire prone area. That map is the statutory designation made '
        + 'for the building regulations, and it decides whether bushfire construction requirements apply to building '
        + 'on the lot; the planning scheme’s Bushfire Management Overlay is a separate control, read with the overlays.',
      settles: 'The designation is confirmed when a building permit is sought; an insurer or a bushfire consultant '
        + 'assesses the risk itself, which a map does not.',
    },
  },
  ACT: {
    bushfire: {
      map: 'the ACT Bushfire Prone Area map',
      complete: true,
      register: ACT_BPA_SOURCE,
      absence: 'The property is not in the Territory’s bushfire prone area. That map is the designation that decides '
        + 'whether bushfire construction requirements apply to building on the lot.',
      settles: 'The designation is confirmed when building approval is sought; an insurer or a bushfire consultant '
        + 'assesses the risk itself, which a map does not.',
    },
  },
  WA: {
    bushfire: {
      map: 'the Map of Bush Fire Prone Areas designated by the Fire and Emergency Services Commissioner',
      complete: true,
      register: WA_BUSHFIRE_SOURCE,
      absence: 'The property is not in a designated bush fire prone area. That map is the statutory designation, and '
        + 'it decides whether the bush fire provisions of the building and planning framework apply to the lot.',
      settles: 'The designation is confirmed against the current map when a building or planning application is '
        + 'lodged; an insurer or a bush fire consultant assesses the risk itself.',
    },
  },
};

const HAZARD_LABEL: Record<HazardFamily, string> = { bushfire: 'Bushfire', flood: 'Flood' };

const GENERIC: Record<HazardFamily, HazardDesignation> = {
  bushfire: {
    map: 'the published bushfire map read for this property',
    complete: false,
    absence: 'That map is not the complete designation for this jurisdiction, so nothing mapped there is not a '
      + 'finding that the lot is outside a bushfire-prone area.',
    settles: 'The planning certificate or the state fire authority’s designation map settles the designation '
      + 'for the lot.',
  },
  flood: {
    map: 'the published flood map read for this property',
    complete: false,
    absence: 'Flood mapping is published by councils and state agencies in different places, so nothing mapped on '
      + 'that map is not a finding that the lot is free of flooding.',
    settles: 'The planning certificate and the council’s flood information settle it for the lot.',
  },
};

/**
 * The designation a reading may speak for. Given the registers that answered,
 * a complete designation whose own register did not answer is not the map
 * that was read, so the generic partial reading stands in — the conservative
 * side. Without that list (a caller asking what a jurisdiction publishes) the
 * declared designation is returned.
 */
export function designationFor(
  jurisdiction: string | null | undefined,
  family: HazardFamily,
  answered?: readonly string[],
): HazardDesignation {
  const j = (jurisdiction ?? '').toUpperCase() as PlanningJurisdiction;
  const declared = HAZARD_DESIGNATION[j]?.[family];
  if (!declared) return GENERIC[family];
  if (answered && declared.complete && declared.register && !answered.includes(declared.register)) {
    return GENERIC[family];
  }
  return declared;
}

/** The planning evidence this reads — the fields of `PlanningFacts` it needs, and no more. */
export interface HazardEvidence {
  jurisdiction: string | null;
  constraints: readonly PlanningConstraintReading[];
  constraintsAsked: readonly ConstraintFamily[];
  constraintRegisters: { answered: readonly string[]; unavailable: readonly string[] };
  retrievedAt: string | null;
  /** True where the maps were read at a point that is not the lot itself. */
  pointNotPlaced?: boolean;
}

export interface HazardReading {
  family: HazardFamily;
  label: string;
  state: HazardState;
  designation: HazardDesignation;
  /** The publisher's own labels for what is mapped, where anything is. */
  mapped: string[];
  /** The registers that answered, as the planning table names them. */
  source: string | null;
  checkedOn: string | null;
  /** What the Environment section's hazard table prints in the "Finding" cell. */
  finding: string;
  /** The register row, in the register's two vocabularies. */
  exposure: 'Mapped' | 'Not mapped' | 'Not assessed';
  evidence: 'Verified' | 'Unverified' | 'Not checked';
  /** One sentence a reader is given, and what settles it. */
  sentence: string;
}

/**
 * Bushfire and flood, always both, in that order.
 *
 * A map read at a point that could not be placed on the lot is `not_checked`:
 * it describes somewhere else.
 */
export function hazardReadings(facts: HazardEvidence | null | undefined): HazardReading[] {
  if (!facts) return [];
  const asked = new Set(facts.constraintsAsked);
  const source = facts.constraintRegisters.answered.length ? facts.constraintRegisters.answered.join('; ') : null;
  const checkedOn = facts.retrievedAt ? auDate(facts.retrievedAt) : null;
  return HAZARD_FAMILIES.map((family): HazardReading => {
    const designation = designationFor(facts.jurisdiction, family, facts.constraintRegisters.answered);
    const hits = facts.constraints.filter((c) => c.family === family);
    const label = HAZARD_LABEL[family];
    if (facts.pointNotPlaced || (!hits.length && !asked.has(family))) {
      return {
        family, label, state: 'not_checked', designation, mapped: [], source: null, checkedOn: null,
        finding: 'Not checked for this property',
        exposure: 'Not assessed', evidence: 'Not checked',
        sentence: `No ${family} map was checked for this property, so nothing here says whether the lot is affected. `
          + designation.settles,
      };
    }
    const when = checkedOn ? `, checked ${checkedOn}` : '';
    if (hits.length) {
      const mapped = [...new Set(hits.map((h) => [h.label, h.value, h.detail].filter(Boolean).join(' · ')))];
      return {
        family, label, state: 'mapped', designation, mapped, source, checkedOn,
        finding: `Mapped: ${mapped.join('; ')}`,
        exposure: 'Mapped', evidence: 'Verified',
        sentence: `${designation.map.charAt(0).toUpperCase()}${designation.map.slice(1)} maps the property: `
          + `${mapped.join('; ')}${when}. A published map is indicative at its scale. ${designation.settles}`,
      };
    }
    return {
      family, label, state: 'not_mapped', designation, mapped: [], source, checkedOn,
      finding: designation.complete
        ? `Not mapped on ${designation.map}${when}`
        : `Nothing mapped on ${designation.map}${when}; not a complete record`,
      exposure: designation.complete ? 'Not mapped' : 'Not assessed',
      evidence: designation.complete ? 'Verified' : 'Unverified',
      sentence: `${designation.map.charAt(0).toUpperCase()}${designation.map.slice(1)} was checked at the property`
        + `${when} and shows nothing over it. ${designation.absence} ${designation.settles}`,
    };
  });
}

/**
 * What the Environment section's hazard table prints, one row per hazard the
 * maps answered. A hazard nobody checked draws no row: its absence is said
 * once, in the sentence, rather than as a row that reads like a result.
 */
export function hazardTableRows(readings: readonly HazardReading[]): string[] {
  return readings
    .filter((r) => r.state !== 'not_checked')
    .map((r) => `| ${r.label} | ${r.finding.replace(/\|/g, '/')} | ${(r.source ?? r.designation.map).replace(/\|/g, '/')} |`);
}

/**
 * The register row each hazard reads, handed over the way `unratedRiskRow`
 * hands over crime and transport: the permitted form beside the prohibition,
 * in the register's own two vocabularies.
 */
export function hazardRegisterRules(readings: readonly HazardReading[]): string {
  if (!readings.length) return '';
  const rows = readings.map((r) => `the ${r.label} row reads "${r.exposure}" with evidence "${r.evidence}"`);
  return `In the Risk Dashboard's register ${rows.join(', and ')}. These are what the hazard maps showed at the `
    + 'property, not ratings: never write Low, Minimal or Negligible for a hazard, never draw either on a chart, '
    + 'and where a detail block is written for one, its Finding is the sentence given for it in the hazard table and '
    + 'its Next check is what settles it for the lot.';
}
