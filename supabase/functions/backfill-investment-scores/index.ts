import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { internalError } from '../_shared/errorResponse.ts';
import { createCorsHeaders } from '../_shared/auth.ts';

// ============ SCORING LOGIC (embedded from investment-scoring-service) ============

interface ScoringInput {
  propertyPrice: number;
  weeklyRent: number;
  propertyType?: string;
  medianSuburbPrice?: number;
  priceGrowth1Year?: number;
  priceGrowth3Year?: number;
  vacancyRate?: number;
  daysOnMarket?: number;
  walkScore?: number;
  populationGrowth?: number;
  medianIncome?: number;
  unemploymentRate?: number;
  commuteTimeCBD?: number;
  schoolsNearby?: number;
  cashFlow?: number;
  lvr?: number;
  state?: string;
}

function transformInput(raw: any): ScoringInput {
  const property = raw.property || {};
  const demographics = raw.demographics || {};
  const locationIntelligence = raw.locationIntelligence || {};
  const financials = raw.financials || {};
  const marketData = demographics.marketData || financials.marketData || {};
  const keyMetrics = financials.keyMetrics || {};
  const commute = locationIntelligence.commute || {};
  const schools = locationIntelligence.schools || {};

  return {
    propertyPrice: property.price || 0,
    weeklyRent: property.weeklyRent || 0,
    propertyType: property.propertyType || 'house',
    medianSuburbPrice: marketData.medianPrice,
    priceGrowth1Year: marketData.priceGrowth1Year || marketData.annualGrowth,
    priceGrowth3Year: marketData.priceGrowth3Year,
    vacancyRate: marketData.vacancyRate,
    daysOnMarket: marketData.daysOnMarket,
    // RF-7.2B.1B2 — unavailable stays unavailable; a genuine 0 is unchanged,
    // because `0 ?? undefined` is `0`.
    walkScore: locationIntelligence.walkScore ?? undefined,
    populationGrowth: demographics.populationGrowth,
    medianIncome: demographics.medianIncome || demographics.medianHouseholdIncome,
    unemploymentRate: demographics.unemploymentRate,
    commuteTimeCBD: commute.durationMinutes,
    schoolsNearby: schools.schoolsWithin3km ?? undefined,
    cashFlow: keyMetrics.weeklyNet,
    lvr: keyMetrics.lvr,
    state: raw.state || demographics.state,
  };
}

function calcYield(i: ScoringInput) {
  const gy = ((i.weeklyRent || 0) * 52 / i.propertyPrice) * 100;
  let score = gy >= 6 ? 100 : gy >= 5 ? 85 : gy >= 4 ? 70 : gy >= 3 ? 50 : gy >= 2 ? 30 : 10;
  let details = `Gross yield: ${gy.toFixed(2)}%`;
  if (i.cashFlow !== undefined) {
    if (i.cashFlow > 0) score = Math.min(100, score + 10);
    else if (i.cashFlow < -100) score = Math.max(0, score - 20);
  }
  return { score, details };
}

function calcGrowth(i: ScoringInput) {
  let score = 50;
  const g1 = i.priceGrowth1Year || 0;
  const g3 = i.priceGrowth3Year || 0;
  if (g1 >= 10) score += 30; else if (g1 >= 5) score += 20; else if (g1 >= 2) score += 10; else if (g1 < 0) score -= 10;
  if (g3 > g1 && g3 > 15) score += 20; else if (g3 > 20) score += 15;
  if (i.populationGrowth && i.populationGrowth > 2) score += 10;
  return { score: Math.min(100, score), details: `1yr: ${g1}%, 3yr: ${g3}%` };
}

function calcLocation(i: ScoringInput) {
  let score = 0;
  if (i.walkScore) { if (i.walkScore >= 90) score += 35; else if (i.walkScore >= 70) score += 28; else if (i.walkScore >= 50) score += 18; else if (i.walkScore >= 25) score += 8; else score += 3; } else score += 12;
  if (i.commuteTimeCBD) { if (i.commuteTimeCBD <= 15) score += 30; else if (i.commuteTimeCBD <= 25) score += 25; else if (i.commuteTimeCBD <= 40) score += 18; else if (i.commuteTimeCBD <= 60) score += 10; else score += 3; } else score += 12;
  if (i.schoolsNearby) { if (i.schoolsNearby >= 8) score += 20; else if (i.schoolsNearby >= 5) score += 18; else if (i.schoolsNearby >= 3) score += 14; else if (i.schoolsNearby >= 1) score += 8; } else score += 8;
  if (i.state && ['NSW','VIC','QLD'].includes(i.state)) score += 15; else if (i.state && ['WA','SA'].includes(i.state)) score += 12; else if (i.state && ['TAS','ACT','NT'].includes(i.state)) score += 8;
  return { score: Math.min(100, score), details: `Walk: ${i.walkScore || 'N/A'}` };
}

function calcDemand(i: ScoringInput) {
  let score = 50;
  if (i.vacancyRate !== undefined) { if (i.vacancyRate < 1) score += 30; else if (i.vacancyRate < 1.5) score += 25; else if (i.vacancyRate < 2) score += 18; else if (i.vacancyRate < 3) score += 10; else if (i.vacancyRate < 4) score += 0; else if (i.vacancyRate < 5) score -= 8; else score -= 15; }
  if (i.daysOnMarket !== undefined) { if (i.daysOnMarket < 15) score += 20; else if (i.daysOnMarket < 30) score += 15; else if (i.daysOnMarket < 45) score += 10; else if (i.daysOnMarket < 60) score += 5; else if (i.daysOnMarket < 90) score -= 5; else score -= 12; }
  if (i.medianSuburbPrice) { const r = i.propertyPrice / i.medianSuburbPrice; if (r < 0.85) score += 18; else if (r < 0.95) score += 12; else if (r <= 1.05) score += 5; else if (r <= 1.15) score -= 5; else if (r <= 1.25) score -= 10; else score -= 15; }
  if (i.unemploymentRate !== undefined) { if (i.unemploymentRate < 2.5) score += 18; else if (i.unemploymentRate < 3.5) score += 12; else if (i.unemploymentRate < 4.5) score += 6; else if (i.unemploymentRate < 5.5) score += 0; else if (i.unemploymentRate < 7) score -= 8; else score -= 15; }
  return { score: Math.min(100, Math.max(0, score)), details: `Vacancy: ${i.vacancyRate ?? 'N/A'}%` };
}

function calcRisk(i: ScoringInput) {
  let score = 100;
  if (i.lvr) { if (i.lvr > 95) score -= 45; else if (i.lvr > 90) score -= 35; else if (i.lvr > 85) score -= 25; else if (i.lvr > 80) score -= 18; else if (i.lvr > 70) score -= 8; else if (i.lvr <= 60) score += 5; }
  if (i.cashFlow !== undefined) { if (i.cashFlow < -400) score -= 35; else if (i.cashFlow < -300) score -= 28; else if (i.cashFlow < -200) score -= 20; else if (i.cashFlow < -100) score -= 12; else if (i.cashFlow < 0) score -= 6; else if (i.cashFlow > 150) score += 8; else if (i.cashFlow > 50) score += 4; }
  if (i.propertyType === 'unit' || i.propertyType === 'apartment') score -= 10; else if (i.propertyType === 'townhouse') score -= 5; else if (i.propertyType === 'house') score += 3;
  if (i.priceGrowth1Year && i.priceGrowth1Year > 25) score -= 25; else if (i.priceGrowth1Year && i.priceGrowth1Year > 20) score -= 18; else if (i.priceGrowth1Year && i.priceGrowth1Year > 15) score -= 10;
  if (i.vacancyRate !== undefined) { if (i.vacancyRate > 6) score -= 22; else if (i.vacancyRate > 5) score -= 16; else if (i.vacancyRate > 4) score -= 10; else if (i.vacancyRate < 1) score += 5; else if (i.vacancyRate < 1.5) score += 3; }
  if (i.daysOnMarket !== undefined) { if (i.daysOnMarket > 120) score -= 15; else if (i.daysOnMarket > 90) score -= 10; else if (i.daysOnMarket > 60) score -= 5; }
  return { score: Math.max(0, Math.min(100, score)), details: `LVR: ${i.lvr ?? 'N/A'}%` };
}

function calculateScore(raw: any) {
  const i = transformInput(raw);
  if (i.propertyPrice <= 0) return null;
  
  const ys = calcYield(i), gs = calcGrowth(i), ls = calcLocation(i), ds = calcDemand(i), rs = calcRisk(i);
  const totalScore = Math.round(ys.score * 0.15 + gs.score * 0.40 + ls.score * 0.25 + ds.score * 0.15 + rs.score * 0.05);
  
  let grade: string, recommendation: string;
  if (totalScore >= 85) { grade = 'A+'; recommendation = 'STRONG BUY'; }
  else if (totalScore >= 75) { grade = 'A'; recommendation = 'BUY'; }
  else if (totalScore >= 65) { grade = 'B+'; recommendation = 'BUY'; }
  else if (totalScore >= 58) { grade = 'B'; recommendation = 'HOLD/BUY'; }
  else if (totalScore >= 50) { grade = 'C+'; recommendation = 'HOLD'; }
  else if (totalScore >= 42) { grade = 'C'; recommendation = 'HOLD'; }
  else if (totalScore >= 32) { grade = 'D'; recommendation = 'CAUTION'; }
  else { grade = 'F'; recommendation = 'AVOID'; }

  return {
    totalScore, grade, recommendation,
    breakdown: {
      yieldScore: { ...ys, weight: 15 },
      growthScore: { ...gs, weight: 40 },
      locationScore: { ...ls, weight: 25 },
      demandScore: { ...ds, weight: 15 },
      riskScore: { ...rs, weight: 5 },
    },
    strengths: [], weaknesses: [], opportunities: [], risks: []
  };
}

// ============ CONTENT PARSING ============

function extractPriceFromContent(content: string): number | null {
  if (!content) return null;
  const patterns = [
    /purchase\s*price[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
    /property\s*(?:value|price)[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
    /asking\s*price[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
    /estimated\s*(?:value|price)[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
    /median\s*(?:house|property)\s*price[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > 50000 && v < 50000000) return v; }
  }
  return null;
}

function extractRentFromContent(content: string): number | null {
  if (!content) return null;
  const patterns = [
    /weekly\s*rent(?:al)?[:\s]*\$?([\d,]+(?:\.\d+)?)/i,
    /rent[:\s]*\$?([\d,]+(?:\.\d+)?)\s*(?:per\s*week|pw|\/\s*week|weekly)/i,
    /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*week|pw|\/\s*week|weekly)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > 50 && v < 5000) return v; }
  }
  // Try annual
  const annualMatch = content.match(/annual\s*rent(?:al)?[:\s]*\$?([\d,]+(?:\.\d+)?)/i);
  if (annualMatch) { const v = parseFloat(annualMatch[1].replace(/,/g, '')); if (v > 5000 && v < 200000) return Math.round(v / 52); }
  return null;
}

// ============ MAIN ============

Deno.serve(async (req) => {
  // CORS is built PER REQUEST from the shared allowlist, never hardcoded.
  //
  // This answered `Access-Control-Allow-Origin: *` while running
  // `verify_jwt = false`. Now that the gateway demands a JWT the call is
  // credentialed, and the Fetch spec makes a browser REJECT a credentialed
  // response carrying a wildcard — opaquely, as "Failed to fetch" — so the
  // wildcard would have turned an authentication fix into a broken endpoint.
  //
  // `createCorsHeaders` is called rather than spread-and-overridden: it already
  // supplies Allow-Headers and Expose-Headers from the canonical lists in
  // `_shared/auth.ts`, and restating them here would pin this function to a
  // snapshot of those lists taken today. The lists it returns are supersets of
  // the three headers this file used to name, so nothing is narrowed.
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batchSize || 25;

    console.log(`🔄 Backfill investment scores - batch: ${batchSize}`);

    const { data: reports, error: fetchError } = await supabase
      .from('investment_reports')
      .select('id, property_address, manual_overrides, report_content, financial_calculations, demographics_data, location_intelligence')
      .eq('status', 'completed')
      .is('investment_score', null)
      .order('created_at', { ascending: false })
      .limit(batchSize);

    if (fetchError) throw fetchError;
    if (!reports || reports.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No reports to backfill', processed: 0, remaining: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`📋 Found ${reports.length} reports to process`);

    let scored = 0, skipped = 0;
    const results: any[] = [];

    for (const report of reports) {
      const overrides = report.manual_overrides || {};
      const content = report.report_content || '';

      const price = parseFloat(overrides.purchasePrice) ||
                    (report.financial_calculations?.initialCosts?.propertyValue) ||
                    extractPriceFromContent(content) || 0;

      const weeklyRent = parseFloat(overrides.weeklyRent) ||
                         (report.financial_calculations?.keyMetrics?.weeklyRent) ||
                         extractRentFromContent(content) || 0;

      if (price <= 0) {
        skipped++;
        results.push({ id: report.id, address: report.property_address, status: 'skipped', reason: 'no_price' });
        continue;
      }

      const investmentScore = calculateScore({
        property: { price, weeklyRent, propertyType: overrides.propertyType || 'house' },
        demographics: report.demographics_data || {},
        locationIntelligence: report.location_intelligence || {},
        financials: report.financial_calculations || {},
      });

      if (!investmentScore) {
        skipped++;
        results.push({ id: report.id, address: report.property_address, status: 'skipped', reason: 'score_calc_failed' });
        continue;
      }

      const { error: updateError } = await supabase
        .from('investment_reports')
        .update({ investment_score: investmentScore, updated_at: new Date().toISOString() })
        .eq('id', report.id);

      if (updateError) {
        results.push({ id: report.id, address: report.property_address, status: 'update_error', error: updateError.message });
      } else {
        scored++;
        console.log(`✅ ${report.property_address}: ${investmentScore.grade} (${investmentScore.totalScore}/100)`);
        results.push({ id: report.id, address: report.property_address, status: 'scored', grade: investmentScore.grade, score: investmentScore.totalScore });
      }
    }

    const { count } = await supabase
      .from('investment_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed')
      .is('investment_score', null);

    const summary = { success: true, total: reports.length, scored, skipped, remaining: (count || 0) - scored };
    console.log(`📊 Done: ${scored} scored, ${skipped} skipped, ${summary.remaining} remaining`);

    return new Response(JSON.stringify({ ...summary, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'backfill-investment-scores'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
