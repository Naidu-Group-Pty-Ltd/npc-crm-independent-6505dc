/**
 * Australian postcode proximity utility.
 * Groups postcodes by geographic region to enable "nearby suburbs" filtering.
 * 
 * Australian postcodes follow a geographic pattern:
 * - First digit = state/territory
 * - First two digits = broad region
 * - Nearby postcodes are numerically close within the same region
 */

// Postcode ranges by state
const STATE_POSTCODE_RANGES: Record<string, [number, number][]> = {
  'NSW': [[2000, 2599], [2619, 2899], [2921, 2999]],
  'ACT': [[2600, 2618], [2900, 2920]],
  'VIC': [[3000, 3999]],
  'QLD': [[4000, 4999]],
  'SA':  [[5000, 5799]],
  'WA':  [[6000, 6797]],
  'TAS': [[7000, 7799]],
  'NT':  [[800, 899]],
};

/**
 * Get postcodes within a ± range of a given postcode,
 * staying within the same state boundary.
 */
export function getNearbyPostcodes(
  postcode: string,
  range: number = 15
): string[] {
  const pc = parseInt(postcode, 10);
  if (isNaN(pc)) return [postcode];

  // Find which state range this postcode belongs to
  let stateRanges: [number, number][] | null = null;
  for (const ranges of Object.values(STATE_POSTCODE_RANGES)) {
    for (const [min, max] of ranges) {
      if (pc >= min && pc <= max) {
        stateRanges = ranges;
        break;
      }
    }
    if (stateRanges) break;
  }

  if (!stateRanges) return [postcode];

  const nearby: string[] = [];
  for (let i = pc - range; i <= pc + range; i++) {
    // Check if this postcode falls within any range for the same state
    for (const [min, max] of stateRanges) {
      if (i >= min && i <= max) {
        nearby.push(i.toString().padStart(4, '0'));
        break;
      }
    }
  }

  return nearby;
}

/**
 * Given a suburb and all listings, find the postcode for that suburb,
 * then return all suburbs that share a nearby postcode.
 */
export function getNearbySuburbs(
  selectedSuburb: string,
  allListings: Array<{ suburb?: string; zipCode?: string }>,
  range: number = 15
): string[] {
  // Find the postcode(s) for the selected suburb
  const suburbPostcodes = new Set<string>();
  for (const listing of allListings) {
    if (listing.suburb?.toLowerCase() === selectedSuburb.toLowerCase() && listing.zipCode) {
      suburbPostcodes.add(listing.zipCode);
    }
  }

  if (suburbPostcodes.size === 0) return [selectedSuburb];

  // Get all nearby postcodes
  const allNearbyPostcodes = new Set<string>();
  for (const pc of suburbPostcodes) {
    for (const nearby of getNearbyPostcodes(pc, range)) {
      allNearbyPostcodes.add(nearby);
    }
  }

  // Find all suburbs that have any of these nearby postcodes
  const nearbySuburbs = new Set<string>();
  nearbySuburbs.add(selectedSuburb); // Always include the selected suburb
  for (const listing of allListings) {
    if (listing.zipCode && allNearbyPostcodes.has(listing.zipCode) && listing.suburb) {
      nearbySuburbs.add(listing.suburb);
    }
  }

  return Array.from(nearbySuburbs).sort();
}
