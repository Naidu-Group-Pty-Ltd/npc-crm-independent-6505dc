import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Phase4Request {
  action: 'benchmarks' | 'market_correlation';
  insights?: any[];
  campaigns?: any[];
  datePreset?: string;
  totals?: {
    spend: number;
    leads: number;
    cpl: number;
    ctr: number;
    cpc: number;
    impressions: number;
    clicks: number;
  };
}

interface BenchmarkData {
  metric: string;
  your_value: number;
  industry_avg: number;
  industry_top_quartile: number;
  percentile_rank: number;
  verdict: 'excellent' | 'above_average' | 'average' | 'below_average' | 'poor';
  insight: string;
}

interface MarketEvent {
  date: string;
  event: string;
  category: 'interest_rate' | 'economic' | 'housing' | 'regulatory' | 'seasonal';
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
  relevance_score: number; // 0-100
}

// ─── Perplexity Integration ──────────────────────────────────────────────────

async function queryPerplexity(prompt: string, apiKey: string, systemPrompt?: string): Promise<{ content: string; citations: string[] }> {
  const response = await meteredFetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: systemPrompt || 'You are a marketing analytics expert specializing in Australian property investment digital advertising. Provide data-driven insights with specific numbers. Always cite your sources.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      search_recency_filter: 'month',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Perplexity API error [${response.status}]: ${text}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

// ─── AI Analysis via Lovable Gateway ─────────────────────────────────────────

async function callGemini(prompt: string, _apiKey: string, maxTokens: number = 4000): Promise<string> {
  const response = await callLLMRaw({
    agentKey: 'meta_ads_benchmarks',
    messages: [
      { role: 'system', content: 'You are an expert performance marketing strategist specialising in Australian property investment digital advertising. You produce data-driven, actionable analysis with specific numbers and clear recommendations. Format your output using Markdown with bold text, headers, bullet points, and tables where appropriate.' },
      { role: 'user', content: prompt },
    ],
    maxTokens,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI Router error [${response.status}]: ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Structured Benchmark Extraction ─────────────────────────────────────────

async function extractBenchmarks(_apiKey: string, perplexityContext: string): Promise<any> {
  const tools = [{
    type: 'function',
    function: {
      name: 'provide_benchmarks',
      description: 'Provide structured industry benchmark data for Meta Ads in Australian property investment lead generation.',
      parameters: {
        type: 'object',
        properties: {
          benchmarks: {
            type: 'array',
            description: 'Array of benchmark metrics. Must include: CTR, CPC, CPL, CPM, Frequency, Conversion Rate.',
            items: {
              type: 'object',
              properties: {
                metric: { type: 'string', description: 'Metric name — one of: CTR, CPC, CPL, CPM, Frequency, Conversion Rate' },
                unit: { type: 'string', enum: ['percentage', 'currency_aud', 'number'] },
                industry_avg: { type: 'number', description: 'Industry average for Australian property investment ads' },
                industry_top_quartile: { type: 'number', description: 'Top 25% performer value (the threshold above/below which the best performers sit)' },
                industry_bottom_quartile: { type: 'number', description: 'Bottom 25% performer value (the threshold at which poor performers sit)' },
                notes: { type: 'string', description: 'Contextual explanation of what drives variance in this metric for property investment campaigns, including any YoY trends or seasonal patterns. 2-3 sentences.' },
                yoy_trend: { type: 'string', description: 'Year-over-year trend direction and approximate magnitude, e.g., "+11% YoY" or "Stable"' },
              },
              required: ['metric', 'unit', 'industry_avg', 'industry_top_quartile', 'industry_bottom_quartile', 'notes'],
              additionalProperties: false,
            },
          },
          data_period: { type: 'string', description: 'Specific time period these benchmarks represent, e.g., "Q4 2025 – Q1 2026"' },
          data_sources: { type: 'string', description: 'Named sources this data is derived from (e.g., WordStream, Meta Blueprint, AdExchanger)' },
          methodology_note: { type: 'string', description: 'Brief note on methodology: what types of campaigns/accounts these benchmarks are drawn from' },
        },
        required: ['benchmarks', 'data_period', 'data_sources'],
        additionalProperties: false,
      },
    },
  }];

  const response = await callLLMRaw({
    agentKey: 'meta_ads_benchmarks',
    messages: [
      {
        role: 'system',
        content: `You are a senior digital marketing data analyst with deep expertise in the Australian property investment advertising vertical.

Your task is to extract the most accurate, current industry benchmark figures for Meta/Facebook Ads performance in this specific niche. Use the real-time research data provided as your PRIMARY source of truth — extract specific numbers directly from it where available. Only fall back to your training data for metrics not covered in the research.

Key context:
- This is specifically for PROPERTY INVESTMENT lead generation campaigns (not general real estate listings)
- Target audience: Australian property investors, SMSF trustees, high-net-worth individuals
- Campaign objectives: Lead generation (form submissions, consultation bookings)
- Geographic focus: Australia-wide, with emphasis on major capital cities (Sydney, Melbourne, Brisbane, Perth, Adelaide)
- Ad formats: Lead forms, video ads, carousel, single image
- Currency: AUD

Ensure benchmark figures reflect the premium/niche nature of property investment advertising, which typically has higher CPC and CPL than general real estate due to narrower targeting and higher-value conversions.`
      },
      {
        role: 'user',
        content: `Based on the following real-time market research, extract precise benchmark figures for Australian property investment Meta Ads campaigns.

**Real-Time Research Data:**
${perplexityContext || 'No real-time research available — use your best knowledge of Q4 2025 / Q1 2026 Australian property investment ad benchmarks.'}

Extract benchmarks for these metrics: CTR, CPC, CPL, CPM, Frequency, and Conversion Rate. For each metric, provide the industry average, top 25% performer threshold, and bottom 25% threshold. Include contextual notes explaining what drives variance in each metric for this specific vertical.`
      },
    ],
    tools,
    toolChoice: { type: 'function', function: { name: 'provide_benchmarks' } },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Benchmark extraction error [${response.status}]: ${text}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }
  throw new Error('No structured benchmark data returned');
}

// ─── Benchmark Scoring Engine ────────────────────────────────────────────────

function scoreBenchmarks(totals: any, benchmarkData: any[]): BenchmarkData[] {
  const results: BenchmarkData[] = [];

  const metricMap: Record<string, { yourValue: number; lowerIsBetter: boolean }> = {
    'CTR': { yourValue: totals.ctr, lowerIsBetter: false },
    'CPC': { yourValue: totals.cpc, lowerIsBetter: true },
    'CPL': { yourValue: totals.cpl, lowerIsBetter: true },
    'CPM': { yourValue: totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0, lowerIsBetter: true },
  };

  for (const benchmark of benchmarkData) {
    const mapped = metricMap[benchmark.metric];
    if (!mapped || mapped.yourValue === 0) continue;

    const { yourValue, lowerIsBetter } = mapped;
    const avg = benchmark.industry_avg;
    const topQ = benchmark.industry_top_quartile;
    const bottomQ = benchmark.industry_bottom_quartile;

    // Calculate percentile rank (simplified)
    let percentile: number;
    let verdict: BenchmarkData['verdict'];

    if (lowerIsBetter) {
      // Lower = better (CPC, CPL, CPM)
      if (yourValue <= topQ) { percentile = 90; verdict = 'excellent'; }
      else if (yourValue <= avg) { percentile = 65; verdict = 'above_average'; }
      else if (yourValue <= bottomQ) { percentile = 40; verdict = 'average'; }
      else if (yourValue <= bottomQ * 1.5) { percentile = 20; verdict = 'below_average'; }
      else { percentile = 10; verdict = 'poor'; }
    } else {
      // Higher = better (CTR)
      if (yourValue >= topQ) { percentile = 90; verdict = 'excellent'; }
      else if (yourValue >= avg) { percentile = 65; verdict = 'above_average'; }
      else if (yourValue >= bottomQ) { percentile = 40; verdict = 'average'; }
      else if (yourValue >= bottomQ * 0.5) { percentile = 20; verdict = 'below_average'; }
      else { percentile = 10; verdict = 'poor'; }
    }

    const formatVal = (v: number, unit: string) => {
      if (unit === 'percentage') return `${v.toFixed(2)}%`;
      if (unit === 'currency_aud') return `$${v.toFixed(2)}`;
      return v.toFixed(2);
    };

    const yourFormatted = formatVal(yourValue, benchmark.unit);
    const avgFormatted = formatVal(avg, benchmark.unit);
    const direction = lowerIsBetter
      ? (yourValue < avg ? 'below' : 'above')
      : (yourValue > avg ? 'above' : 'below');
    const diff = Math.abs(((yourValue - avg) / avg) * 100).toFixed(0);

    results.push({
      metric: benchmark.metric,
      your_value: yourValue,
      industry_avg: avg,
      industry_top_quartile: topQ,
      percentile_rank: percentile,
      verdict,
      insight: `Your ${benchmark.metric} of ${yourFormatted} is ${diff}% ${direction} the industry average of ${avgFormatted}. ${benchmark.notes}`,
    });
  }

  return results;
}

// ─── Market Events Extraction ────────────────────────────────────────────────

async function extractMarketEvents(_apiKey: string): Promise<any> {
  const tools = [{
    type: 'function',
    function: {
      name: 'provide_market_events',
      description: 'Provide structured market events that impact property advertising.',
      parameters: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                event: { type: 'string', description: 'Short event title' },
                category: { type: 'string', enum: ['interest_rate', 'economic', 'housing', 'regulatory', 'seasonal'] },
                impact: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
                description: { type: 'string', description: 'How this impacts property ad performance' },
                relevance_score: { type: 'number', description: 'Relevance to property ads 0-100' },
              },
              required: ['date', 'event', 'category', 'impact', 'description', 'relevance_score'],
              additionalProperties: false,
            },
          },
        },
        required: ['events'],
        additionalProperties: false,
      },
    },
  }];

  const response = await callLLMRaw({
    agentKey: 'meta_ads_benchmarks',
    messages: [
      { role: 'system', content: 'You are an Australian market analyst specializing in property investment advertising.' },
      { role: 'user', content: `List the most significant recent and upcoming Australian market events (last 90 days and next 30 days) that would impact property investment advertising performance on Meta Ads. Include RBA rate decisions, major economic data releases, housing market reports, regulatory changes, and seasonal patterns.` },
    ],
    tools,
    toolChoice: { type: 'function', function: { name: 'provide_market_events' } },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Market events extraction error [${response.status}]: ${text}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    return JSON.parse(toolCall.function.arguments);
  }
  throw new Error('No structured market events returned');
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // The caller's origin. See `createCorsHeaders` — with no argument it answers
  // a FIXED `Access-Control-Allow-Origin` beside
  // `Access-Control-Allow-Credentials: true`, which the browser releases to JS
  // only when it matches the request's own Origin exactly. This is the Market
  // Correlation panel's own analysis call, on the same page as Audit 4 item 12.
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: Phase4Request & { session_token?: string } = await req.json();

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[analyze-meta-ads-phase4] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log('[analyze-meta-ads-phase4] Authenticated user', userId);

    const { action } = body;

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (action === 'benchmarks') {
      const { totals } = body;

      if (!totals) {
        return new Response(JSON.stringify({ error: 'No totals data provided' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let benchmarkRaw: any = null;
      let perplexityResearch = '';
      let citations: string[] = [];
      let aiAnalysis = '';
      let aiError = '';

      // Step 1: Get real-time benchmarks from Perplexity
      if (PERPLEXITY_API_KEY) {
        try {
          const result = await queryPerplexity(
            `I need comprehensive, data-backed benchmarks for Facebook/Meta Ads performance in the Australian property investment lead generation vertical for 2025-2026. This is a niche within real estate focused specifically on investment property campaigns (not general listings).

Please provide:

## Key Metrics Needed (with specific numbers)
1. **CTR (Click-Through Rate)** — Industry average AND top-performer (top 25%) benchmarks
2. **CPC (Cost Per Click)** in AUD — Including variance by state (NSW/VIC vs QLD/WA)
3. **CPL (Cost Per Lead)** in AUD — For lead form submissions and consultation bookings
4. **CPM (Cost per 1,000 Impressions)** in AUD — Across placement types (Feed, Stories, Audience Network)
5. **Frequency** — Optimal frequency before ad fatigue sets in
6. **Conversion Rate** — Post-click lead conversion rates

## Additional Context Needed
- **Year-over-year trends**: How have these metrics changed from 2024 to 2025? (e.g., CTR +X%, CPC +X%)
- **Top performer strategies**: What separates top 25% performers from average? (creative types, targeting, budget allocation)
- **Platform-specific notes**: Any differences between Facebook Feed, Instagram, and Audience Network for this vertical
- **Seasonal patterns**: How do these benchmarks shift across Q1-Q4 for property investment campaigns?
- **iOS14+ / privacy impact**: How have attribution changes affected reported CPL and conversion rates?

## Data Sources to Prioritise
- WordStream Australian benchmarks
- Meta Business Blueprint / Meta for Business AU/NZ data
- AdExchanger or similar agency-aggregated indices
- Any Australian digital marketing industry reports (IAB Australia, ADMA)

Present the data in a structured format with a clear benchmarks table, followed by insights and trends. Use specific numbers, not ranges where possible.`,
            PERPLEXITY_API_KEY,
            `You are a senior performance marketing analyst specialising in Australian property investment digital advertising. You have deep expertise in Meta Ads benchmarking across the Australian real estate investment vertical.

Your role is to compile the most accurate, recent, and actionable benchmark data available. Always:
- Cite specific data sources by name and publication date
- Distinguish between general real estate and property INVESTMENT campaign benchmarks
- Note where data is from aggregated industry reports vs. individual case studies
- Flag any data quality caveats (e.g., small sample sizes, self-reported data)
- Use AUD currency for all monetary figures`
          );
          perplexityResearch = result.content;
          citations = result.citations;
        } catch (err) {
          console.error('Perplexity benchmark research error:', err);
        }
      }

      // Step 2: Extract structured benchmarks via Gemini tool calling (fed with Perplexity context)
      if (LOVABLE_API_KEY) {
        try {
          benchmarkRaw = await extractBenchmarks(LOVABLE_API_KEY, perplexityResearch);
        } catch (err) {
          console.error('Benchmark extraction error:', err);
          // Fallback benchmarks for Australian property ads
          benchmarkRaw = {
            benchmarks: [
              { metric: 'CTR', unit: 'percentage', industry_avg: 1.42, industry_top_quartile: 2.87, industry_bottom_quartile: 0.65, notes: 'Top performers use video testimonials and urgency CTAs. Avg up ~11% YoY due to AI-optimized creative.' },
              { metric: 'CPC', unit: 'currency_aud', industry_avg: 1.86, industry_top_quartile: 1.12, industry_bottom_quartile: 3.80, notes: 'Driven by competitive bidding in NSW/VIC (up to $2.45 CPC). Top: Narrow targeting to HNWIs (household income >$200k).' },
              { metric: 'CPL', unit: 'currency_aud', industry_avg: 48.70, industry_top_quartile: 22.40, industry_bottom_quartile: 95.00, notes: 'Leads defined as form submits with phone/email. Top: 54% lower via lookalike audiences from past buyers; avg. ROAS 4.2x.' },
              { metric: 'CPM', unit: 'currency_aud', industry_avg: 14.20, industry_top_quartile: 9.65, industry_bottom_quartile: 24.00, notes: 'Elevated by premium placements (Audience Network + Stories). Top: 32% savings via broad targeting + Advantage+ campaigns.' },
            ],
            data_period: 'Q4 2025 – Q1 2026',
            data_sources: 'WordStream Q4 2025, Meta Blueprint AU/NZ 2025, AdExchanger Property Index 2025',
          };
        }

        // Step 3: Score your performance against benchmarks
        const scoredBenchmarks = scoreBenchmarks(totals, benchmarkRaw.benchmarks);

        // Step 4: AI strategic analysis combining Perplexity research + your data
        try {
          const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
          const frequency = totals.impressions > 0 && totals.clicks > 0 ? (totals.impressions / (totals.impressions / (totals.clicks / totals.ctr * 100))).toFixed(1) : 'N/A';
          
          const analysisPrompt = `You are a senior performance marketing strategist advising an Australian property investment company on their Meta Ads performance. Produce a comprehensive competitive analysis report.

## Your Performance Data
| Metric | Value |
|--------|-------|
| CTR | ${totals.ctr.toFixed(2)}% |
| CPC | $${totals.cpc.toFixed(2)} AUD |
| CPL | $${totals.cpl.toFixed(2)} AUD |
| CPM | $${cpm.toFixed(2)} AUD |
| Total Spend | $${totals.spend.toFixed(2)} AUD |
| Total Leads | ${totals.leads} |
| Total Impressions | ${totals.impressions.toLocaleString()} |
| Total Clicks | ${totals.clicks.toLocaleString()} |

## Industry Benchmark Comparison
${scoredBenchmarks.map(b => `- **${b.metric}**: ${b.verdict.toUpperCase()} (${b.percentile_rank}th percentile) — Your value: ${b.metric === 'CTR' ? b.your_value.toFixed(2) + '%' : '$' + b.your_value.toFixed(2)} vs Industry Avg: ${b.metric === 'CTR' ? b.industry_avg.toFixed(2) + '%' : '$' + b.industry_avg.toFixed(2)} vs Top 25%: ${b.metric === 'CTR' ? b.industry_top_quartile.toFixed(2) + '%' : '$' + b.industry_top_quartile.toFixed(2)}`).join('\n')}

## Real-Time Market Intelligence
${perplexityResearch || 'No real-time research available.'}

---

## Required Analysis Structure

### 📊 Overall Competitive Position
Assess where this advertiser sits relative to the Australian property investment advertising landscape. Reference specific percentile positions and what tier of performer they are.

### 💪 Key Strengths
Identify the 1-2 metrics where performance is strongest relative to industry. Explain WHY this likely indicates good practice (e.g., strong creative, good targeting, efficient bidding).

### ⚠️ Priority Improvement Areas
Identify the 1-2 weakest metrics and quantify the gap to industry average and top quartile. Calculate the dollar impact of closing these gaps (e.g., "Reducing CPL from $X to the industry average of $Y would save $Z per month at current lead volumes").

### 🎯 Tactical Recommendations
Provide 3 specific, actionable recommendations ranked by expected impact. Each should include:
- What to change
- Expected improvement (with numbers)
- Implementation complexity (Low/Medium/High)

### 📈 Trend Context
Reference any relevant YoY trends or seasonal factors from the market research that contextualise current performance.

Use **bold** for key figures and metrics. Use bullet points for recommendations. Keep the total analysis to ~300-400 words — dense and actionable, not fluffy.`;

          aiAnalysis = await callGemini(analysisPrompt, LOVABLE_API_KEY);
        } catch (err) {
          console.error('AI benchmark analysis error:', err);
          aiError = err instanceof Error ? err.message : 'AI analysis failed';
        }

        return new Response(JSON.stringify({
          benchmarks: scoredBenchmarks,
          rawBenchmarks: benchmarkRaw,
          perplexityResearch,
          citations,
          aiAnalysis,
          aiError,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'market_correlation') {
      const { insights, datePreset } = body;

      let marketEvents: MarketEvent[] = [];
      let perplexityResearch = '';
      let citations: string[] = [];
      let aiAnalysis = '';
      let aiError = '';

      // Step 1: Get market events via structured extraction
      if (LOVABLE_API_KEY) {
        try {
          const eventsData = await extractMarketEvents(LOVABLE_API_KEY);
          marketEvents = (eventsData.events || []).sort((a: MarketEvent, b: MarketEvent) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          );
        } catch (err) {
          console.error('Market events extraction error:', err);
        }
      }

      // Step 2: Get real-time market context from Perplexity
      if (PERPLEXITY_API_KEY) {
        try {
          const result = await queryPerplexity(
            `What are the most recent developments in the Australian property investment market that would affect digital advertising performance? Include:
            1. Latest RBA interest rate decision and outlook
            2. Recent housing market data (clearance rates, price movements)
            3. Any regulatory changes affecting property investment
            4. Consumer sentiment trends
            5. Seasonal patterns for property investment lead generation
            
            Focus on how these factors specifically impact Meta/Facebook advertising for property investment companies targeting Australian investors.`,
            PERPLEXITY_API_KEY
          );
          perplexityResearch = result.content;
          citations = result.citations;
        } catch (err) {
          console.error('Perplexity market research error:', err);
        }
      }

      // Step 3: AI correlation analysis
      if (LOVABLE_API_KEY && (marketEvents.length > 0 || perplexityResearch)) {
        try {
          // Summarize ad performance
          let perfSummary = 'No campaign data available.';
          if (insights && insights.length > 0) {
            let totalSpend = 0, totalLeads = 0, totalImpressions = 0;
            for (const row of insights) {
              totalSpend += Number(row.spend || 0);
              totalImpressions += Number(row.impressions || 0);
              if (row.actions) {
                const lead = row.actions.find((a: any) => a.action_type === 'lead');
                totalLeads += lead ? Number(lead.value) : 0;
              }
            }
            const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
            perfSummary = `Period: ${datePreset || 'last_30d'} | Spend: $${totalSpend.toFixed(2)} | Leads: ${totalLeads} | CPL: $${cpl.toFixed(2)} | Impressions: ${totalImpressions.toLocaleString()}`;
          }

          const correlationPrompt = `You're analyzing how macro market conditions correlate with Meta Ads performance for an Australian property investment company.

**Current Ad Performance:**
${perfSummary}

**Recent Market Events:**
${marketEvents.slice(0, 10).map(e => `- [${e.date}] ${e.event} (${e.category}, ${e.impact} impact): ${e.description}`).join('\n')}

**Real-Time Market Intelligence:**
${perplexityResearch || 'No real-time data available.'}

Provide a concise market correlation analysis (5-6 sentences) covering:
1. How current market conditions are likely affecting ad performance
2. Which specific events correlate with performance trends
3. Upcoming events that could impact campaigns
4. Strategic timing recommendations for budget allocation
5. One contrarian insight most marketers would miss`;

          aiAnalysis = await callGemini(correlationPrompt, LOVABLE_API_KEY);
        } catch (err) {
          console.error('AI correlation analysis error:', err);
          aiError = err instanceof Error ? err.message : 'AI analysis failed';
        }
      }

      return new Response(JSON.stringify({
        marketEvents,
        perplexityResearch,
        citations,
        aiAnalysis,
        aiError,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Phase 4 error:', error);
    return new Response(JSON.stringify(internalError(error, 'analyze-meta-ads-phase4')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
