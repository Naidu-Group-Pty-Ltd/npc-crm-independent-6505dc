import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { internalError } from '../_shared/errorResponse.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CampaignInsight {
  campaign_id: string;
  campaign_name: string;
  adset_name?: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  cpm: string;
  reach: string;
  frequency: string;
  actions?: { action_type: string; value: string }[];
  cost_per_action_type?: { action_type: string; value: string }[];
  purchase_roas?: { action_type: string; value: string }[];
}

interface CampaignMeta {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface Anomaly {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: 'cpl_spike' | 'ctr_drop' | 'creative_fatigue' | 'budget_drain' | 'zero_conversion' | 'high_frequency' | 'spend_inefficiency';
  campaign_name: string;
  campaign_id: string;
  title: string;
  description: string;
  metric_value: number;
  threshold_value: number;
}

interface HealthScore {
  campaign_id: string;
  campaign_name: string;
  score: number;
  status: 'healthy' | 'watch' | 'action_needed';
  factors: {
    ctr_score: number;
    cpl_score: number;
    frequency_score: number;
    efficiency_score: number;
    volume_score: number;
  };
  recommendations: string[];
}

// ─── Anomaly Detection Engine ────────────────────────────────────────────────

function detectAnomalies(
  insights: CampaignInsight[],
  campaigns: CampaignMeta[] | null
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  if (!insights || insights.length === 0) return anomalies;

  // Calculate account-level averages for comparison
  const accountAvg = {
    ctr: 0,
    cpc: 0,
    cpl: 0,
    spend: 0,
    frequency: 0,
  };
  let totalLeads = 0;
  let totalSpend = 0;
  let campaignsWithLeads = 0;

  for (const row of insights) {
    accountAvg.ctr += Number(row.ctr || 0);
    accountAvg.cpc += Number(row.cpc || 0);
    accountAvg.frequency += Number(row.frequency || 0);
    const spend = Number(row.spend || 0);
    totalSpend += spend;
    const leads = extractAction(row.actions, 'lead');
    totalLeads += leads;
    if (leads > 0) campaignsWithLeads++;
  }

  const n = insights.length;
  accountAvg.ctr /= n;
  accountAvg.cpc /= n;
  accountAvg.frequency /= n;
  accountAvg.spend = totalSpend / n;
  accountAvg.cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  for (const row of insights) {
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const ctr = Number(row.ctr || 0);
    const frequency = Number(row.frequency || 0);
    const leads = extractAction(row.actions, 'lead');
    const cpl = leads > 0 ? spend / leads : 0;
    const campaignName = row.campaign_name || 'Unknown Campaign';
    const campaignId = row.campaign_id || '';

    // 1. Zero Conversion Detection - spending but no leads
    if (spend > 50 && leads === 0) {
      anomalies.push({
        id: `zero-conv-${campaignId}`,
        type: spend > 200 ? 'critical' : 'warning',
        category: 'zero_conversion',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'Zero Leads Despite Spend',
        description: `${campaignName} has spent ${formatCurrency(spend)} with zero lead conversions. Consider reviewing targeting or creative.`,
        metric_value: spend,
        threshold_value: 0,
      });
    }

    // 2. CPL Spike - campaign CPL is >80% higher than account average
    if (leads > 0 && accountAvg.cpl > 0 && cpl > accountAvg.cpl * 1.8) {
      anomalies.push({
        id: `cpl-spike-${campaignId}`,
        type: cpl > accountAvg.cpl * 2.5 ? 'critical' : 'warning',
        category: 'cpl_spike',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'CPL Significantly Above Average',
        description: `CPL of ${formatCurrency(cpl)} is ${((cpl / accountAvg.cpl - 1) * 100).toFixed(0)}% above account average of ${formatCurrency(accountAvg.cpl)}.`,
        metric_value: cpl,
        threshold_value: accountAvg.cpl,
      });
    }

    // 3. CTR Drop - campaign CTR is <50% of account average
    if (impressions > 1000 && accountAvg.ctr > 0 && ctr < accountAvg.ctr * 0.5) {
      anomalies.push({
        id: `ctr-drop-${campaignId}`,
        type: 'warning',
        category: 'ctr_drop',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'CTR Well Below Average',
        description: `CTR of ${ctr.toFixed(2)}% is ${((1 - ctr / accountAvg.ctr) * 100).toFixed(0)}% below account average of ${accountAvg.ctr.toFixed(2)}%.`,
        metric_value: ctr,
        threshold_value: accountAvg.ctr,
      });
    }

    // 4. Creative Fatigue - high frequency + declining engagement
    if (frequency > 3.0) {
      const fatigueLevel = frequency > 5.0 ? 'critical' : 'warning';
      anomalies.push({
        id: `fatigue-${campaignId}`,
        type: fatigueLevel,
        category: 'creative_fatigue',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'Creative Fatigue Detected',
        description: `Frequency of ${frequency.toFixed(1)} means users are seeing ads ${frequency.toFixed(1)}x on average. Refresh creatives to avoid ad blindness.`,
        metric_value: frequency,
        threshold_value: 3.0,
      });
    }

    // 5. High Frequency Warning
    if (frequency > 2.0 && frequency <= 3.0 && ctr < accountAvg.ctr) {
      anomalies.push({
        id: `high-freq-${campaignId}`,
        type: 'info',
        category: 'high_frequency',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'Frequency Rising',
        description: `Frequency at ${frequency.toFixed(1)} with below-average CTR. Monitor for creative fatigue.`,
        metric_value: frequency,
        threshold_value: 2.0,
      });
    }

    // 6. Budget Drain - high spend relative to average but poor results
    if (spend > accountAvg.spend * 1.5 && leads === 0 && impressions > 500) {
      anomalies.push({
        id: `drain-${campaignId}`,
        type: 'critical',
        category: 'budget_drain',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'Budget Drain Alert',
        description: `Spending ${((spend / accountAvg.spend - 1) * 100).toFixed(0)}% above average with no conversions. Immediate review recommended.`,
        metric_value: spend,
        threshold_value: accountAvg.spend,
      });
    }

    // 7. Spend Inefficiency - high CPC with low CTR combo
    if (clicks > 10 && Number(row.cpc || 0) > accountAvg.cpc * 2 && ctr < accountAvg.ctr * 0.7) {
      anomalies.push({
        id: `inefficient-${campaignId}`,
        type: 'warning',
        category: 'spend_inefficiency',
        campaign_name: campaignName,
        campaign_id: campaignId,
        title: 'Spend Inefficiency',
        description: `High CPC (${formatCurrency(Number(row.cpc))}) combined with low CTR (${ctr.toFixed(2)}%). Ad relevance may be poor.`,
        metric_value: Number(row.cpc || 0),
        threshold_value: accountAvg.cpc,
      });
    }
  }

  // Sort: critical first, then warning, then info
  const priority = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => priority[a.type] - priority[b.type]);

  return anomalies;
}

// ─── Campaign Health Scoring ─────────────────────────────────────────────────

function calculateHealthScores(
  insights: CampaignInsight[],
  campaigns: CampaignMeta[] | null
): HealthScore[] {
  if (!insights || insights.length === 0) return [];

  // Calculate benchmarks from account data
  const allCtrs = insights.map(r => Number(r.ctr || 0)).filter(v => v > 0);
  const avgCtr = allCtrs.length > 0 ? allCtrs.reduce((a, b) => a + b, 0) / allCtrs.length : 1;
  const bestCtr = Math.max(...allCtrs, avgCtr);

  let totalSpend = 0;
  let totalLeads = 0;
  for (const r of insights) {
    totalSpend += Number(r.spend || 0);
    totalLeads += extractAction(r.actions, 'lead');
  }
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 50; // fallback $50

  return insights.map(row => {
    const spend = Number(row.spend || 0);
    const ctr = Number(row.ctr || 0);
    const frequency = Number(row.frequency || 0);
    const impressions = Number(row.impressions || 0);
    const leads = extractAction(row.actions, 'lead');
    const cpl = leads > 0 ? spend / leads : 0;
    const campaignName = row.campaign_name || 'Unknown';
    const campaignId = row.campaign_id || '';

    // Factor 1: CTR Score (20%) - how does CTR compare to account best
    let ctrScore = 0;
    if (bestCtr > 0) {
      ctrScore = Math.min(100, (ctr / bestCtr) * 100);
    }

    // Factor 2: CPL Score (25%) - lower is better, compared to account avg
    let cplScore = 0;
    if (leads === 0 && spend > 20) {
      cplScore = 0; // No conversions = 0
    } else if (leads === 0 && spend <= 20) {
      cplScore = 50; // Too early to tell
    } else if (avgCpl > 0) {
      // If CPL is half the average, score 100. If double, score ~25
      cplScore = Math.min(100, Math.max(0, (avgCpl / cpl) * 75));
    }

    // Factor 3: Frequency Score (15%) - lower frequency is healthier
    let frequencyScore = 100;
    if (frequency > 5) frequencyScore = 10;
    else if (frequency > 4) frequencyScore = 25;
    else if (frequency > 3) frequencyScore = 45;
    else if (frequency > 2) frequencyScore = 70;
    else if (frequency > 1.5) frequencyScore = 85;

    // Factor 4: Efficiency Score (20%) - spend vs results ratio
    let efficiencyScore = 50;
    if (leads > 0) {
      const leadsPerDollar = leads / Math.max(spend, 1);
      const avgLeadsPerDollar = totalLeads / Math.max(totalSpend, 1);
      if (avgLeadsPerDollar > 0) {
        efficiencyScore = Math.min(100, (leadsPerDollar / avgLeadsPerDollar) * 75);
      }
    } else if (spend > 100) {
      efficiencyScore = 15;
    }

    // Factor 5: Volume Score (20%) - absolute lead volume contribution
    let volumeScore = 50;
    if (totalLeads > 0) {
      const shareOfLeads = leads / totalLeads;
      const shareOfCampaigns = 1 / insights.length;
      volumeScore = Math.min(100, (shareOfLeads / shareOfCampaigns) * 60 + 20);
    } else if (leads > 0) {
      volumeScore = 80;
    }

    // Weighted final score
    const score = Math.round(
      ctrScore * 0.20 +
      cplScore * 0.25 +
      frequencyScore * 0.15 +
      efficiencyScore * 0.20 +
      volumeScore * 0.20
    );

    // Status classification
    let status: 'healthy' | 'watch' | 'action_needed' = 'healthy';
    if (score < 35) status = 'action_needed';
    else if (score < 60) status = 'watch';

    // Generate recommendations based on weak factors
    const recommendations: string[] = [];
    if (ctrScore < 40) recommendations.push('CTR is low — test new ad creatives or refine audience targeting');
    if (cplScore < 30 && leads > 0) recommendations.push('Cost per lead is high — review landing page conversion rate');
    if (cplScore === 0 && spend > 50) recommendations.push('No leads generated — consider pausing and restructuring');
    if (frequencyScore < 50) recommendations.push('Audience fatigue detected — refresh creatives or expand audience');
    if (efficiencyScore < 30) recommendations.push('Low spend efficiency — reallocate budget to higher-performing campaigns');
    if (recommendations.length === 0 && score > 70) recommendations.push('Campaign performing well — consider scaling budget');

    return {
      campaign_id: campaignId,
      campaign_name: campaignName,
      score,
      status,
      factors: {
        ctr_score: Math.round(ctrScore),
        cpl_score: Math.round(cplScore),
        frequency_score: Math.round(frequencyScore),
        efficiency_score: Math.round(efficiencyScore),
        volume_score: Math.round(volumeScore),
      },
      recommendations,
    };
  });
}

// ─── AI Performance Digest ───────────────────────────────────────────────────

async function generateAIDigest(
  insights: CampaignInsight[],
  campaigns: CampaignMeta[] | null,
  anomalies: Anomaly[],
  healthScores: HealthScore[],
  datePreset: string
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.warn('[analyze-meta-ads] LOVABLE_API_KEY not available, skipping AI digest');
    return '';
  }

  // Build a concise data summary for the AI
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalReach = 0, totalLeads = 0;
  const campaignSummaries: string[] = [];

  for (const row of insights) {
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const reach = Number(row.reach || 0);
    const leads = extractAction(row.actions, 'lead');
    const ctr = Number(row.ctr || 0);
    const cpl = leads > 0 ? spend / leads : 0;
    const freq = Number(row.frequency || 0);

    totalSpend += spend;
    totalImpressions += impressions;
    totalClicks += clicks;
    totalReach += reach;
    totalLeads += leads;

    const health = healthScores.find(h => h.campaign_id === row.campaign_id);
    const status = campaigns?.find(c => c.id === row.campaign_id);

    campaignSummaries.push(
      `- "${row.campaign_name}" | Status: ${status?.status || 'N/A'} | Spend: $${spend.toFixed(2)} | Leads: ${leads} | CPL: ${cpl > 0 ? '$' + cpl.toFixed(2) : 'N/A'} | CTR: ${ctr.toFixed(2)}% | Freq: ${freq.toFixed(1)} | Health: ${health?.score || 'N/A'}/100 (${health?.status || 'N/A'})`
    );
  }

  const totalCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const anomalySummary = anomalies.length > 0
    ? anomalies.map(a => `- [${a.type.toUpperCase()}] ${a.title}: ${a.description}`).join('\n')
    : 'No anomalies detected.';

  const prompt = `You are an expert digital marketing analyst for a property buyers' agency in Australia. Analyze the following Meta Ads performance data and provide a concise, actionable executive summary.

**Period**: ${datePreset.replace(/_/g, ' ')}

**Account Totals**:
- Total Spend: $${totalSpend.toFixed(2)}
- Total Impressions: ${totalImpressions.toLocaleString()}
- Total Clicks: ${totalClicks.toLocaleString()}
- Total Reach: ${totalReach.toLocaleString()}
- Total Leads: ${totalLeads}
- Account CTR: ${totalCtr.toFixed(2)}%
- Average CPL: ${avgCpl > 0 ? '$' + avgCpl.toFixed(2) : 'No leads yet'}

**Campaign Breakdown**:
${campaignSummaries.join('\n')}

**Detected Anomalies**:
${anomalySummary}

**Instructions**:
1. Start with a 1-2 sentence overall performance verdict
2. Identify the TOP PERFORMER and explain why
3. Identify the WORST PERFORMER and what action to take
4. Comment on any critical anomalies
5. End with 2-3 specific, actionable recommendations
6. Keep the tone professional but direct — this is for internal use by the agency director
7. Use Australian dollar formatting
8. Keep the entire response under 300 words
9. Use markdown formatting with bold for key metrics and campaign names

**CRITICAL FORMATTING RULES — You MUST use these custom fence blocks to structure your response:**
- Wrap your opening verdict in :::success or :::warning depending on performance
- Wrap key KPI callouts using :::metric blocks with Label/Value/Change fields
- Wrap each actionable recommendation in a :::tip block
- Wrap any risk or concern in a :::warning block
- Wrap deeper analytical insights in :::insight blocks
- You can still use standard markdown (bold, headers) BETWEEN blocks

Example metric block:
:::metric
Label: Average CPL
Value: $36.09
Change: -12% vs last period
:::

Example tip block:
:::tip
**Scale Top Performer**: Increase budget on "Campaign Name" by 10-15% — it has the lowest CPL at $31.96.
:::

Example warning block:
:::warning
**Quiz Funnel Underperforming**: CTR of 1.05% with zero conversions suggests creative fatigue or targeting issues.
:::

Do NOT output raw plain text paragraphs — structure everything using these blocks.`;

  try {
    const response = await callLLMRaw({
      agentKey: 'meta_ads_digest',
      messages: [
        { role: 'system', content: 'You are a senior performance marketing analyst specializing in property and real estate advertising in Australia. Provide data-driven insights with specific numbers and actionable recommendations.' },
        { role: 'user', content: prompt },
      ],
    });

    if (!response.ok) {
      const statusCode = response.status;
      const errorText = await response.text();
      console.error(`[analyze-meta-ads] AI gateway error ${statusCode}:`, errorText);
      if (statusCode === 429) return '__RATE_LIMITED__';
      if (statusCode === 402) return '__PAYMENT_REQUIRED__';
      return '';
    }

    const aiData = await response.json();
    return aiData.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[analyze-meta-ads] AI digest error:', err);
    return '';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractAction(actions: any[] | undefined, type: string): number {
  if (!actions) return 0;
  const action = actions.find((a: any) => a.action_type === type);
  return action ? Number(action.value) : 0;
}

function formatCurrency(val: number): string {
  return `$${val.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

    const body = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    // Marketing is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, authResult, 'marketing');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const { insights, campaigns, datePreset, skipAiDigest } = body;

    if (!insights || !Array.isArray(insights)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing insights data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[analyze-meta-ads] Analyzing ${insights.length} campaign insights for user ${authResult.userId}`);

    // Run anomaly detection
    const anomalies = detectAnomalies(insights, campaigns || null);
    console.log(`[analyze-meta-ads] Detected ${anomalies.length} anomalies`);

    // Calculate health scores
    const healthScores = calculateHealthScores(insights, campaigns || null);
    console.log(`[analyze-meta-ads] Calculated ${healthScores.length} health scores`);

    // Generate AI digest (unless explicitly skipped)
    let aiDigest = '';
    if (!skipAiDigest && insights.length > 0) {
      aiDigest = await generateAIDigest(insights, campaigns || null, anomalies, healthScores, datePreset || 'last_30d');
    }

    // Log API usage
    await supabase.from('api_usage_log').insert({
      service_name: 'meta_ads_analysis',
      endpoint: 'analyze',
      status: 'success',
      request_count: 1,
      metadata: {
        campaigns_analyzed: insights.length,
        anomalies_found: anomalies.length,
        ai_digest_generated: !!aiDigest && aiDigest !== '__RATE_LIMITED__' && aiDigest !== '__PAYMENT_REQUIRED__',
      },
    });

    const responsePayload: Record<string, unknown> = {
      success: true,
      anomalies,
      healthScores,
      aiDigest: aiDigest === '__RATE_LIMITED__' || aiDigest === '__PAYMENT_REQUIRED__' ? '' : aiDigest,
      summary: {
        totalAnomalies: anomalies.length,
        criticalAnomalies: anomalies.filter(a => a.type === 'critical').length,
        warningAnomalies: anomalies.filter(a => a.type === 'warning').length,
        avgHealthScore: healthScores.length > 0
          ? Math.round(healthScores.reduce((s, h) => s + h.score, 0) / healthScores.length)
          : 0,
        campaignsNeedingAction: healthScores.filter(h => h.status === 'action_needed').length,
      },
    };

    if (aiDigest === '__RATE_LIMITED__') {
      responsePayload.aiDigestError = 'Rate limited — please try again in a moment';
    } else if (aiDigest === '__PAYMENT_REQUIRED__') {
      responsePayload.aiDigestError = 'AI credits exhausted — top up in Lovable workspace settings';
    }

    return new Response(
      JSON.stringify(responsePayload),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[analyze-meta-ads] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'analyze-meta-ads'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
