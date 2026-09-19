import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { internalError } from '../_shared/errorResponse.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Phase2Request {
  action: 'budget_advisor' | 'audience_intelligence' | 'lead_quality';
  insights: any[];
  campaigns?: any[];
  datePreset?: string;
  healthScores?: any[];
}

interface BudgetRecommendation {
  type: 'increase' | 'decrease' | 'pause' | 'reallocate';
  priority: 'high' | 'medium' | 'low';
  campaign_id: string;
  campaign_name: string;
  current_spend: number;
  suggested_change: number;
  suggested_spend: number;
  reason: string;
  projected_impact: string;
}

interface AudienceInsight {
  adset_id: string;
  adset_name: string;
  campaign_name: string;
  performance_index: number; // relative to account avg
  spend: number;
  leads: number;
  cpl: number;
  ctr: number;
  insight: string;
}

interface LeadQualityData {
  source: string;
  total_leads: number;
  pipeline_progression: Record<string, number>;
  conversion_rate: number;
  avg_days_to_convert: number;
  estimated_true_cpa: number;
  quality_score: number;
}

// ─── Budget Advisor Engine ───────────────────────────────────────────────────

function generateBudgetRecommendations(
  insights: any[],
  campaigns: any[] | null,
  healthScores: any[] | null
): BudgetRecommendation[] {
  const recommendations: BudgetRecommendation[] = [];
  if (!insights || insights.length < 2) return recommendations;

  // Calculate account benchmarks
  let totalSpend = 0, totalLeads = 0;
  for (const row of insights) {
    totalSpend += Number(row.spend || 0);
    totalLeads += extractAction(row.actions, 'lead');
  }
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  // Sort by efficiency (CPL ascending, zero-lead campaigns last)
  const ranked = insights.map(row => {
    const spend = Number(row.spend || 0);
    const leads = extractAction(row.actions, 'lead');
    const cpl = leads > 0 ? spend / leads : Infinity;
    const health = healthScores?.find((h: any) => h.campaign_id === row.campaign_id);
    return { ...row, _spend: spend, _leads: leads, _cpl: cpl, _health: health };
  }).sort((a, b) => a._cpl - b._cpl);

  // Top performers: suggest scaling
  const topPerformers = ranked.filter(r => r._leads > 0 && r._cpl < avgCpl * 0.8);
  for (const tp of topPerformers) {
    const increaseAmount = Math.round(tp._spend * 0.3);
    const projectedAdditionalLeads = tp._cpl > 0 ? Math.round(increaseAmount / tp._cpl) : 0;
    recommendations.push({
      type: 'increase',
      priority: 'high',
      campaign_id: tp.campaign_id,
      campaign_name: tp.campaign_name || 'Unknown',
      current_spend: tp._spend,
      suggested_change: increaseAmount,
      suggested_spend: tp._spend + increaseAmount,
      reason: `CPL of $${tp._cpl.toFixed(2)} is ${((1 - tp._cpl / avgCpl) * 100).toFixed(0)}% below account average. Strong performer worth scaling.`,
      projected_impact: `Estimated +${projectedAdditionalLeads} leads at current efficiency`,
    });
  }

  // Underperformers: suggest reducing or pausing
  const underperformers = ranked.filter(r => r._spend > 50 && r._leads === 0);
  for (const up of underperformers) {
    recommendations.push({
      type: 'pause',
      priority: 'high',
      campaign_id: up.campaign_id,
      campaign_name: up.campaign_name || 'Unknown',
      current_spend: up._spend,
      suggested_change: -up._spend,
      suggested_spend: 0,
      reason: `Spent $${up._spend.toFixed(2)} with zero leads. Budget is being wasted.`,
      projected_impact: `Save $${up._spend.toFixed(2)} — reallocate to top performers`,
    });
  }

  // High CPL campaigns: suggest reducing
  const highCplCampaigns = ranked.filter(r => r._leads > 0 && r._cpl > avgCpl * 1.5 && r._spend > 30);
  for (const hc of highCplCampaigns) {
    const decreaseAmount = Math.round(hc._spend * 0.4);
    recommendations.push({
      type: 'decrease',
      priority: 'medium',
      campaign_id: hc.campaign_id,
      campaign_name: hc.campaign_name || 'Unknown',
      current_spend: hc._spend,
      suggested_change: -decreaseAmount,
      suggested_spend: hc._spend - decreaseAmount,
      reason: `CPL of $${hc._cpl.toFixed(2)} is ${((hc._cpl / avgCpl - 1) * 100).toFixed(0)}% above average. Needs optimisation before more spend.`,
      projected_impact: `Save $${decreaseAmount.toFixed(2)} while testing new targeting/creatives`,
    });
  }

  // Reallocation opportunity
  const saveable = underperformers.reduce((s, u) => s + u._spend, 0) +
    highCplCampaigns.reduce((s, h) => s + Math.round(h._spend * 0.4), 0);
  if (saveable > 0 && topPerformers.length > 0) {
    const bestPerformer = topPerformers[0];
    const additionalLeads = bestPerformer._cpl > 0 ? Math.round(saveable / bestPerformer._cpl) : 0;
    recommendations.push({
      type: 'reallocate',
      priority: 'high',
      campaign_id: 'account',
      campaign_name: 'Budget Reallocation',
      current_spend: totalSpend,
      suggested_change: 0,
      suggested_spend: totalSpend,
      reason: `$${saveable.toFixed(2)} can be reallocated from underperformers to "${bestPerformer.campaign_name}".`,
      projected_impact: `Estimated +${additionalLeads} additional leads with the same total budget`,
    });
  }

  return recommendations;
}

// ─── Audience Intelligence Engine ────────────────────────────────────────────

function analyzeAudiences(insights: any[]): AudienceInsight[] {
  if (!insights || insights.length === 0) return [];

  // Calculate account averages
  let totalSpend = 0, totalLeads = 0, totalClicks = 0, totalImpressions = 0;
  for (const row of insights) {
    totalSpend += Number(row.spend || 0);
    totalLeads += extractAction(row.actions, 'lead');
    totalClicks += Number(row.clicks || 0);
    totalImpressions += Number(row.impressions || 0);
  }
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 50;
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 1;

  return insights.map(row => {
    const spend = Number(row.spend || 0);
    const leads = extractAction(row.actions, 'lead');
    const cpl = leads > 0 ? spend / leads : 0;
    const ctr = Number(row.ctr || 0);
    const impressions = Number(row.impressions || 0);

    // Performance index: composite of CPL efficiency and CTR performance
    let perfIndex = 50; // baseline
    if (leads > 0 && avgCpl > 0) {
      const cplRatio = avgCpl / cpl; // higher is better
      const ctrRatio = avgCtr > 0 ? ctr / avgCtr : 1;
      perfIndex = Math.min(100, Math.round(((cplRatio * 0.6 + ctrRatio * 0.4) / 1) * 50));
    } else if (spend > 50 && leads === 0) {
      perfIndex = 10;
    }

    // Generate insight text
    let insight = '';
    if (leads > 0 && cpl < avgCpl * 0.7) {
      insight = `⭐ Top performer — CPL ${((1 - cpl / avgCpl) * 100).toFixed(0)}% below average. Scale this audience.`;
    } else if (leads > 0 && cpl > avgCpl * 1.5) {
      insight = `⚠️ Expensive leads — CPL ${((cpl / avgCpl - 1) * 100).toFixed(0)}% above average. Refine targeting.`;
    } else if (leads === 0 && spend > 50) {
      insight = `🔴 No conversions despite $${spend.toFixed(0)} spend. Consider pausing or restructuring.`;
    } else if (ctr > avgCtr * 1.5) {
      insight = `👀 High engagement (CTR ${ctr.toFixed(2)}%) — creative resonates but check conversion path.`;
    } else if (ctr < avgCtr * 0.5 && impressions > 1000) {
      insight = `📉 Low engagement — ad creative may not resonate with this audience.`;
    } else if (leads > 0) {
      insight = `✓ Performing within normal range.`;
    } else {
      insight = `Insufficient data for analysis.`;
    }

    return {
      adset_id: row.adset_id || row.campaign_id || '',
      adset_name: row.adset_name || row.campaign_name || 'Unknown',
      campaign_name: row.campaign_name || '',
      performance_index: perfIndex,
      spend,
      leads,
      cpl,
      ctr,
      insight,
    };
  }).sort((a, b) => b.performance_index - a.performance_index);
}

// ─── AI Budget & Audience Analysis ───────────────────────────────────────────

async function generateAIBudgetAnalysis(
  insights: any[],
  recommendations: BudgetRecommendation[],
  audienceInsights: AudienceInsight[]
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return '';

  let totalSpend = 0, totalLeads = 0;
  for (const r of insights) {
    totalSpend += Number(r.spend || 0);
    totalLeads += extractAction(r.actions, 'lead');
  }

  const recsText = recommendations.map(r =>
    `- [${r.type.toUpperCase()}] ${r.campaign_name}: ${r.reason} → ${r.projected_impact}`
  ).join('\n');

  const topAudiences = audienceInsights.slice(0, 5).map(a =>
    `- "${a.adset_name}" | CPL: ${a.cpl > 0 ? '$' + a.cpl.toFixed(2) : 'N/A'} | CTR: ${a.ctr.toFixed(2)}% | Perf Index: ${a.performance_index}/100 | ${a.insight}`
  ).join('\n');

  const prompt = `You are a senior performance marketing strategist for an Australian property buyers' agency. Analyze the budget allocation and audience performance data below and provide strategic recommendations.

**Account Overview**: $${totalSpend.toFixed(2)} total spend, ${totalLeads} leads, ${totalLeads > 0 ? '$' + (totalSpend / totalLeads).toFixed(2) : 'N/A'} avg CPL

**System-Generated Budget Recommendations**:
${recsText || 'No recommendations generated.'}

**Top Audience/Ad Set Performance**:
${topAudiences || 'No audience data available.'}

**Instructions**:
1. Validate or challenge the system recommendations with strategic reasoning
2. Identify the single highest-ROI budget move available right now
3. Provide audience targeting insights — which segments to double down on and which to cut
4. Suggest one creative strategy based on the performance patterns
5. Keep response under 300 words, be specific with numbers
6. Frame all advice in terms of property buyer lead generation

**CRITICAL FORMATTING RULES — You MUST use these custom fence blocks to structure your response:**
- Wrap your opening assessment in :::note or :::warning depending on urgency
- Wrap the highest-ROI budget move in a :::success block
- Wrap each actionable recommendation in a :::tip block
- Wrap any risks or concerns in :::warning blocks
- Wrap deeper strategic reasoning in :::insight blocks
- Use :::metric blocks for key numbers (Label/Value/Change fields)
- You can still use standard markdown (bold, headers) BETWEEN blocks

Example:
:::success
**Consolidate Spend**: Shift 100% of daily budget into the "NPC – Property Strategy" set for maximum ROI.
:::

:::tip
**Audience Insight**: Segment into High-Net-Worth interest overlays to improve lead quality.
:::

:::warning
**Cut Underperformer**: The "7 Property in 7 Years" quiz funnel has zero conversions — pause or refresh creative.
:::

Do NOT output raw plain text paragraphs — structure everything using these blocks.`;

  try {
    const response = await callLLMRaw({
      agentKey: 'meta_ads_strategy',
      messages: [
        { role: 'system', content: 'You are a performance marketing strategist specializing in Australian property services advertising. Provide data-driven, actionable budget and audience recommendations.' },
        { role: 'user', content: prompt },
      ],
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[analyze-meta-ads-phase2] AI error ${response.status}:`, errorText);
      if (response.status === 429) return '__RATE_LIMITED__';
      if (response.status === 402) return '__PAYMENT_REQUIRED__';
      return '';
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[analyze-meta-ads-phase2] AI analysis error:', err);
    return '';
  }
}

// ─── Lead Quality Correlation ────────────────────────────────────────────────

async function analyzeLeadQuality(
  supabase: any,
  insights: any[]
): Promise<{ leadQuality: LeadQualityData[]; aiAnalysis: string }> {
  // Fetch clients with lead source data and their pipeline status
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, lead_source, lead_source_campaign, pipeline_status, deal_status, created_at, first_deal_closed_at')
    .not('lead_source', 'is', null);

  if (clientsError || !clients || clients.length === 0) {
    console.log('[analyze-meta-ads-phase2] No clients with lead_source data found');
    // Still return pipeline overview without source correlation
    const { data: allClients } = await supabase
      .from('clients')
      .select('id, pipeline_status, deal_status, created_at, first_deal_closed_at');

    if (!allClients || allClients.length === 0) {
      return { leadQuality: [], aiAnalysis: '' };
    }

    // Build generic pipeline funnel data
    const pipelineCounts: Record<string, number> = {};
    for (const c of allClients) {
      const stage = c.pipeline_status || c.deal_status || 'Unknown';
      pipelineCounts[stage] = (pipelineCounts[stage] || 0) + 1;
    }

    const totalClients = allClients.length;
    const closedClients = allClients.filter((c: any) => c.first_deal_closed_at).length;

    const overallData: LeadQualityData = {
      source: 'All Sources (no source tagging yet)',
      total_leads: totalClients,
      pipeline_progression: pipelineCounts,
      conversion_rate: totalClients > 0 ? (closedClients / totalClients) * 100 : 0,
      avg_days_to_convert: 0,
      estimated_true_cpa: 0,
      quality_score: 50,
    };

    return { leadQuality: [overallData], aiAnalysis: '' };
  }

  // Group clients by lead source
  const sourceGroups: Record<string, any[]> = {};
  for (const client of clients) {
    const source = client.lead_source || 'unknown';
    if (!sourceGroups[source]) sourceGroups[source] = [];
    sourceGroups[source].push(client);
  }

  // Calculate lead quality per source
  const leadQuality: LeadQualityData[] = [];
  let totalSpendFromInsights = 0;
  for (const row of insights) {
    totalSpendFromInsights += Number(row.spend || 0);
  }

  for (const [source, sourceClients] of Object.entries(sourceGroups)) {
    const pipelineCounts: Record<string, number> = {};
    let totalDaysToConvert = 0;
    let convertedCount = 0;

    for (const c of sourceClients) {
      const stage = c.pipeline_status || c.deal_status || 'Unknown';
      pipelineCounts[stage] = (pipelineCounts[stage] || 0) + 1;

      if (c.first_deal_closed_at && c.created_at) {
        const days = (new Date(c.first_deal_closed_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24);
        totalDaysToConvert += days;
        convertedCount++;
      }
    }

    const conversionRate = sourceClients.length > 0 ? (convertedCount / sourceClients.length) * 100 : 0;
    const avgDays = convertedCount > 0 ? totalDaysToConvert / convertedCount : 0;

    // Estimate true CPA (spend / converted clients)
    // Match source to campaign spend if possible
    let matchedSpend = 0;
    if (source === 'facebook' || source === 'meta') {
      matchedSpend = totalSpendFromInsights;
    }
    const trueCpa = convertedCount > 0 && matchedSpend > 0 ? matchedSpend / convertedCount : 0;

    // Quality score: based on conversion rate and speed
    let qualityScore = 50;
    if (conversionRate > 20) qualityScore += 25;
    else if (conversionRate > 10) qualityScore += 15;
    else if (conversionRate > 5) qualityScore += 5;
    if (avgDays > 0 && avgDays < 30) qualityScore += 15;
    else if (avgDays > 0 && avgDays < 60) qualityScore += 10;
    if (sourceClients.length > 10) qualityScore += 10;
    qualityScore = Math.min(100, qualityScore);

    leadQuality.push({
      source,
      total_leads: sourceClients.length,
      pipeline_progression: pipelineCounts,
      conversion_rate: conversionRate,
      avg_days_to_convert: avgDays,
      estimated_true_cpa: trueCpa,
      quality_score: qualityScore,
    });
  }

  // Sort by quality score descending
  leadQuality.sort((a, b) => b.quality_score - a.quality_score);

  // Generate AI analysis if data available
  let aiAnalysis = '';
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (LOVABLE_API_KEY && leadQuality.length > 0) {
    const qualityText = leadQuality.map(lq =>
      `- ${lq.source}: ${lq.total_leads} leads, ${lq.conversion_rate.toFixed(1)}% convert, avg ${lq.avg_days_to_convert.toFixed(0)} days, quality: ${lq.quality_score}/100`
    ).join('\n');

    try {
      const response = await callLLMRaw({
        agentKey: 'meta_ads_lead_quality',
        messages: [
          { role: 'system', content: 'You are a CRM and marketing analytics expert for an Australian property buyers agency. Analyze lead quality by source.' },
          { role: 'user', content: `Analyze lead quality across sources:\n\n${qualityText}\n\nProvide: 1) Which source delivers highest quality leads 2) Where conversion bottlenecks exist 3) Recommendations for improving conversion. Keep under 150 words.` },
        ],
      });

      if (response.ok) {
        const data = await response.json();
        aiAnalysis = data.choices?.[0]?.message?.content || '';
      } else {
        await response.text(); // consume body
      }
    } catch (err) {
      console.error('[analyze-meta-ads-phase2] Lead quality AI error:', err);
    }
  }

  return { leadQuality, aiAnalysis };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAction(actions: any[] | undefined, type: string): number {
  if (!actions) return 0;
  const action = actions.find((a: any) => a.action_type === type);
  return action ? Number(action.value) : 0;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: Phase2Request = await req.json().catch(() => ({ action: 'budget_advisor', insights: [] }));

    const authResult = await verifyAuth(supabase, req.headers, body as any);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    const { action, insights, campaigns, datePreset, healthScores } = body;
    console.log(`[analyze-meta-ads-phase2] Action: ${action}, insights: ${insights?.length || 0}`);

    let response: Record<string, unknown> = { success: true };

    switch (action) {
      case 'budget_advisor': {
        const recommendations = generateBudgetRecommendations(insights, campaigns || null, healthScores || null);
        const audienceInsights = analyzeAudiences(insights);
        const aiAnalysis = await generateAIBudgetAnalysis(insights, recommendations, audienceInsights);

        response = {
          success: true,
          recommendations,
          audienceInsights,
          aiAnalysis: aiAnalysis === '__RATE_LIMITED__' || aiAnalysis === '__PAYMENT_REQUIRED__' ? '' : aiAnalysis,
          aiError: aiAnalysis === '__RATE_LIMITED__' ? 'Rate limited' : aiAnalysis === '__PAYMENT_REQUIRED__' ? 'Credits exhausted' : undefined,
          summary: {
            totalRecommendations: recommendations.length,
            highPriority: recommendations.filter(r => r.priority === 'high').length,
            potentialSavings: recommendations.filter(r => r.suggested_change < 0).reduce((s, r) => s + Math.abs(r.suggested_change), 0),
          },
        };
        break;
      }

      case 'audience_intelligence': {
        const audienceInsights = analyzeAudiences(insights);
        response = {
          success: true,
          audienceInsights,
          topPerformers: audienceInsights.filter(a => a.performance_index >= 65),
          underperformers: audienceInsights.filter(a => a.performance_index < 35),
        };
        break;
      }

      case 'lead_quality': {
        const { leadQuality, aiAnalysis } = await analyzeLeadQuality(supabase, insights);
        response = {
          success: true,
          leadQuality,
          aiAnalysis,
        };
        break;
      }

      default:
        response = { success: false, error: `Unknown action: ${action}` };
    }

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[analyze-meta-ads-phase2] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'analyze-meta-ads-phase2'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
