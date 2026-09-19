/**
 * Site & building metrics specific to industrial property.
 *
 *   site cover %      = building footprint (GLA proxy) / site area
 *   office ratio %    = office portion of GLA / total GLA
 *   $/sqm GLA         = price / GLA
 *   $/sqm site        = price / site area
 *   hardstand ratio % = hardstand sqm / site area
 *   coverage band     = under-developed | balanced | over-developed
 */
export interface SiteMetricsInputs {
  glaSqm: number;
  siteAreaSqm: number;
  hardstandSqm?: number;
  officePct?: number; // 0-100
  price?: number;
}

export interface SiteMetricsResult {
  siteCoverPct: number;
  hardstandRatioPct: number;
  pricePerSqmGla: number;
  pricePerSqmSite: number;
  officePct: number;
  coverageBand: 'under-developed' | 'balanced' | 'over-developed' | 'n/a';
}

export function calcSiteMetrics(inputs: SiteMetricsInputs): SiteMetricsResult {
  const gla = inputs.glaSqm || 0;
  const site = inputs.siteAreaSqm || 0;
  const hardstand = inputs.hardstandSqm || 0;
  const price = inputs.price || 0;

  const siteCover = site > 0 ? (gla / site) * 100 : 0;
  const hardstandRatio = site > 0 ? (hardstand / site) * 100 : 0;
  const ppGla = gla > 0 ? price / gla : 0;
  const ppSite = site > 0 ? price / site : 0;

  let band: SiteMetricsResult['coverageBand'] = 'n/a';
  if (site > 0) {
    if (siteCover < 35) band = 'under-developed';
    else if (siteCover <= 60) band = 'balanced';
    else band = 'over-developed';
  }

  return {
    siteCoverPct: Number(siteCover.toFixed(2)),
    hardstandRatioPct: Number(hardstandRatio.toFixed(2)),
    pricePerSqmGla: Number(ppGla.toFixed(2)),
    pricePerSqmSite: Number(ppSite.toFixed(2)),
    officePct: Number((inputs.officePct ?? 0).toFixed(2)),
    coverageBand: band,
  };
}
