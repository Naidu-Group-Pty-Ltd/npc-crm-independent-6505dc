#!/usr/bin/env node
/**
 * The planning and infrastructure chapters, composed from the real evidence.
 *
 * Runs the PRODUCTION modules — `buildPlanningFacts`, `renderPlanningControls`,
 * `planningFactBlocks`, `projectsNear`, `renderPublishedProjects` — against a
 * `planning-data-service` answer built from the registers that actually
 * answered for 48 Redfern Street, Cowra on 19 September 2026.
 *
 * WHAT THIS IS AND IS NOT. It executes the candidate's composition path with
 * real, retrieved evidence, so what it prints is what the chapter will contain.
 * It is NOT a fresh generation: the acquisition that would fetch this evidence
 * runs in a deployed edge function, and these changes are on an unmerged
 * branch. Stage C's deploy gates are what make the acquisition fresh.
 */
import { writeFileSync } from 'node:fs';

const { buildPlanningFacts, renderPlanningControls, planningFactBlocks } = await import(
  '../../supabase/functions/_shared/planning/planningFacts.pure.ts'
);
const { parseNswPermissibility } = await import(
  '../../supabase/functions/_shared/planning/landUsePermissibility.pure.ts'
);
const { projectsNear, renderPublishedProjects, publishedProjectRules, PUBLISHED_PROJECT_COVERAGE } =
  await import('../../supabase/functions/_shared/planning/publishedProjectRegister.pure.ts');

const AT = '2026-09-19T03:10:00.000Z';
const LAT = -33.824993, LNG = 148.683685;

// The permissibility service's own answer for Cowra LEP 2012 zone E3, as
// retrieved. Trimmed to the uses the reading turns on and kept in the
// service's shape, duplicates included.
const e3 = [{
  EPIName: 'Cowra Local Environmental Plan 2012',
  Precinct: [{ Name: '', Zone: [{
    ZoneCode: 'E3',
    ZoneDescription: 'Environmental Management',
    ZoneObjective: ' To provide a range of facilities and services, light industries, warehouses and offices.  To provide for land uses that are compatible with, but do not compete with, land uses in surrounding local and commercial centres.  To maintain the economic viability of local and commercial centres by limiting certain retail and commercial activity.  To ensure commercial development in the Redfern Street area and at the Cowra Airport is consistent with the commercial hierarchy of the Cowra township and does not involve major retailing activities or detract from the core commercial functions of the Cowra central business district. ',
    LandUse: [{
      PermittedWithoutConsent: ['Environmental Protection Works', 'Home Occupations', 'Roads']
        .flatMap((n) => [{ Landuse: n }, { Landuse: n }]),
      PermittedWithConsent: ['Business Premises', 'Depots', 'Dwelling Houses', 'Garden Centres',
        'Hardware And Building Supplies', 'Light Industries', 'Local Distribution Premises',
        'Neighbourhood Shops', 'Office Premises', 'Service Stations', 'Shop Top Housing',
        'Storage Premises', 'Timber Yards', 'Vehicle Body Repair Workshops', 'Vehicle Repair Stations',
        'Vehicle Sales Or Hire Premises', 'Veterinary Hospitals', 'Warehouse Or Distribution Centres',
        'Any Other Development Not Specified In Item 2 Or 4']
        .flatMap((n) => [{ Landuse: n }, { Landuse: n }]),
      Prohibited: ['Agriculture', 'Caravan Parks', 'Entertainment Facilities', 'Exhibition Homes',
        'Industries', 'Registered Clubs', 'Residential Accommodation', 'Shops',
        'Tourist And Visitor Accommodation']
        .flatMap((n) => [{ Landuse: n }, { Landuse: n }]),
    }],
  }] }],
}];

// The answer `planning-data-service` composes from what the registers returned.
const planningData = {
  jurisdiction: 'NSW',
  coordinate: { latitude: LAT, longitude: LNG },
  zoning: {
    status: 'ok', jurisdiction: 'NSW', zoneCode: 'E3', zoneLabel: 'Productivity Support',
    instrument: 'Cowra Local Environmental Plan 2012', lga: 'COWRA',
    currencyDate: '2025-08-08', zoneFamily: 'Employment',
    source: 'NSW Planning Portal — Principal Planning Layers', licence: 'CC BY 4.0',
  },
  landUse: parseNswPermissibility(e3, 'E3', AT),
  parcel: {
    status: 'ok', lotPlan: '19/5/DP977420', lga: 'Cowra', locality: 'Cowra',
    area: 990.9, areaBasis: 'computed',
  },
  constraints: [{
    family: 'groundwater', kind: 'protection', label: 'Groundwater Vulnerability',
    code: null, value: 'Groundwater Vulnerable', clause: null, detail: null,
    instrument: 'Cowra Local Environmental Plan 2012',
    // The publisher's own currency date for this layer, not the day we asked.
    currencyDate: '2013-01-25',
    source: 'NSW Planning Portal — Protection', licence: 'CC BY 4.0',
    standing: 'adopted', retrievedAt: AT,
  }],
  constraintsAsked: ['bushfire', 'flood', 'landslide', 'heritage', 'height', 'minimumLotSize',
    'floorSpaceRatio', 'acidSulfateSoils', 'airportNoise', 'drinkingWaterCatchment', 'groundwater',
    'mineralResource', 'riparian', 'salinity', 'scenicProtection', 'biodiversity', 'wetlands',
    'environmentallySensitive', 'acquisition', 'dwellingDensity', 'foreshoreBuildingLine'],
  constraintRegisters: {
    answered: ['NSW Planning Portal — Principal Planning Layers',
      'NSW Planning Portal — Hazard', 'NSW Planning Portal — Protection'],
    unavailable: [],
  },
  developmentInstruments: { status: 'not_served', note: 'New South Wales publishes no state development instrument layer.' },
  developmentActivity: { status: 'not_served', note: 'The council DA register was not read for this demonstration.' },
  investmentProgramme: { status: 'not_served', note: 'New South Wales publishes its forward programme as budget papers rather than a feed.' },
  verification: 'A spatial layer is indicative; what settles the question is a s10.7 planning certificate from Cowra Shire Council.',
  fetchedAt: AT,
};

const facts = buildPlanningFacts({ planningData, overrides: {} });
const near = projectsNear(LAT, LNG, 15);

const out = [
  '# 48 Redfern Street, Cowra NSW 2794 — the two rebuilt chapters',
  '',
  'Composed by the production modules from the registers that answered on',
  '19 September 2026. Every figure below is retrieved or absent; nothing here is',
  'written by a model.',
  '',
  '---',
  '',
  '## Zoning, Planning and Development Considerations',
  '',
  renderPlanningControls(facts),
  '',
  '---',
  '',
  '## Major public projects near this property',
  '',
  renderPublishedProjects(near),
  `**What this register covers.** ${PUBLISHED_PROJECT_COVERAGE.join(' ')}`,
  '',
  '---',
  '',
  '## The rules the prose is written under',
  '',
  '### Planning',
  '',
  '```',
  planningFactBlocks(facts),
  '```',
  '',
  '### Published projects',
  '',
  '```',
  publishedProjectRules(near),
  '```',
  '',
].join('\n');

writeFileSync('docs/reports/COWRA_REBUILT_CHAPTERS.md', out);
console.log('Wrote docs/reports/COWRA_REBUILT_CHAPTERS.md');
console.log(`  zone: ${facts.zoning.value} | land use table: ${facts.landUse.status}`);
console.log(`  dwelling house: ${facts.residential?.dwellingHouse} | residential group prohibited: ${facts.residential?.residentialGroupProhibited}`);
console.log(`  parcel: ${facts.lotPlan} | ${facts.parcelAreaSqm} m² (${facts.parcelAreaBasis})`);
console.log(`  projects within 15 km: ${near.length}`);
