import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { internalError } from '../_shared/errorResponse.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Phase3Request {
  action: 'forecast' | 'weekly_brief' | 'list_briefs';
  insights: any[];
  campaigns?: any[];
  datePreset?: string;
  healthScores?: any[];
  anomalies?: any[];
  budgetRecommendations?: any[];
  forecastHorizon?: number; // days: 7, 14, 30
  limit?: number;
}

interface ForecastPoint {
  date: string;
  spend: number;
  leads: number;
  cpl: number;
  impressions: number;
  confidence: number; // 0-1
}

interface ForecastResult {
  horizon_days: number;
  forecast: ForecastPoint[];
  trends: {
    spend_trend: 'increasing' | 'decreasing' | 'stable';
    lead_trend: 'increasing' | 'decreasing' | 'stable';
    cpl_trend: 'improving' | 'worsening' | 'stable';
    efficiency_trend: 'improving' | 'worsening' | 'stable';
  };
  projections: {
    projected_spend: number;
    projected_leads: number;
    projected_cpl: number;
    spend_range: [number, number];
    leads_range: [number, number];
  };
  aiAnalysis: string;
  aiError?: string;
}

// ─── Time-Series Forecasting Engine ──────────────────────────────────────────

function calculateMovingAverage(values: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

function calculateLinearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
    sumY2 += values[i] * values[i];
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const yMean = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

  return { slope: isNaN(slope) ? 0 : slope, intercept: isNaN(intercept) ? 0 : intercept, r2: isNaN(r2) ? 0 : r2 };
}

function detectSeasonality(values: number[]): number {
  // Simple autocorrelation check for weekly patterns (period = 7)
  if (values.length < 14) return 0;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < n - 7; i++) {
    numerator += (values[i] - mean) * (values[i + 7] - mean);
  }
  for (let i = 0; i < n; i++) {
    denominator += (values[i] - mean) ** 2;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function generateForecast(insights: any[], horizonDays: number): ForecastResult {
  // Aggregate daily data from insights
  const dailyData: Map<string, { spend: number; leads: number; impressions: number; clicks: number }> = new Map();

  for (const row of insights) {
    const date = row.date_start || row.date || '';
    if (!date) continue;
    const existing = dailyData.get(date) || { spend: 0, leads: 0, impressions: 0, clicks: 0 };
    existing.spend += Number(row.spend || 0);
    existing.impressions += Number(row.impressions || 0);
    existing.clicks += Number(row.clicks || 0);

    if (row.actions) {
      const leadAction = row.actions.find((a: any) => a.action_type === 'lead');
      existing.leads += leadAction ? Number(leadAction.value) : 0;
    }
    dailyData.set(date, existing);
  }

  // Sort by date
  const sortedDates = Array.from(dailyData.keys()).sort();
  const spendSeries = sortedDates.map(d => dailyData.get(d)!.spend);
  const leadsSeries = sortedDates.map(d => dailyData.get(d)!.leads);
  const impressionsSeries = sortedDates.map(d => dailyData.get(d)!.impressions);

  // Calculate CPL series
  const cplSeries = sortedDates.map(d => {
    const data = dailyData.get(d)!;
    return data.leads > 0 ? data.spend / data.leads : 0;
  });

  // Linear regression for each metric
  const spendReg = calculateLinearRegression(spendSeries);
  const leadsReg = calculateLinearRegression(leadsSeries);
  const cplReg = calculateLinearRegression(cplSeries.filter(v => v > 0));
  const impressionsReg = calculateLinearRegression(impressionsSeries);

  // Moving averages for smoothing
  const spendMA = calculateMovingAverage(spendSeries, 7);
  const leadsMA = calculateMovingAverage(leadsSeries, 7);

  // Seasonality detection
  const spendSeasonality = detectSeasonality(spendSeries);
  const leadsSeasonality = detectSeasonality(leadsSeries);

  // Generate forecast points
  const forecast: ForecastPoint[] = [];
  const n = sortedDates.length;
  const lastDate = sortedDates[n - 1] ? new Date(sortedDates[n - 1]) : new Date();
  const recentSpendAvg = spendMA[spendMA.length - 1] || 0;
  const recentLeadsAvg = leadsMA[leadsMA.length - 1] || 0;

  for (let d = 1; d <= horizonDays; d++) {
    const forecastDate = new Date(lastDate);
    forecastDate.setDate(forecastDate.getDate() + d);

    // Combine regression trend with moving average baseline
    const trendWeight = Math.min(0.4, Math.abs(spendReg.r2)); // Weight trend by R²
    const baselineWeight = 1 - trendWeight;

    const spendForecast = Math.max(0,
      baselineWeight * recentSpendAvg +
      trendWeight * (spendReg.slope * (n + d) + spendReg.intercept)
    );

    const leadsForecast = Math.max(0,
      baselineWeight * recentLeadsAvg +
      trendWeight * (leadsReg.slope * (n + d) + leadsReg.intercept)
    );

    const cplForecast = leadsForecast > 0 ? spendForecast / leadsForecast : 0;
    const impressionsForecast = Math.max(0,
      impressionsReg.slope * (n + d) + impressionsReg.intercept
    );

    // Confidence decays with distance
    const confidence = Math.max(0.3, 1 - (d / (horizonDays * 1.5)));

    forecast.push({
      date: forecastDate.toISOString().split('T')[0],
      spend: Math.round(spendForecast * 100) / 100,
      leads: Math.round(leadsForecast * 10) / 10,
      cpl: Math.round(cplForecast * 100) / 100,
      impressions: Math.round(impressionsForecast),
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  // Calculate projections (totals over horizon)
  const projectedSpend = forecast.reduce((s, f) => s + f.spend, 0);
  const projectedLeads = forecast.reduce((s, f) => s + f.leads, 0);
  const projectedCpl = projectedLeads > 0 ? projectedSpend / projectedLeads : 0;

  // Confidence intervals (±20% for range)
  const spendRange: [number, number] = [projectedSpend * 0.8, projectedSpend * 1.2];
  const leadsRange: [number, number] = [projectedLeads * 0.75, projectedLeads * 1.25];

  // Trend detection
  const detectTrend = (reg: { slope: number; r2: number }, threshold: number = 0.02): string => {
    if (Math.abs(reg.r2) < 0.1) return 'stable';
    return reg.slope > threshold ? 'increasing' : reg.slope < -threshold ? 'decreasing' : 'stable';
  };

  const spendTrend = detectTrend(spendReg) as 'increasing' | 'decreasing' | 'stable';
  const leadTrend = detectTrend(leadsReg, 0.01) as 'increasing' | 'decreasing' | 'stable';
  
  // CPL and efficiency trends (inverse - lower CPL = improving)
  const cplTrendRaw = detectTrend(cplReg);
  const cplTrend = cplTrendRaw === 'decreasing' ? 'improving' : cplTrendRaw === 'increasing' ? 'worsening' : 'stable';
  
  // Efficiency: leads per dollar trend
  const efficiencyValues = sortedDates.map(d => {
    const data = dailyData.get(d)!;
    return data.spend > 0 ? data.leads / data.spend : 0;
  }).filter(v => v > 0);
  const effReg = calculateLinearRegression(efficiencyValues);
  const efficiencyTrend = detectTrend(effReg, 0.0001) as 'increasing' | 'decreasing' | 'stable';

  return {
    horizon_days: horizonDays,
    forecast,
    trends: {
      spend_trend: spendTrend,
      lead_trend: leadTrend,
      cpl_trend: cplTrend as 'improving' | 'worsening' | 'stable',
      efficiency_trend: efficiencyTrend === 'increasing' ? 'improving' : efficiencyTrend === 'decreasing' ? 'worsening' : 'stable',
    },
    projections: {
      projected_spend: Math.round(projectedSpend * 100) / 100,
      projected_leads: Math.round(projectedLeads * 10) / 10,
      projected_cpl: Math.round(projectedCpl * 100) / 100,
      spend_range: [Math.round(spendRange[0] * 100) / 100, Math.round(spendRange[1] * 100) / 100],
      leads_range: [Math.round(leadsRange[0] * 10) / 10, Math.round(leadsRange[1] * 10) / 10],
    },
    aiAnalysis: '',
  };
}

// ─── Weekly Brief Generator ──────────────────────────────────────────────────

function buildWeeklyBriefPrompt(
  insights: any[],
  campaigns: any[],
  forecast: ForecastResult,
  anomalies: any[],
  healthScores: any[],
  budgetRecommendations: any[],
  datePreset: string,
): string {
  // Aggregate totals
  let totalSpend = 0, totalLeads = 0, totalImpressions = 0, totalClicks = 0;
  for (const row of insights) {
    totalSpend += Number(row.spend || 0);
    totalImpressions += Number(row.impressions || 0);
    totalClicks += Number(row.clicks || 0);
    if (row.actions) {
      const lead = row.actions.find((a: any) => a.action_type === 'lead');
      totalLeads += lead ? Number(lead.value) : 0;
    }
  }
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // Top campaigns
  const campaignSummaries = insights.slice(0, 10).map(row => {
    const leads = row.actions?.find((a: any) => a.action_type === 'lead')?.value || 0;
    const health = healthScores?.find((h: any) => h.campaign_id === row.campaign_id);
    return `- ${row.campaign_name}: $${Number(row.spend||0).toFixed(2)} spend, ${leads} leads, ${Number(row.ctr||0).toFixed(2)}% CTR${health ? `, Health: ${health.score}/100 (${health.status})` : ''}`;
  }).join('\n');

  // Critical anomalies
  const criticalAnomalies = (anomalies || []).filter((a: any) => a.type === 'critical');
  const anomalySummary = criticalAnomalies.length > 0
    ? criticalAnomalies.map((a: any) => `⚠️ ${a.title}: ${a.description}`).join('\n')
    : 'No critical anomalies detected.';

  // Budget recommendations
  const budgetSummary = (budgetRecommendations || []).slice(0, 5).map((r: any) =>
    `- ${r.campaign_name}: ${r.type.toUpperCase()} (${r.reason})`
  ).join('\n') || 'No budget recommendations.';

  return `You are an elite marketing analyst for a property investment company running Meta Ads campaigns for lead generation. Generate a comprehensive weekly performance brief.

## Current Period Data (${datePreset})

**Account Totals:**
- Total Spend: $${totalSpend.toFixed(2)}
- Total Leads: ${totalLeads}
- Overall CTR: ${ctr.toFixed(2)}%
- Average CPL: $${cpl.toFixed(2)}
- Total Impressions: ${totalImpressions.toLocaleString()}

**Campaign Performance:**
${campaignSummaries}

**Active Anomalies:**
${anomalySummary}

**Budget Recommendations:**
${budgetSummary}

**Forecast (Next ${forecast.horizon_days} Days):**
- Projected Spend: $${forecast.projections.projected_spend.toFixed(2)} (range: $${forecast.projections.spend_range[0].toFixed(2)}-$${forecast.projections.spend_range[1].toFixed(2)})
- Projected Leads: ${forecast.projections.projected_leads.toFixed(1)} (range: ${forecast.projections.leads_range[0].toFixed(1)}-${forecast.projections.leads_range[1].toFixed(1)})
- Projected CPL: $${forecast.projections.projected_cpl.toFixed(2)}
- Spend Trend: ${forecast.trends.spend_trend}
- Lead Trend: ${forecast.trends.lead_trend}
- CPL Trend: ${forecast.trends.cpl_trend}
- Efficiency Trend: ${forecast.trends.efficiency_trend}

## Instructions

Generate a strategic weekly brief in markdown format with these sections:

1. **Executive Summary** (2-3 sentences — the "headline" for stakeholders)
2. **Performance Highlights** (top 3-5 wins and concerns)
3. **Anomaly & Risk Assessment** (synthesize anomalies into actionable insights)
4. **Forecast & Outlook** (interpret the forecast data, what should we expect?)
5. **Strategic Recommendations** (3-5 prioritized actions for the coming week)
6. **Budget Allocation Guidance** (specific reallocation advice)

Be specific with numbers. Reference campaign names. Be direct and action-oriented. This is for an internal team that manages property investment ad campaigns — focus on lead quality and cost efficiency.`;
}

// ─── AI Integration ──────────────────────────────────────────────────────────

async function callGemini(prompt: string, _apiKey: string): Promise<string> {
  const response = await callLLMRaw({
    agentKey: 'meta_ads_forecast',
    messages: [
      { role: 'system', content: 'You are an expert marketing analytics advisor for property investment campaigns. Provide data-driven insights.' },
      { role: 'user', content: prompt },
    ],
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI Router error [${response.status}]: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: Phase3Request = await req.json();
    const { action } = body;

    const authResult = await verifyAuth(supabase, req.headers, body as any);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (action === 'forecast') {
      const { insights, horizonDays = 14 } = body as any;

      if (!insights || insights.length === 0) {
        return new Response(JSON.stringify({ error: 'No insights data provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate statistical forecast
      const forecast = generateForecast(insights, horizonDays);

      // AI analysis of the forecast
      if (LOVABLE_API_KEY) {
        try {
          const forecastPrompt = `Analyze this Meta Ads performance forecast for a property investment lead generation campaign:

**Forecast Horizon:** ${forecast.horizon_days} days
**Trends:**
- Spend: ${forecast.trends.spend_trend}
- Leads: ${forecast.trends.lead_trend}
- CPL: ${forecast.trends.cpl_trend}
- Efficiency: ${forecast.trends.efficiency_trend}

**Projections:**
- Projected Spend: $${forecast.projections.projected_spend.toFixed(2)} (range: $${forecast.projections.spend_range[0].toFixed(2)}–$${forecast.projections.spend_range[1].toFixed(2)})
- Projected Leads: ${forecast.projections.projected_leads.toFixed(1)} (range: ${forecast.projections.leads_range[0].toFixed(1)}–${forecast.projections.leads_range[1].toFixed(1)})
- Projected CPL: $${forecast.projections.projected_cpl.toFixed(2)}

**Historical Data Points:** ${insights.length} campaign-day records

Provide a concise 3-4 sentence analysis of what these trends mean for the business. Include: (1) whether current trajectory is healthy, (2) key risk if trends continue, (3) one specific tactical recommendation. Keep it sharp and actionable.`;

          forecast.aiAnalysis = await callGemini(forecastPrompt, LOVABLE_API_KEY);
        } catch (err) {
          console.error('AI forecast analysis error:', err);
          forecast.aiError = err instanceof Error ? err.message : 'AI analysis failed';
        }
      }

      return new Response(JSON.stringify(forecast), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'weekly_brief') {
      const { insights, campaigns, datePreset, healthScores, anomalies, budgetRecommendations } = body as any;

      if (!insights || insights.length === 0) {
        return new Response(JSON.stringify({ error: 'No insights data provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Generate forecast first
      const forecast = generateForecast(insights, 7);

      // Aggregate metrics snapshot
      let totalSpend = 0, totalLeads = 0, totalImpressions = 0, totalClicks = 0;
      for (const row of insights) {
        totalSpend += Number(row.spend || 0);
        totalImpressions += Number(row.impressions || 0);
        totalClicks += Number(row.clicks || 0);
        if (row.actions) {
          const lead = row.actions.find((a: any) => a.action_type === 'lead');
          totalLeads += lead ? Number(lead.value) : 0;
        }
      }

      let briefContent = '';
      let aiError = '';

      if (LOVABLE_API_KEY) {
        try {
          const prompt = buildWeeklyBriefPrompt(
            insights, campaigns || [], forecast,
            anomalies || [], healthScores || [],
            budgetRecommendations || [], datePreset || 'last_7d'
          );
          briefContent = await callGemini(prompt, LOVABLE_API_KEY);
        } catch (err) {
          console.error('AI weekly brief error:', err);
          aiError = err instanceof Error ? err.message : 'AI brief generation failed';
        }
      } else {
        aiError = 'LOVABLE_API_KEY not configured';
      }

      // Calculate period dates from actual insights data (not hardcoded)
      let periodStart = '';
      let periodEnd = '';
      
      // Try to get actual date range from insights data
      for (const row of insights) {
        const ds = row.date_start;
        const de = row.date_stop;
        if (ds && (!periodStart || ds < periodStart)) periodStart = ds;
        if (de && (!periodEnd || de > periodEnd)) periodEnd = de;
      }
      
      // Fallback to datePreset-based calculation if insights have no dates
      if (!periodStart || !periodEnd) {
        const now = new Date();
        const presetDays: Record<string, number> = {
          'last_7d': 7, 'last_14d': 14, 'last_30d': 30, 'last_90d': 90,
          'this_month': new Date().getDate(), 'last_month': 30,
        };
        const days = presetDays[datePreset || 'last_7d'] || 7;
        periodEnd = now.toISOString().split('T')[0];
        periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      // Save to database
      const reportData = {
        report_type: 'weekly_brief',
        title: `Weekly Brief — ${periodStart} to ${periodEnd}`,
        period_start: periodStart,
        period_end: periodEnd,
        date_preset: datePreset || 'last_7d',
        content: briefContent,
        metrics_snapshot: {
          total_spend: totalSpend,
          total_leads: totalLeads,
          total_impressions: totalImpressions,
          total_clicks: totalClicks,
          ctr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
          cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
          campaigns_count: insights.length,
        },
        forecast_data: {
          trends: forecast.trends,
          projections: forecast.projections,
        },
        anomalies_snapshot: anomalies || [],
        health_snapshot: healthScores || [],
        recommendations: budgetRecommendations || [],
        created_by: authResult.userId || 'system',
      };

      const { data: savedReport, error: saveError } = await supabase
        .from('marketing_reports')
        .insert(reportData)
        .select()
        .single();

      if (saveError) {
        console.error('Error saving report:', saveError);
      }

      return new Response(JSON.stringify({
        brief: briefContent,
        aiError,
        report_id: savedReport?.id,
        metrics: reportData.metrics_snapshot,
        forecast: {
          trends: forecast.trends,
          projections: forecast.projections,
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'list_briefs') {
      const { limit = 10 } = body;

      const { data: reports, error } = await supabase
        .from('marketing_reports')
        .select('id, title, report_type, period_start, period_end, metrics_snapshot, forecast_data, content, created_at')
        .eq('report_type', 'weekly_brief')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return new Response(JSON.stringify({ reports: reports || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Phase 3 error:', error);
    return new Response(JSON.stringify(internalError(error, 'analyze-meta-ads-phase3')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
