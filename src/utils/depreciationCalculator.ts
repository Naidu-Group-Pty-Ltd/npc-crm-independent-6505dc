import { 
  DepreciationInput, 
  DepreciationComp, 
  DepreciationResult, 
  ScoredComp 
} from '@/types/depreciation';

const MIN_COMPS_REQUIRED = 5;
const MAX_COMPS_TO_USE = 25;
const TOTAL_DEPRECIATION_YEARS = 10; // We have 10 years of data in comps

/**
 * Step A: Hard filter comps by exact match criteria
 */
function hardFilterComps(comps: DepreciationComp[], input: DepreciationInput): DepreciationComp[] {
  return comps.filter(comp => 
    comp.purchase_date_category === input.purchaseDateCategory &&
    comp.property_type === input.propertyType &&
    comp.finish_standard === input.finishStandard &&
    comp.nearest_city === input.nearestCity &&
    !comp.renovated &&
    !comp.fully_furnished
  );
}

/**
 * Step B: Score each comp based on price and build year similarity
 * Price similarity: 60% weight
 * Build year similarity: 40% weight
 */
function scoreComps(comps: DepreciationComp[], input: DepreciationInput): ScoredComp[] {
  return comps.map(comp => {
    // Price similarity: 1 - min(|P_user - P_comp| / P_user, 1)
    const priceDiff = Math.abs(input.purchasePrice - comp.purchase_price);
    const priceScore = Math.max(0, 1 - Math.min(priceDiff / input.purchasePrice, 1));
    
    // Build year similarity: 1 - min(|Y_user - Y_comp| / 20, 1) - cap within 20 years
    const yearDiff = Math.abs(input.buildYear - comp.build_year);
    const yearScore = Math.max(0, 1 - Math.min(yearDiff / 20, 1));
    
    // Weighted total: 60% price, 40% year
    const score = (priceScore * 0.6) + (yearScore * 0.4);
    
    return { ...comp, score };
  });
}

/**
 * Step C: Select top k comps (up to 25)
 */
function selectTopComps(scoredComps: ScoredComp[]): ScoredComp[] {
  return scoredComps
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMPS_TO_USE);
}

/**
 * Step D: Calculate weighted average for each year
 */
function blendResults(comps: ScoredComp[]): { dv: number[]; pc: number[] } {
  const totalWeight = comps.reduce((sum, c) => sum + c.score, 0);
  
  if (totalWeight === 0) {
    return { dv: Array(10).fill(0), pc: Array(10).fill(0) };
  }
  
  const dv: number[] = [];
  const pc: number[] = [];
  
  for (let year = 1; year <= 10; year++) {
    const dvKey = `dv_year${year}` as keyof DepreciationComp;
    const pcKey = `pc_year${year}` as keyof DepreciationComp;
    
    let dvSum = 0;
    let pcSum = 0;
    
    for (const comp of comps) {
      dvSum += (comp[dvKey] as number) * comp.score;
      pcSum += (comp[pcKey] as number) * comp.score;
    }
    
    dv.push(dvSum / totalWeight);
    pc.push(pcSum / totalWeight);
  }
  
  return { dv, pc };
}

/**
 * Step E: Scale results by purchase price ratio
 */
function scaleByPrice(
  results: { dv: number[]; pc: number[] }, 
  comps: ScoredComp[], 
  userPrice: number
): { dv: number[]; pc: number[] } {
  const avgCompPrice = comps.reduce((sum, c) => sum + c.purchase_price, 0) / comps.length;
  const scale = userPrice / avgCompPrice;
  
  return {
    dv: results.dv.map(v => Math.max(0, v * scale)),
    pc: results.pc.map(v => Math.max(0, v * scale)),
  };
}

/**
 * Calculate property age in years from build year to current year
 */
function calculatePropertyAge(buildYear: number, calculationYear: number = new Date().getFullYear()): number {
  return Math.max(0, calculationYear - buildYear);
}

/**
 * Age-adjust the depreciation schedule.
 * 
 * For a property built in 2016 (9 years old in 2025):
 * - We start at Year 9 of the depreciation curve (or closest available)
 * - Years 1-8 have already been "consumed"
 * - We project forward from Year 9, 10, then extrapolate beyond if needed
 * 
 * For properties older than 10 years:
 * - Division 40 (plant/equipment) is mostly depleted, use minimal values
 * - Division 43 (building at 2.5%) continues for up to 40 years post-1987
 */
function ageAdjustSchedule(
  scaledResults: { dv: number[]; pc: number[] },
  propertyAge: number,
  userPrice: number
): { dv: number[]; pc: number[]; startingYear: number; isExtrapolated: boolean } {
  // If property is brand new (age 0 or 1), use Year 1 as starting point
  if (propertyAge <= 0) {
    return {
      dv: scaledResults.dv,
      pc: scaledResults.pc,
      startingYear: 1,
      isExtrapolated: false,
    };
  }

  const adjustedDv: number[] = [];
  const adjustedPc: number[] = [];
  
  // Calculate starting year index (0-based) - property age maps to which "year" we're in
  // Age 1 = currently in Year 1 → next claim is Year 2 → start at index 1
  // Age 9 = currently in Year 9 → next claim is Year 10 → start at index 9
  const startingYearIndex = Math.min(propertyAge, TOTAL_DEPRECIATION_YEARS - 1);
  const startingYear = startingYearIndex + 1; // 1-based for display
  const isExtrapolated = propertyAge >= TOTAL_DEPRECIATION_YEARS;

  console.log(`📅 Age adjustment: Property is ${propertyAge} years old, starting from Year ${startingYear}${isExtrapolated ? ' (extrapolated)' : ''}`);

  for (let i = 0; i < TOTAL_DEPRECIATION_YEARS; i++) {
    const sourceIndex = startingYearIndex + i;
    
    if (sourceIndex < TOTAL_DEPRECIATION_YEARS) {
      // We have actual data for this year
      adjustedDv.push(scaledResults.dv[sourceIndex]);
      adjustedPc.push(scaledResults.pc[sourceIndex]);
    } else {
      // Beyond Year 10 - need to extrapolate
      // Division 40 (plant/equipment): Use minimal declining value (most items fully depreciated)
      // Division 43 (building): 2.5% of construction cost continues
      
      // Estimate construction cost as ~60-70% of purchase price for older properties
      const estimatedConstructionCost = userPrice * 0.65;
      const annualDiv43 = estimatedConstructionCost * 0.025; // 2.5% per year
      
      // Diminishing value: Very small residual for any remaining plant items
      // Use last known value and decay it by ~20% per year
      const lastKnownDv = scaledResults.dv[TOTAL_DEPRECIATION_YEARS - 1];
      const yearsExtrapolated = sourceIndex - TOTAL_DEPRECIATION_YEARS + 1;
      const extrapolatedDv = lastKnownDv * Math.pow(0.80, yearsExtrapolated);
      
      // Prime cost: Primarily Division 43 building allowance
      // Very minimal plant/equipment remaining after 10 years
      const extrapolatedPc = annualDiv43 * 0.4; // Building allowance portion only
      
      adjustedDv.push(Math.max(0, extrapolatedDv));
      adjustedPc.push(Math.max(0, extrapolatedPc));
      
      console.log(`  📊 Year ${i + 1} (extrapolated from comp Year ${sourceIndex + 1}): DV=$${Math.round(extrapolatedDv)}, PC=$${Math.round(extrapolatedPc)}`);
    }
  }

  return {
    dv: adjustedDv,
    pc: adjustedPc,
    startingYear,
    isExtrapolated,
  };
}

/**
 * Round to nearest $1,000 for display
 */
export function roundToThousand(value: number): number {
  return Math.round(value / 1000) * 1000;
}

/**
 * Main calculation function with age-adjusted projections
 */
export function calculateDepreciation(
  allComps: DepreciationComp[], 
  input: DepreciationInput
): DepreciationResult | null {
  const currentYear = new Date().getFullYear();
  const propertyAge = calculatePropertyAge(input.buildYear, currentYear);
  
  console.group('🧮 Depreciation Calculation Debug');
  console.log('📊 Input Parameters:', {
    purchasePrice: input.purchasePrice,
    buildYear: input.buildYear,
    propertyAge: propertyAge,
    currentYear: currentYear,
    purchaseDateCategory: input.purchaseDateCategory,
    propertyType: input.propertyType,
    finishStandard: input.finishStandard,
    nearestCity: input.nearestCity,
    renovated: input.renovated,
    fullyFurnished: input.fullyFurnished,
  });
  console.log('📦 Total comps received from database:', allComps.length);
  
  // Validate comps data
  if (!allComps || allComps.length === 0) {
    console.error('❌ No comps data received from database!');
    console.groupEnd();
    return null;
  }
  
  // Log sample of comps to verify structure
  console.log('🔍 Sample comp structure (first record):', allComps[0]);
  
  // Step A: Hard filter
  let filtered = hardFilterComps(allComps, input);
  console.log('Step A - Hard filter results:', filtered.length, 'comps');
  
  // Debug: Check what's in the data that doesn't match
  if (filtered.length < MIN_COMPS_REQUIRED) {
    const uniqueCategories = [...new Set(allComps.map(c => c.purchase_date_category))];
    const uniqueTypes = [...new Set(allComps.map(c => c.property_type))];
    const uniqueFinish = [...new Set(allComps.map(c => c.finish_standard))];
    const uniqueCities = [...new Set(allComps.map(c => c.nearest_city))];
    
    console.warn('⚠️ Not enough matches after hard filter. Available values in database:');
    console.log('  - purchase_date_categories:', uniqueCategories);
    console.log('  - property_types:', uniqueTypes);
    console.log('  - finish_standards:', uniqueFinish);
    console.log('  - nearest_cities:', uniqueCities);
    
    // Check each filter individually
    const byCategory = allComps.filter(c => c.purchase_date_category === input.purchaseDateCategory);
    const byType = allComps.filter(c => c.property_type === input.propertyType);
    const byFinish = allComps.filter(c => c.finish_standard === input.finishStandard);
    const byCity = allComps.filter(c => c.nearest_city === input.nearestCity);
    
    console.log('  Filter breakdown:');
    console.log(`    - Matching purchase_date_category "${input.purchaseDateCategory}":`, byCategory.length);
    console.log(`    - Matching property_type "${input.propertyType}":`, byType.length);
    console.log(`    - Matching finish_standard "${input.finishStandard}":`, byFinish.length);
    console.log(`    - Matching nearest_city "${input.nearestCity}":`, byCity.length);
  }
  
  // Fallback: If townhouse has no matches, try house data
  if (filtered.length < MIN_COMPS_REQUIRED && input.propertyType === 'townhouse') {
    const fallbackInput = { ...input, propertyType: 'house' as const };
    filtered = hardFilterComps(allComps, fallbackInput);
    console.log(`🔄 Townhouse fallback: Using house data (${filtered.length} comps found)`);
  }
  
  // Step B: Score
  const scored = scoreComps(filtered, input);
  console.log('Step B - Scored comps:', scored.length);
  if (scored.length > 0) {
    const scores = scored.map(c => c.score);
    console.log('  Score range:', Math.min(...scores).toFixed(3), '-', Math.max(...scores).toFixed(3));
    console.log('  Average score:', (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3));
  }
  
  // Step C: Select top comps
  const topComps = selectTopComps(scored);
  console.log('Step C - Top comps selected:', topComps.length, `(max ${MAX_COMPS_TO_USE})`);
  
  // Check minimum requirement
  if (topComps.length < MIN_COMPS_REQUIRED) {
    console.error(`❌ FAILED: Only ${topComps.length} comps found, need minimum ${MIN_COMPS_REQUIRED}`);
    console.groupEnd();
    return null;
  }
  
  // Log top comp details
  console.log('📋 Top 3 comps used:');
  topComps.slice(0, 3).forEach((comp, i) => {
    console.log(`  ${i + 1}. Price: $${comp.purchase_price.toLocaleString('en-AU')}, Year: ${comp.build_year}, Score: ${comp.score.toFixed(3)}`);
  });
  
  // Step D: Blend results
  const blended = blendResults(topComps);
  console.log('Step D - Blended DV Year 1:', blended.dv[0]?.toFixed(0));
  console.log('Step D - Blended PC Year 1:', blended.pc[0]?.toFixed(0));
  
  // Step E: Scale by price
  const avgCompPrice = topComps.reduce((sum, c) => sum + c.purchase_price, 0) / topComps.length;
  const scale = input.purchasePrice / avgCompPrice;
  console.log('Step E - Price scaling:', {
    userPrice: input.purchasePrice,
    avgCompPrice: avgCompPrice.toFixed(0),
    scaleFactor: scale.toFixed(4),
  });
  
  const scaled = scaleByPrice(blended, topComps, input.purchasePrice);
  
  // Step F: Age-adjust the schedule based on property age
  console.log('Step F - Age adjustment:');
  const ageAdjusted = ageAdjustSchedule(scaled, propertyAge, input.purchasePrice);
  
  // Calculate totals from age-adjusted values
  const dvTotal = ageAdjusted.dv.reduce((sum, v) => sum + v, 0);
  const pcTotal = ageAdjusted.pc.reduce((sum, v) => sum + v, 0);
  
  // Generate projection years (next 10 calendar years from current year)
  const projectionYears = Array.from({ length: TOTAL_DEPRECIATION_YEARS }, (_, i) => currentYear + i);
  
  // Calculate confidence score (based on count and score distribution)
  // Reduce confidence for heavily extrapolated results
  const avgScore = topComps.reduce((sum, c) => sum + c.score, 0) / topComps.length;
  let confidenceScore = Math.min(100, (topComps.length / MAX_COMPS_TO_USE) * 50 + (avgScore * 50));
  
  // Reduce confidence for extrapolated results
  if (ageAdjusted.isExtrapolated) {
    const extrapolationPenalty = Math.min(30, (propertyAge - TOTAL_DEPRECIATION_YEARS) * 5);
    confidenceScore = Math.max(20, confidenceScore - extrapolationPenalty);
    console.log(`  ⚠️ Extrapolation confidence penalty: -${extrapolationPenalty}%`);
  }
  
  console.log('✅ CALCULATION COMPLETE:');
  console.log('  Property Age:', propertyAge, 'years');
  console.log('  Starting Year:', ageAdjusted.startingYear);
  console.log('  Extrapolated:', ageAdjusted.isExtrapolated);
  console.log('  DV Year 1 (of projection):', roundToThousand(ageAdjusted.dv[0]).toLocaleString('en-AU'));
  console.log('  PC Year 1 (of projection):', roundToThousand(ageAdjusted.pc[0]).toLocaleString('en-AU'));
  console.log('  DV 10-Year Total:', roundToThousand(dvTotal).toLocaleString('en-AU'));
  console.log('  PC 10-Year Total:', roundToThousand(pcTotal).toLocaleString('en-AU'));
  console.log('  Confidence:', confidenceScore.toFixed(0) + '%');
  console.log('  Projection Years:', projectionYears.join(', '));
  console.groupEnd();
  
  return {
    dv: ageAdjusted.dv,
    pc: ageAdjusted.pc,
    dvTotal,
    pcTotal,
    matchCount: topComps.length,
    topCompIds: topComps.map(c => c.id),
    confidenceScore,
    propertyAge,
    startingYear: ageAdjusted.startingYear,
    isExtrapolated: ageAdjusted.isExtrapolated,
    projectionYears,
  };
}

/**
 * Format currency for display (rounded to nearest thousand)
 */
export function formatDepreciationValue(value: number): string {
  const rounded = roundToThousand(value);
  return `$${rounded.toLocaleString('en-AU')}`;
}