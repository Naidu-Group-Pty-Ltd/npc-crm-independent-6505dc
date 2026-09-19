/**
 * Industrial rent quoted per sqm of GLA.
 * Conversions between gross / net and pa / total.
 */

export interface RentPerSqmInputs {
  /** Annual base rent for the unit/tenancy */
  baseRentPa: number;
  /** Gross Lettable Area (GLA) in sqm */
  glaSqm: number;
  /** Annual outgoings allocated to the tenancy (for net→gross conversion) */
  outgoingsPa?: number;
}

export interface RentPerSqmResult {
  netRentPerSqmPa: number;
  grossRentPerSqmPa: number;
  outgoingsPerSqmPa: number;
}

export function calcRentPerSqm({ baseRentPa, glaSqm, outgoingsPa = 0 }: RentPerSqmInputs): RentPerSqmResult {
  if (!glaSqm || glaSqm <= 0) return { netRentPerSqmPa: 0, grossRentPerSqmPa: 0, outgoingsPerSqmPa: 0 };
  const net = Number(((baseRentPa || 0) / glaSqm).toFixed(2));
  const outg = Number(((outgoingsPa || 0) / glaSqm).toFixed(2));
  const gross = Number((net + outg).toFixed(2));
  return { netRentPerSqmPa: net, grossRentPerSqmPa: gross, outgoingsPerSqmPa: outg };
}

/** Inverse — given $/sqm and GLA, return annual rent. */
export function rentFromPerSqm(perSqmPa: number, glaSqm: number): number {
  return Number(((perSqmPa || 0) * (glaSqm || 0)).toFixed(2));
}
