/**
 * Compose the Environmental Risks & Climate statistics block from what was
 * measured — replacing a template that attributed placeholder fallbacks to
 * the Bureau of Meteorology (`climateZone || 'Temperate'`,
 * `temperature?.annual || 'XX.X'`) and RATED hazards nothing measures
 * (`Storms | Moderate`, `Cyclones | Low` as literals; heatwave/bushfire/
 * flood falling back to asserted levels precisely when no assessment
 * existed).
 *
 * Rules:
 *  - climate figures come from the SILO reading with their windows named
 *    (the 1991–2020 normal; the recent 12 complete months compared like
 *    for like) and the interpolated-grid basis disclosed;
 *  - hazard rows render ONLY where the risk service returned a real level
 *    (AFRIP flood, state bushfire mapping) — a hazard nobody measured is
 *    not rated, and the block says so rather than leaving a blank the
 *    model would fill;
 *  - law 2 throughout: a labelled row promises a figure; an empty section
 *    is one honest line plus the no-invention instruction.
 */

interface Numericish { [key: string]: unknown }

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const fmt = (v: number) => v.toLocaleString('en-AU');

export interface ClimatePromptInput {
  climateData?: Numericish;
  riskAssessment?: Numericish;
}

export function climateProfileBlock(input: ClimatePromptInput): string {
  const c = input.climateData;
  const annual = num(c?.['annualRainfallNormalMm']);
  if (!c || annual === null) return '';
  const normalPeriod = str(c['normalPeriod']) ?? 'long-run';
  const src = `SILO (Qld Government), BoM-derived interpolated grid — ${normalPeriod} normals`;

  const month = (key: string, render: (m: Numericish) => string | null): string | null => {
    const rec = c[key] as Numericish | undefined;
    const name = rec ? str(rec['month']) : null;
    const v = rec ? render(rec) : null;
    return name && v !== null ? `${name} (${v})` : null;
  };
  const wettest = month('wettestMonth', (m) => (num(m['rain']) !== null ? `${fmt(num(m['rain'])!)} mm` : null));
  const driest = month('driestMonth', (m) => (num(m['rain']) !== null ? `${fmt(num(m['rain'])!)} mm` : null));
  const hottest = month('hottestMonth', (m) => (num(m['tMax']) !== null ? `mean max ${num(m['tMax'])}°C` : null));
  const coldest = month('coldestMonth', (m) => (num(m['tMin']) !== null ? `mean min ${num(m['tMin'])}°C` : null));
  const evap = num(c['annualEvaporationNormalMm']);

  const rows = [
    `| Annual rainfall (${normalPeriod} normal) | ${fmt(annual)} mm | ${src} |`,
    wettest ? `| Wettest month | ${wettest} | ${src} |` : null,
    driest ? `| Driest month | ${driest} | ${src} |` : null,
    hottest ? `| Hottest month | ${hottest} | ${src} |` : null,
    coldest ? `| Coldest month | ${coldest} | ${src} |` : null,
    evap !== null ? `| Annual pan evaporation (${normalPeriod} normal) | ${fmt(evap)} mm | ${src} |` : null,
  ].filter((r): r is string => r !== null);

  const parts = [`**Climate profile (measured at the property's grid cell):**\n\n| Metric | Value | Source |\n|---|---|---|\n${rows.join('\n')}`];

  const recent = c['recent'] as Numericish | null | undefined;
  const recentRain = num(recent?.['rainfallMm']);
  const recentNormal = num(recent?.['sameMonthsNormalMm']);
  const recentPeriod = str(recent?.['period']);
  if (recentRain !== null && recentNormal !== null && recentPeriod) {
    parts.push(
      `Recent conditions: ${fmt(recentRain)} mm fell over ${recentPeriod}, against a ${fmt(recentNormal)} mm normal for those same twelve calendar months` +
      (num(recent?.['meanTMax']) !== null && num(recent?.['meanTMaxNormal']) !== null
        ? `; mean daily maximum ${num(recent?.['meanTMax'])}°C against a ${num(recent?.['meanTMaxNormal'])}°C normal.`
        : '.'),
    );
  }
  const basis = str(c['coordinateBasis']);
  if (basis) parts.push(basis);
  return parts.join('\n\n');
}

export function hazardBlock(input: ClimatePromptInput): string {
  const r = input.riskAssessment;
  const rows: string[] = [];
  const hazard = (key: string, label: string) => {
    const h = r?.[key] as Numericish | undefined;
    const level = str(h?.['level']);
    if (!level || level.toLowerCase() === 'unknown') return;
    const description = str(h?.['description']) ?? '';
    rows.push(`| ${label} | ${level} | ${description} |`);
  };
  hazard('floodRisk', 'Flooding');
  hazard('bushfireRisk', 'Bushfire');
  if (rows.length === 0) return '';
  return `**Assessed hazards (from the risk services' own readings):**\n\n| Hazard | Assessment | Detail |\n|---|---|---|\n${rows.join('\n')}`;
}

export function climateStatBlocks(input: ClimatePromptInput): string {
  const parts = [climateProfileBlock(input), hazardBlock(input)].filter((b) => b !== '');

  if (parts.length === 0) {
    return 'No measured climate or hazard reading is available for this property. State that plainly in one sentence; do NOT print a climate table, name a climate zone, or rate any hazard.';
  }

  parts.push(
    'Discuss only the measured figures above, with their stated windows and sources. Do NOT name a climate zone classification, rate a hazard that does not appear in the table (storms, cyclones and heatwaves are unmeasured here), or assert trends the windows above cannot support. Where flood or bushfire is absent, direct verification to AFRIP and the state fire authority without asserting a level.',
  );
  return parts.join('\n\n');
}
