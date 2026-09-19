import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLMRaw } from '../_shared/llmRouter.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';
import { resolvePrompt } from '../_shared/engine-prompts.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReportRequest {
  session_token?: string;
  report_type?: string;
  audience_segment?: string;
  /** New canonical name. */
  include_advisory_strategy?: boolean;
  /** @deprecated kept for backward-compat with old callers. */
  include_npc_strategy?: boolean;
  /**
   * The correlation block, when the report was started from the correlation
   * panel.
   *
   * Persisted into `report_data` from here on. `MarketCorrelationPanel` has
   * always handed this straight to the browser-side PDF generator in memory
   * (`MarketCorrelationPanel.tsx:128` → `MarketIntelligenceExportButton.tsx:91`)
   * and nothing ever wrote it down, so the History modal — which only has the
   * row — could not supply it and every re-download silently dropped the whole
   * Correlation Highlights section. Measured: zero of the six stored reports
   * carry one.
   *
   * Optional, and callers that omit it are unaffected.
   */
  correlation_data?: {
    aiAnalysis?: string;
    perplexityResearch?: string;
    citations?: string[];
  };
}

interface PerplexityResult {
  content: string;
  citations: string[];
}

// Report type configurations — which layers each type needs
const REPORT_TYPE_LAYERS: Record<string, string[]> = {
  full: ['layer1', 'layer2', 'layer3', 'layer4', 'layer5', 'layer6', 'layer7', 'layer8', 'events', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  market_pulse: ['layer1', 'layer3', 'layer6', 'events', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  hotspot_deep_dive: ['layer1', 'layer2', 'layer7', 'layer8', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  strategy_insight: ['layer5', 'layer7', 'layer8', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  finance_update: ['layer1', 'layer4', 'layer6', 'events', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  deal_breakdown: ['layer2', 'layer7', 'layer8', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  myth_busting: ['layer1', 'layer2', 'layer3', 'layer6', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
  development_spotlight: ['layer2', 'layer7', 'layer8', 'executive', 'key_insights', 'actionable_strategy', 'cta'],
};

// Module-level brand name — set per-request at the top of Deno.serve, then
// referenced inside helper prompts to avoid threading it through every signature.
let BRAND_NAME = 'Property Consulting';

const AUDIENCE_SYSTEM_PROMPTS: Record<string, string> = {
  general: 'You are writing for a mixed audience of property investors and owner-occupiers. Provide balanced insights relevant to both groups.',
  investor: 'You are writing specifically for property investors. Focus on yield, capital growth, equity strategies, tax advantages, cash flow analysis, and portfolio positioning. Frame everything through an investment return lens.',
  owner_occupier: 'You are writing specifically for owner-occupiers and first home buyers. Focus on lifestyle factors, entry costs, suburb livability, future growth for personal wealth, and practical buying guidance. Avoid heavy investment jargon.',
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Market Intelligence Report',
  market_pulse: 'Market Pulse Update',
  hotspot_deep_dive: 'Hotspot Deep Dive',
  strategy_insight: 'Strategy Insight',
  finance_update: 'Finance & Lending Update',
  deal_breakdown: 'Deal Breakdown',
  myth_busting: 'Market Myths & Truths',
  development_spotlight: 'Development Spotlight',
};

// ─── Expanded Domain Filter ─────────────────────────────────────────────────
// Master doc mandates: RBA, ABS, APRA, Treasury, CoreLogic, PropTrack, SQM,
// Domain, REA, Property Council, UDIA, HIA, AFR, The Australian, ABC News,
// major banks

const PERPLEXITY_DOMAINS = [
  'rba.gov.au',
  'abs.gov.au',
  'apra.gov.au',
  'treasury.gov.au',
  'corelogic.com.au',
  'domain.com.au',
  'realestate.com.au',
  'sqmresearch.com.au',
  'propertycouncil.com.au',
  'udia.com.au',
  'hia.com.au',
  'afr.com',
  'theaustralian.com.au',
  'abc.net.au',
  'proptrack.com.au',
  'commbank.com.au',
  'westpac.com.au',
  'nab.com.au',
  'anz.com.au',
  'microburbs.com.au',
];

// ─── Perplexity Query ────────────────────────────────────────────────────────

async function queryPerplexity(
  prompt: string,
  apiKey: string,
  systemPrompt?: string
): Promise<PerplexityResult> {
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
          content: `${(await resolvePrompt('market_intelligence.perplexity_system', { brand_name: BRAND_NAME })).text} ${systemPrompt || ''}`
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      search_recency_filter: 'week',
      search_domain_filter: PERPLEXITY_DOMAINS,
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

// ─── Gemini AI ───────────────────────────────────────────────────────────────

async function callGemini(prompt: string, _apiKey: string, maxTokens = 6000): Promise<string> {
  const response = await callLLMRaw({
    agentKey: 'market_intelligence_writer',
    messages: [
      {
        role: 'system',
        content: (await resolvePrompt('market_intelligence.writer_system', { brand_name: BRAND_NAME })).text
      },
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

// ─── Structured Event Extraction ─────────────────────────────────────────────

async function extractMarketEvents(apiKey: string): Promise<any[]> {
  const now = new Date();
  const currentDateStr = now.toISOString().split('T')[0];
  const currentYear = now.getFullYear();
  const currentMonth = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const tools = [{
    type: 'function',
    function: {
      name: 'provide_market_events',
      description: 'Provide structured market events.',
      parameters: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'YYYY-MM-DD' },
                event: { type: 'string' },
                category: { type: 'string', enum: ['interest_rate', 'economic', 'housing', 'regulatory', 'seasonal'] },
                impact: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
                description: { type: 'string', description: 'How this impacts property investors' },
                relevance_score: { type: 'number', description: '0-100' },
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
    agentKey: 'market_intelligence_events',
    messages: [
      {
        role: 'system',
        content: (await resolvePrompt('market_intelligence.events_system', { current_date: currentDateStr, current_year: currentYear })).text
      },
      {
        role: 'user',
        content: `Today is ${currentDateStr} (${currentMonth}). List the most significant recent and upcoming Australian market events (last 90 days and next 60 days from today) that would impact property investment decisions. Include RBA rate decisions, major economic data releases, housing market reports, APRA regulatory changes, state government policy changes, and seasonal patterns. Provide at least 15 events. IMPORTANT: All dates must be in ${currentYear - 1} or ${currentYear}. Do NOT use dates from 2024 or earlier.`
      },
    ],
    tools,
    toolChoice: { type: 'function', function: { name: 'provide_market_events' } },
  });

  if (!response.ok) throw new Error(`Market events error [${response.status}]`);
  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    const parsed = JSON.parse(toolCall.function.arguments);
    return parsed.events || [];
  }
  return [];
}

// Internal NPC data deprecated — not included in client-facing reports

// ─── Data Layer Fetchers ─────────────────────────────────────────────────────

async function fetchLayer1_RBA(perplexityKey: string): Promise<PerplexityResult> {
  return queryPerplexity(
    `Provide a comprehensive analysis of Australia's current interest rate environment:

1. **Current RBA Cash Rate** — exact rate and date of last decision
2. **Rate Decision History** — last 6 RBA decisions with dates and changes
3. **Forward Rate Expectations** — what ASX rate futures/market pricing suggests for the next 6 months
4. **Impact on Borrowing Capacity** — how the current rate affects typical borrower serviceability (reference APRA's 3% buffer)
5. **Impact on Investor Sentiment** — current investor activity levels relative to rate environment
6. **Comparison to Long-Term Average** — how current rates compare to 10yr and 20yr averages
7. **Major Bank Outlook** — what CBA, Westpac, NAB, ANZ economists are forecasting for rates

Use specific numbers, dates, and percentages. Cite all data sources. Do NOT include any "Data Limitations" section or disclaimers about missing data — only present what is available.`,
    perplexityKey
  );
}

async function fetchLayer2_Housing(perplexityKey: string): Promise<PerplexityResult> {
  return queryPerplexity(
    `Provide a comprehensive snapshot of Australia's current housing market:

1. **Auction Clearance Rates** — national and by capital city (Sydney, Melbourne, Brisbane, Perth, Adelaide) for the most recent weekend
2. **Median House Price Changes** — quarterly and annual change by capital city (CoreLogic and PropTrack data)
3. **Days on Market** — average DOM by capital city, trend direction
4. **Rental Yields** — gross rental yields by capital city for houses and units
5. **Listing Volumes** — new listings vs. historical averages, supply pressure
6. **Regional vs. Metro Trends** — any divergence in performance
7. **Supply Pipeline** — building approvals trend and new dwelling completions vs population growth
8. **Vacancy Rates** — SQM Research vacancy rates by capital city

Use specific numbers in AUD. Include data from CoreLogic, PropTrack, Domain, REA Group, SQM Research, and HIA where available. Do NOT include any "Data Limitations" section — only present available data.`,
    perplexityKey
  );
}

async function fetchLayer3_Sentiment(perplexityKey: string): Promise<PerplexityResult> {
  return queryPerplexity(
    `Provide current Australian consumer and investor sentiment indicators:

1. **Westpac-Melbourne Institute Consumer Sentiment Index** — latest reading, monthly and annual change, sub-indices for 'time to buy a dwelling'
2. **ANZ-Roy Morgan Consumer Confidence** — latest reading and trend
3. **NAB Business Confidence** — latest property sector reading
4. **Property Investment Intent** — investor loan approvals trend (ABS data)
5. **First Home Buyer Activity** — FHB loan approvals vs historical average
6. **Rental Market Stress** — vacancy rates by capital city from SQM Research
7. **Property Council / UDIA / HIA Sentiment** — any recent industry body sentiment surveys or confidence indices
8. **Media Sentiment** — overall tone from AFR, The Australian, and ABC property coverage in the last 30 days

Cite all specific readings with their publication dates. Do NOT include any "Data Limitations" section — only present available data.`,
    perplexityKey
  );
}

async function fetchLayer6_Economic(perplexityKey: string): Promise<PerplexityResult> {
  return queryPerplexity(
    `Provide the latest Australian economic indicators relevant to property investors:

1. **CPI / Inflation** — latest quarterly and annual reading, trimmed mean, RBA target comparison
2. **Unemployment Rate** — latest reading, monthly change, underemployment
3. **GDP Growth** — latest quarterly and annual reading
4. **Wage Growth (WPI)** — latest reading, real wage growth calculation
5. **Population Growth & Migration** — latest ABS NOM data, impact on housing demand
6. **AUD Exchange Rate** — current AUD/USD, impact on foreign investment appetite
7. **Building Approvals** — latest trend, supply pipeline implications
8. **Credit Growth** — housing credit growth from RBA data, investor vs owner-occupier lending split
9. **Household Debt-to-Income Ratio** — latest RBA data on household leverage

Use the most recent ABS, RBA, APRA, and Treasury data. Cite publication dates. Do NOT include any "Data Limitations" section — only present available data.`,
    perplexityKey
  );
}

// ─── Layer 7 — Micro/Suburb Intelligence ────────────────────────────────────

async function fetchLayer7_Micro(perplexityKey: string, audiencePrompt: string): Promise<PerplexityResult> {
  return queryPerplexity(
    `Identify the TOP 5 highest-performing suburbs or corridors in Australia right now for property investment.

CRITICAL REQUIREMENTS:
- You MUST select suburbs from at least 3 DIFFERENT STATES to provide national diversity (e.g. NSW, VIC, QLD, WA, SA).
- Do NOT select more than 2 suburbs from the same state.
- Use ONLY aggregate/median data from published sources. NEVER cite specific street addresses, specific property sales, or individual transaction prices — these cannot be verified and damage credibility.

For EACH suburb provide:

1. **Suburb Name & State** — exact location and postcode
2. **Median House Price** — current median from CoreLogic/PropTrack and 12-month change (%)
3. **Rental Yield** — current gross rental yield for houses and units
4. **Days on Market** — average DOM and whether it's tightening or loosening
5. **Vacancy Rate** — current rate from SQM Research or similar
6. **Growth Drivers** — infrastructure projects, transport links, employment hubs, amenities driving demand
7. **Supply-Demand Balance** — new listings vs buyer demand, development pipeline, DSR (demand-to-supply ratio) where available
8. **Rental Performance** — median weekly rent and 12-month rental growth
9. **Entry Strategy** — recommended approach for entering this market

Also identify 3 emerging corridors showing early-stage growth signals (price momentum beginning, infrastructure announced, rezoning underway).

${audiencePrompt}

Use data from CoreLogic, PropTrack, Domain, SQM Research, Microburbs, and government infrastructure databases. Prioritise suburbs showing BOTH capital growth AND rental yield strength. Do NOT include any "Data Limitations" section. Do NOT cite individual property addresses or sale prices — use only median/aggregate suburb-level statistics.`,
    perplexityKey,
    'You are a senior Australian property market analyst specialising in suburb-level intelligence. Provide granular, data-backed suburb analysis using ONLY published aggregate/median statistics from authoritative sources. NEVER fabricate or cite specific property addresses, individual sale prices, or comparable sales with street addresses — only use suburb-level median data. Always cite sources and use specific numbers. Never include "Data Limitations" disclaimers — only present the data you have.'
  );
}

// ─── Layer 8 — Competitive Edge (NPC Differentiation) ───────────────────────

async function generateLayer8_CompetitiveEdge(
  lovableKey: string,
  layer2Content: string,
  layer7Content: string,
  audiencePrompt: string
): Promise<string> {
  return callGemini(
    `You are writing the "Competitive Strategic Edge" section of a premium ${BRAND_NAME} Market Intelligence Report. This section differentiates ${BRAND_NAME} from every other property advisory by revealing insights that typical buyers and competitors overlook.

## Context Data:
### Housing Market Overview:
${layer2Content.slice(0, 2000)}

### Suburb-Level Intelligence:
${layer7Content.slice(0, 3000)}

## Required Analysis (produce ALL sections):

### 1. Off-Market & Pre-Market Intelligence
Identify 2-3 opportunities that are likely available off-market or pre-market in the suburbs analysed. Explain what signals suggest off-market activity and how a strategic buyer would access these. Frame this as general market intelligence — do NOT fabricate specific deal pipeline data, active negotiations, or specific property addresses that the advisory is supposedly pursuing. Do NOT cite specific street addresses, lot numbers, or individual sale prices — use only suburb-level aggregate data. Instead, describe the types of opportunities and access strategies available.

### 2. Development & Subdivision Potential
For the top suburbs identified, analyse:
- Which properties/sites have subdivision potential (lot sizes, zoning, frontage)
- Estimated uplift from a subdivide-and-hold or subdivide-and-sell strategy
- Planning approval likelihood and timeframes
- Reference council DA tracker trends where applicable

### 3. Zoning & Overlay Opportunities
Identify zoning advantages in the target areas:
- Recent or upcoming rezoning that creates value
- Mixed-use or higher-density overlays that the general market hasn't priced in
- Heritage overlays that protect character (and values)

### 4. Strategic Structuring Recommendations
For each key opportunity, recommend the optimal approach:
- **Cash Flow Play** — best for income-focused investors
- **Growth Play** — best for equity/capital appreciation
- **Equity Play** — best for leveraging existing portfolio
- Risk mitigation strategies competitors don't highlight

### 5. Hidden Opportunities
3 non-obvious insights that most property buyers — and even competitors — would miss. These should be genuinely strategic, not surface-level observations.

### 6. How ${BRAND_NAME} Would Approach This
For the #1 opportunity identified, provide a detailed strategic playbook:
- Entry timing and approach
- Negotiation leverage points
- Structuring recommendations
- 12-month strategic outlook for this specific opportunity

${audiencePrompt}

Tone: Confident, strategic, authoritative. This is where ${BRAND_NAME} proves its value above the noise. ${BRAND_NAME} is a strategic property advisory, not just a buyer's agent — decisions are data-driven and insight-led. IMPORTANT: Do NOT fabricate specific property addresses, street names, lot numbers, deal negotiations, individual sale prices, or "pipeline activity" that the advisory is supposedly engaged in. Use only suburb-level median/aggregate data from published sources. Keep recommendations at a strategic framework level.`,
    lovableKey,
    8000
  );
}

// ─── Key Insights Snapshot Generator ────────────────────────────────────────

async function generateKeyInsightsSnapshot(
  lovableKey: string,
  allLayerSummaries: string,
  reportType: string,
  audiencePrompt: string
): Promise<string> {
  return callGemini(
    `Generate a "Key Insights Snapshot" section for an ${BRAND_NAME} ${REPORT_TYPE_LABELS[reportType] || 'Market Intelligence Report'}.

## Data Summary:
${allLayerSummaries.slice(0, 6000)}

## Required Output:
Produce exactly 5 concise, punchy bullet points that summarise the most critical takeaways from this report. Each bullet must:
- Lead with a bold key metric or finding
- Include a specific number, percentage, or date
- End with a brief "so what" implication for the reader
- Be no longer than 2 sentences

${audiencePrompt}

Format as markdown bullet points. These will appear prominently after the executive summary as a quick-reference panel.

Example format:
- **Cash Rate held at X.XX%** — Forward pricing suggests [direction], creating a [window/risk] for [buyer type]. Act [now/wait].
- **Sydney median up X.X% quarterly** — Outperforming Melbourne by [X]pp, driven by [factor]. [Implication].

Tone: Sharp, data-backed, actionable. No fluff.`,
    lovableKey,
    1500
  );
}

// ─── Actionable Strategy Generator ──────────────────────────────────────────

async function generateActionableStrategy(
  lovableKey: string,
  allLayerSummaries: string,
  reportType: string,
  audienceSegment: string
): Promise<string> {
  const audienceFraming: Record<string, string> = {
    general: 'Provide balanced guidance for both investors and homebuyers.',
    investor: 'Frame all advice through a portfolio growth, yield optimisation, and tax efficiency lens.',
    owner_occupier: 'Frame all advice through a lifestyle, long-term wealth, and practical buying lens.',
  };

  return callGemini(
    `Generate the "Actionable Strategy" section for an ${BRAND_NAME} ${REPORT_TYPE_LABELS[reportType] || 'Market Intelligence Report'}.

## Data Context:
${allLayerSummaries.slice(0, 5000)}


## Required Output Structure:

### What To Do Now
3-4 specific, actionable recommendations. Each must include:
- The specific action to take
- Why now (timing rationale with data)
- Expected benefit or outcome

### What To Avoid
3 clear warnings — things the reader should NOT do in the current market. Be specific and data-backed:
- Common mistakes in the current environment
- Traps that less-informed buyers are falling into
- Timing errors based on current cycle positioning

### Timing Considerations
- **Buy Window**: Is this a good time to buy? For which property types and locations?
- **Hold Strategy**: For existing portfolio holders, what's the optimal play?
- **Watch Signals**: What specific data releases or events should trigger action?
- **90-Day Outlook**: Brief forward view with key decision points

${audienceFraming[audienceSegment] || audienceFraming.general}

Tone: Decisive, strategic, authoritative. ${BRAND_NAME} provides clarity where others provide confusion. Every recommendation must be justified with data.`,
    lovableKey,
    3000
  );
}

// ─── CTA Generation ─────────────────────────────────────────────────────────

async function generateCTA(lovableKey: string, reportType: string, audienceSegment: string): Promise<string> {
  const ctaPrompts: Record<string, string> = {
    full: 'a comprehensive market intelligence review',
    market_pulse: 'discussing the current market conditions and their implications',
    hotspot_deep_dive: 'exploring the highlighted suburb opportunities in detail',
    strategy_insight: 'a tailored strategy discussion based on these insights',
    finance_update: 'reviewing your borrowing capacity in the current lending environment',
    deal_breakdown: 'analysing specific opportunities that match your investment criteria',
    myth_busting: 'separating fact from fiction for your property strategy',
    development_spotlight: 'exploring development and subdivision opportunities',
  };

  const audienceCtaFraming: Record<string, string> = {
    general: 'Appeal to both investors and homebuyers.',
    investor: 'Focus on ROI, portfolio growth, and tax efficiency.',
    owner_occupier: 'Focus on lifestyle, long-term wealth, and market timing.',
  };

  return callGemini(
    `Generate a compelling, professional Call to Action section for an ${BRAND_NAME} Market Intelligence Report.

Report Type: ${REPORT_TYPE_LABELS[reportType] || reportType}
Target Audience: ${audienceSegment}

The CTA should encourage the reader to take the next step toward ${ctaPrompts[reportType] || 'a strategy discussion'}.

${audienceCtaFraming[audienceSegment] || ''}

## Required Output:

### What Should You Do Next?
A 2-3 sentence compelling paragraph that creates urgency without being pushy.

### Your Next Steps:
3 clear, specific actions the reader can take:
1. **Book a Strategy Session** — with a specific benefit statement
2. **Request Detailed Analysis** — for a suburb or opportunity mentioned
3. **Connect With Our Team** — phone/email with a personal touch

IMPORTANT: Do NOT include a "Why ${BRAND_NAME}?" section — this is added separately by the PDF generator. End your output after the 3 action steps.

Keep it professional, warm, and action-oriented. No generic "contact us" language.`,
    lovableKey,
    1500
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

const __miReportHandler = async (req: Request): Promise<Response> => {
  // The CALLER's origin, not a default. `createCorsHeaders()` with no argument
  // answers `Access-Control-Allow-Origin: allowedOrigins[0]` — a fixed origin
  // that has nothing to do with who asked — and it is paired with
  // `Access-Control-Allow-Credentials: true`. A credentialed request is only
  // released to JS when the ACAO EXACTLY equals the request's Origin, so this
  // function answered for exactly one of the origins the deployment trusts and
  // failed the preflight for every other one. `fetch` then rejects with an
  // opaque `TypeError: Failed to fetch`, which the client renders as
  //
  //     Network/CORS error calling generate-market-intelligence-report.
  //     Please check the function deployment and auth/CORS configuration.
  //
  // — advice that sends the reader to the deployment, which is fine. Audit 4
  // item 12 is this. 344 call sites across the functions pass the origin; this
  // was one of the handful that did not.
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

    const body: ReportRequest = await req.json();
    const reportType = body.report_type || 'full';
    const audienceSegment = body.audience_segment || 'general';
    // Accept either field name (new canonical or legacy). Default true.
    const includeAdvisoryStrategy = body.include_advisory_strategy !== undefined
      ? body.include_advisory_strategy !== false
      : body.include_npc_strategy !== false;

    // Normalised here rather than trusted, and bounded: this lands verbatim in a
    // jsonb column that a renderer later typesets, and the panel that sends it
    // gets its text from a model.
    const rawCorrelation = body.correlation_data;
    const correlationData = rawCorrelation && typeof rawCorrelation === 'object'
      ? (() => {
        const ai = String(rawCorrelation.aiAnalysis ?? '').slice(0, 40_000);
        const research = String(rawCorrelation.perplexityResearch ?? '').slice(0, 40_000);
        const citations = Array.isArray(rawCorrelation.citations)
          ? rawCorrelation.citations
            .filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
            .slice(0, 60)
            .map((c: string) => c.slice(0, 500))
          : [];
        return ai || research || citations.length
          ? { aiAnalysis: ai, perplexityResearch: research, citations }
          : null;
      })()
      : null;

    // Allow internal service calls (from dispatch function) without auth
    const authHeader = req.headers.get('Authorization') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const isServiceCall = authHeader.replace('Bearer ', '').trim() === serviceKey.trim();

    let userId = 'system';
    if (!isServiceCall) {
      const { error: authError, userId: authUserId } = await verifyAuth(supabase, req.headers, body);
      if (authError || !authUserId) {
        return createUnauthorizedResponse('Authentication required', corsHeaders);
      }
      userId = authUserId;
    }

    console.log(`[market-intel-report] Starting generation: type=${reportType}, audience=${audienceSegment}, user=${userId}`);

    // Initialise dynamic brand name from global_report_settings.
    try {
      const _brand = await getBrandConfig();
      BRAND_NAME = _brand.companyName;
    } catch (e) {
      console.warn('[market-intel-report] getBrandConfig failed, using fallback:', e);
    }

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!PERPLEXITY_API_KEY || !LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Required API keys not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let requiredLayers = [...(REPORT_TYPE_LAYERS[reportType] || REPORT_TYPE_LAYERS.full)];
    
    // Remove layer8 if Advisory strategy is excluded
    if (!includeAdvisoryStrategy) {
      requiredLayers = requiredLayers.filter(l => l !== 'layer8');
    }
    const audiencePrompt = AUDIENCE_SYSTEM_PROMPTS[audienceSegment] || AUDIENCE_SYSTEM_PROMPTS.general;

    // Create report record
    const now = new Date();
    const reportPeriod = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

    const { data: reportRow, error: insertError } = await supabase
      .from('marketing_intelligence_reports')
      .insert({
        generated_by: userId,
        status: 'generating',
        report_period: reportPeriod,
        report_type: reportType,
        audience_segment: audienceSegment,
        include_advisory_strategy: includeAdvisoryStrategy,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to create report record' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const reportId = reportRow.id;
    console.log(`[market-intel-report] Report ID: ${reportId}, layers: ${requiredLayers.join(', ')}`);

    try {
      // ── Fetch required layers in parallel ───────────────────────────
      console.log('[market-intel-report] Fetching data layers...');

      const fetchPromises: Record<string, Promise<any>> = {};

      if (requiredLayers.includes('layer1')) {
        fetchPromises.layer1 = fetchLayer1_RBA(PERPLEXITY_API_KEY).catch(e => {
          console.error('Layer 1 (RBA) error:', e); return { content: '', citations: [] };
        });
      }
      if (requiredLayers.includes('layer2')) {
        fetchPromises.layer2 = fetchLayer2_Housing(PERPLEXITY_API_KEY).catch(e => {
          console.error('Layer 2 (Housing) error:', e); return { content: '', citations: [] };
        });
      }
      if (requiredLayers.includes('layer3')) {
        fetchPromises.layer3 = fetchLayer3_Sentiment(PERPLEXITY_API_KEY).catch(e => {
          console.error('Layer 3 (Sentiment) error:', e); return { content: '', citations: [] };
        });
      }
      if (requiredLayers.includes('layer6')) {
        fetchPromises.layer6 = fetchLayer6_Economic(PERPLEXITY_API_KEY).catch(e => {
          console.error('Layer 6 (Economic) error:', e); return { content: '', citations: [] };
        });
      }
      if (requiredLayers.includes('layer7')) {
        fetchPromises.layer7 = fetchLayer7_Micro(PERPLEXITY_API_KEY, audiencePrompt).catch(e => {
          console.error('Layer 7 (Micro) error:', e); return { content: '', citations: [] };
        });
      }
      if (requiredLayers.includes('events')) {
        fetchPromises.events = extractMarketEvents(LOVABLE_API_KEY).catch(e => {
          console.error('Market events error:', e); return [];
        });
      }

      const results = await Promise.all(
        Object.entries(fetchPromises).map(async ([key, promise]) => [key, await promise])
      );
      const layerResults: Record<string, any> = Object.fromEntries(results);

      const layer1Result: PerplexityResult = layerResults.layer1 || { content: '', citations: [] };
      const layer2Result: PerplexityResult = layerResults.layer2 || { content: '', citations: [] };
      const layer3Result: PerplexityResult = layerResults.layer3 || { content: '', citations: [] };
      const layer6Result: PerplexityResult = layerResults.layer6 || { content: '', citations: [] };
      const layer7Result: PerplexityResult = layerResults.layer7 || { content: '', citations: [] };
      const marketEvents: any[] = layerResults.events || [];
      

      // ── Layer 4: Regulatory (Gemini — uses Perplexity context) ──────
      let layer4Regulatory = '';
      if (requiredLayers.includes('layer4')) {
        console.log('[market-intel-report] Generating regulatory analysis...');
        try {
          layer4Regulatory = await callGemini(
            `Based on the following market intelligence, provide a comprehensive Australian property regulatory and policy watch:

## Context:
${layer1Result.content.slice(0, 2000)}
${layer2Result.content.slice(0, 2000)}

## Required Analysis:
1. **APRA Lending Policy** — any recent or upcoming changes to macroprudential controls, serviceability buffers, lending standards
2. **State Stamp Duty Updates** — recent changes by state (NSW, VIC, QLD, WA, SA, ACT) including any concessions, surcharges for investors, or land tax changes
3. **First Home Buyer Schemes** — changes that affect investor competition
4. **Foreign Investment Rules** — any FIRB changes, additional state surcharges
5. **Tax Policy** — any changes to negative gearing, CGT discount, depreciation rules under discussion
6. **Building & Planning** — changes to building codes, planning regulations, inclusionary zoning

For each item, specify: What changed, When, Which states affected, Impact rating (High/Medium/Low).

CRITICAL INSTRUCTION: If no recent changes have been identified for a specific category, do NOT include that category at all. Do NOT write "N/A" or "No recent changes identified" — simply OMIT that entire section and move to the next one. Only include sections where there is substantive information to report. If only 2 of the 6 categories have real updates, only write those 2.`,
            LOVABLE_API_KEY
          );
        } catch (e) {
          console.error('Layer 4 (Regulatory) error:', e);
        }
      }

      // ── Layer 8: Competitive Edge (NPC Differentiation) ─────────────
      let layer8CompetitiveEdge = '';
      if (requiredLayers.includes('layer8')) {
        console.log('[market-intel-report] Generating competitive edge analysis...');
        try {
          layer8CompetitiveEdge = await generateLayer8_CompetitiveEdge(
            LOVABLE_API_KEY,
            layer2Result.content,
            layer7Result.content,
            audiencePrompt
          );
        } catch (e) {
          console.error('Layer 8 (Competitive Edge) error:', e);
        }
      }

      // ── Build summary for cross-layer generators ────────────────────
      const allLayerSummaries = [
        layer1Result.content ? `## Interest Rates:\n${layer1Result.content.slice(0, 1200)}` : '',
        layer2Result.content ? `## Housing Market:\n${layer2Result.content.slice(0, 1200)}` : '',
        layer3Result.content ? `## Sentiment:\n${layer3Result.content.slice(0, 1000)}` : '',
        layer4Regulatory ? `## Regulatory:\n${layer4Regulatory.slice(0, 800)}` : '',
        layer6Result.content ? `## Economic:\n${layer6Result.content.slice(0, 1000)}` : '',
        layer7Result.content ? `## Suburb Intelligence:\n${layer7Result.content.slice(0, 1200)}` : '',
        layer8CompetitiveEdge ? `## Strategic Edge:\n${layer8CompetitiveEdge.slice(0, 800)}` : '',
      ].filter(Boolean).join('\n\n');

      // ── Key Insights Snapshot (NEW — mandatory per master doc) ──────
      let keyInsightsSnapshot = '';
      if (requiredLayers.includes('key_insights')) {
        console.log('[market-intel-report] Generating key insights snapshot...');
        try {
          keyInsightsSnapshot = await generateKeyInsightsSnapshot(
            LOVABLE_API_KEY,
            allLayerSummaries,
            reportType,
            audiencePrompt
          );
        } catch (e) {
          console.error('Key insights snapshot error:', e);
        }
      }

      // ── Actionable Strategy (NEW — mandatory per master doc) ────────
      let actionableStrategy = '';
      if (requiredLayers.includes('actionable_strategy')) {
        console.log('[market-intel-report] Generating actionable strategy...');
        try {
          actionableStrategy = await generateActionableStrategy(
            LOVABLE_API_KEY,
            allLayerSummaries,
            reportType,
            audienceSegment
          );
        } catch (e) {
          console.error('Actionable strategy error:', e);
        }
      }

      // ── Layer 5: Strategic Outlook (AI synthesis of all layers) ──────
      let layer5Outlook = '';
      if (requiredLayers.includes('layer5')) {
        console.log('[market-intel-report] Generating strategic outlook...');
        try {
          layer5Outlook = await callGemini(
            `You are writing the "90-Day Strategic Outlook" section of a premium Market Intelligence Report for property investors.

Synthesize ALL of the following data layers into a forward-looking strategic assessment:

## Layer 1 — Interest Rates:
${layer1Result.content.slice(0, 1500)}

## Layer 2 — Housing Market:
${layer2Result.content.slice(0, 1500)}

## Layer 3 — Sentiment:
${layer3Result.content.slice(0, 1500)}

## Layer 4 — Regulatory:
${layer4Regulatory.slice(0, 1500)}

## Layer 6 — Economic:
${layer6Result.content.slice(0, 1500)}

## Layer 7 — Suburb Intelligence:
${layer7Result.content.slice(0, 1500)}


## Upcoming Events:
${marketEvents.filter((e: any) => new Date(e.date) > new Date()).slice(0, 10).map((e: any) => `- [${e.date}] ${e.event} (${e.impact})`).join('\n')}

${audiencePrompt}

## Required Output Structure:

### Market Outlook Summary
A 3-4 sentence executive view of the next 90 days.

### Risk/Opportunity Matrix

CRITICAL: You MUST produce a proper markdown table with EXACTLY this format — including the separator row and at least 6 data rows. Do NOT leave the table empty or produce only headers:

| Factor | Risk Level | Opportunity Level | Key Insight |
| --- | --- | --- | --- |
| Interest Rates | High | Low | [your insight] |
| Housing Supply | Medium | High | [your insight] |
| Rental Market | Low | High | [your insight] |
| Consumer Sentiment | Medium | Medium | [your insight] |
| Population Growth | Low | High | [your insight] |
| Regulatory Environment | Medium | Low | [your insight] |

Replace the example insights with real analysis from the data above. You MUST produce all 6+ data rows. Each row must have all 4 columns filled.

### Timing Recommendations
- **Best time to buy**: Specific windows and reasoning
- **States to watch**: Which states offer best value
- **Property types**: Which segments (house/unit/land) are best positioned

### Key Dates to Watch
List the 5 most important upcoming dates/events with expected market impact.

### Contrarian Insights
2-3 non-obvious observations that most investors would miss.`,
            LOVABLE_API_KEY,
            8000
          );
        } catch (e) {
          console.error('Layer 5 (Outlook) error:', e);
        }
      }

      // ── CTA Generation ──────────────────────────────────────────────
      let ctaContent = '';
      if (requiredLayers.includes('cta')) {
        console.log('[market-intel-report] Generating CTA...');
        try {
          ctaContent = await generateCTA(LOVABLE_API_KEY, reportType, audienceSegment);
        } catch (e) {
          console.error('CTA generation error:', e);
        }
      }

      // ── Executive Summary ───────────────────────────────────────────
      let executiveSummary = '';
      if (requiredLayers.includes('executive')) {
        console.log('[market-intel-report] Generating executive summary...');
        try {
          const reportLabel = REPORT_TYPE_LABELS[reportType] || 'Market Intelligence Report';
          executiveSummary = await callGemini(
            `Write a 1-page executive summary for a premium "${reportLabel}" dated ${reportPeriod}.

Key data points to synthesize:
- RBA: ${layer1Result.content.slice(0, 500)}
- Housing: ${layer2Result.content.slice(0, 500)}
- Sentiment: ${layer3Result.content.slice(0, 500)}
- Economic: ${layer6Result.content.slice(0, 500)}
- Suburb Intelligence: ${layer7Result.content.slice(0, 500)}
- Competitive Edge: ${layer8CompetitiveEdge.slice(0, 500)}


${audiencePrompt}

Write 5-6 dense paragraphs covering:
1. The headline market story right now
2. Interest rate environment and outlook
3. Housing market performance snapshot
4. Key risks and opportunities
5. Top suburb opportunities identified
6. The bottom line — what the reader should do NOW

Tone: Authoritative, data-backed, actionable. Use bold for key figures. Position ${BRAND_NAME} as a strategic property advisory delivering insight-led guidance.`,
            LOVABLE_API_KEY,
            3000
          );
        } catch (e) {
          console.error('Executive summary error:', e);
        }
      }

      // ── Aggregate all citations ─────────────────────────────────────
      const allCitations = [
        ...layer1Result.citations,
        ...layer2Result.citations,
        ...layer3Result.citations,
        ...layer6Result.citations,
        ...layer7Result.citations,
      ].filter((c, i, arr) => arr.indexOf(c) === i);

      // ── Build report data ───────────────────────────────────────────
      const reportData = {
        generatedAt: now.toISOString(),
        reportPeriod,
        reportType,
        reportTypeLabel: REPORT_TYPE_LABELS[reportType] || reportType,
        audienceSegment,
        executiveSummary,
        keyInsightsSnapshot,
        actionableStrategy,
        layer1_rba: {
          content: layer1Result.content,
          citations: layer1Result.citations,
        },
        layer2_housing: {
          content: layer2Result.content,
          citations: layer2Result.citations,
        },
        layer3_sentiment: {
          content: layer3Result.content,
          citations: layer3Result.citations,
        },
        layer4_regulatory: {
          content: layer4Regulatory,
        },
        layer5_outlook: {
          content: layer5Outlook,
        },
        layer6_economic: {
          content: layer6Result.content,
          citations: layer6Result.citations,
        },
        layer7_micro: {
          content: layer7Result.content,
          citations: layer7Result.citations,
        },
        layer8_competitive_edge: {
          content: layer8CompetitiveEdge,
        },
        
        ctaContent,
        marketEvents: marketEvents.sort((a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
        ),
        allCitations,
        includedLayers: requiredLayers,
        // Written only when the caller supplied one, so the key stays absent on
        // an ordinary report rather than appearing as an empty object that a
        // reader would have to distinguish from a real but blank block.
        ...(correlationData ? { correlationData } : {}),
      };

      // ── Update report record ────────────────────────────────────────
      await supabase
        .from('marketing_intelligence_reports')
        .update({
          report_data: reportData,
          status: 'completed',
        })
        .eq('id', reportId);

      console.log(`[market-intel-report] Report ${reportId} completed successfully`);

      return new Response(JSON.stringify({
        success: true,
        reportId,
        reportData,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (genError) {
      console.error('[market-intel-report] Generation error:', genError);
      await supabase
        .from('marketing_intelligence_reports')
        .update({
          status: 'failed',
          error_message: genError instanceof Error ? genError.message : 'Unknown error',
        })
        .eq('id', reportId);

      return new Response(JSON.stringify({
        error: 'Report generation failed',
        reportId,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('[market-intel-report] Fatal error:', error);
    return new Response(JSON.stringify(internalError(error, 'generate-market-intelligence-report')), {
      status: 500, headers: { ...createCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const reportType = body?.report_type || 'full';
  const audience = body?.audience_segment || 'general';
  const idempotencyKey = buildIdempotencyKey('mi-report', [
    reportType,
    audience,
    body?.include_advisory_strategy ?? body?.include_npc_strategy,
    new Date().toISOString().slice(0, 13), // hour-bucketed
  ]);
  return {
    kind: 'report.market-intelligence' as const,
    userId,
    idempotencyKey,
    estimateOptions: { aiNarrative: true, extraSections: reportType === 'full' ? 2 : 0 },
    requestPayload: { reportType, audience },
  };
}, __miReportHandler));
