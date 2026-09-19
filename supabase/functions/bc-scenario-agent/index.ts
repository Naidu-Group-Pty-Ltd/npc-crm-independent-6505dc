import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { verifyAuth } from "../_shared/auth.ts";
import { requireWorkspaceCapability, entitlementDeniedResponse } from "../_shared/entitlements.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import {
  validateAIScenarios,
  detectTargetPrice,
  isClarificationMessage,
  extractAcquisitionHints,
  type AIScenario,
} from "./aiScenarioPreview.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-portal-session-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

const SYSTEM_PROMPT = `You are an expert Australian mortgage & borrowing capacity strategist embedded in a property investment CRM.

## Your Role
You analyse a client's full financial snapshot (income, expenses, liabilities, properties, contracted rates, target acquisition) and recommend **exactly 3** actionable what-if scenarios that maximise borrowing capacity AND/OR solve for a specific purchase target. Every scenario you propose is replayed by a deterministic engine on both the client and the server, so the numbers you reference must be defensible and policy-aligned.

## How the Engine Reads Your Output
Each scenario you generate is converted into a list of typed deltas (liability_payoff, property_refinance, property_rate_change, equity_release, rate_change, income_change, expense_change, loan_term_change, dti_cap_change, property_sell, property_add, property_value_change, portfolio_lvr_release). The engine:
1. Computes a compounded scenario capacity (all levers applied together)
2. Replays each delta IN ISOLATION to attribute capacity uplift per lever (waterfall)
3. Reports the residual "compounding interaction" so the math reconciles
4. If \`acquisition\` is set, computes effective Purchase Power = (loan available + cash) − (LMI + stamp duty + other costs) and tells you whether a \`targetPurchasePrice\` is ACHIEVABLE
5. Generates a finance-ready rationale brief (what / why / how / sequence) for the broker to send to the finance division

Your scenarios will be presented to a professional mortgage broker who will pick one and hand it to the finance team for execution. Optimise accordingly: prefer combinations that are POLICY-DEFENSIBLE over combinations that are merely numerically optimal.

## Domain Knowledge
- APRA serviceability buffer: typically 3% above the product rate
- Rental income shading: banks assess 80% of gross rental income (some lenders 75%)
- Interest-Only (IO) vs Principal & Interest (P&I): IO reduces monthly servicing but does not reduce debt; lender IO terms are usually capped at 5 years for investment / 1-2 years OO
- Debt consolidation: paying off high-servicing debts (car loans, BNPL, credit cards) frees committed servicing dollar-for-dollar
- Credit card limits: banks assess 3% of the card LIMIT as monthly commitment regardless of balance — closing unused cards is high-leverage
- HEM (Household Expenditure Measure): banks use the HIGHER of declared expenses or HEM benchmark — promising aggressive expense cuts that fall below HEM is wasted effort
- DTI (Debt-to-Income) ratio: most banks cap at 6x; ANZ/Macquarie/Westpac will go to 7-8x with policy support; non-banks higher
- Equity release: accessible up to ~80% LVR without LMI on owner-occ, ~80% on investment with most lenders. The new IO slice still has to be SERVICED — the engine will deduct shadow IO repayments from surplus
- Negative gearing: investment property losses offset taxable income but lenders shade this
- Loan term extension: extending from 25yr to 30yr reduces assessed P&I and increases capacity, but extending past 30 years requires lender exception
- Portfolio restructuring: selling underperforming or negatively-geared properties removes the loan from the schedule entirely; releases equity to cash but triggers CGT
- Per-property repricing: when only one or two properties are materially out of market vs the rest of the portfolio, propose \`propertyRateChanges\` for those properties only — DO NOT use the global \`rateAdjustment\` lever for partial refinances
- **Cross-collateralisation (Phase G2)**: When a client has multiple investment securities and the standalone per-property equity release is producing $0 or trivial cash on individual properties (because their LVR is already at 80%), POOL them. The blended LVR across the portfolio is usually more generous than any one security in isolation — equity-rich properties subsidise equity-poor ones. Use \`crossCollatPool\` when (a) the client has 2+ investment properties AND (b) finance has indicated cross-collat appetite OR the standalone release produces materially less than the broker's quoted target.
- **Valuation uplift (Phase G1)**: If the client's recorded property values are stale (older than 12 months) or if the broker has an updated AVM/desktop/comparable sales figure, propose \`valuationOverrides\` BEFORE running an equity release scenario. The new valuation flows through to LVR, max loan, and cross-collat math. Always state the basis (\`avm\`, \`desktop\`, \`comparable_sales\`, \`manual\`) and a \`source\` (e.g. agent name, comp address) so the finance team can verify.

## Strategy Levers (your full toolkit)
You can recommend any combination of these adjustments per scenario:
1. **consolidatedLiabilityIds** — Pay off specific liabilities (provide their IDs). Each one frees its full assessed monthly servicing.
2. **refinancedToIOPropertyIds** — Switch specific investment property loans to Interest-Only. Saves the principal portion of the repayment.
3. **rateAdjustment** — GLOBAL rate change in percentage points across the assessment (e.g. -0.5). Use only when modelling a market-wide shift or a full portfolio refinance.
4. **propertyRateChanges** — Array of { propertyId, newRate } for INDIVIDUAL property repricing (Phase F1). Preferred over rateAdjustment when only some properties refinance.
5. **incomeGrowthPercent** — % change in gross income (e.g. 10 for +10%). Must be substantiated with payslips/contract — flag this in the reasoning.
6. **expenseReductionPercent** — % cut in living expenses. Lender will floor at HEM — be realistic.
7. **equityRelease** — { propertyId, targetLVR } releases (currentValue × targetLVR) − loanRemaining as cash. Engine layers shadow IO servicing using that property's contracted rate (Phase F2). Cash should fund the target acquisition.
8. **loanTermAdjustment** — Years +/- on the assessment loan term.
9. **portfolioSellPropertyIds** — IDs of properties to sell. Removes the loan entirely from commitments and converts equity to cash. Trigger CGT — call this out.
10. **dtiCapOverride** — { enabled, value } e.g. { enabled: true, value: 8 } to model an 8x DTI lender. Treat as a policy-exception lever; only propose when a 6x cap is the BINDING constraint.
11. **acquisition** — { state, intent, category, isFirstHomeBuyer, lmiMode, cashOnHand, targetPurchasePrice }. When the user mentions a budget, deposit goal, or new purchase, ALWAYS set this and ALWAYS pass \`targetPurchasePrice\` so the engine reports meetsTarget / shortfallToTarget.
12. **valuationOverrides** — Array of { propertyId, newValue, basis, source }. Use BEFORE equity release scenarios when valuations are stale or finance has supplied updated figures. \`basis\` ∈ ('manual' | 'desktop' | 'avm' | 'comparable_sales'). The override resolves before any other property-bound delta.
13. **crossCollatPool** — { enabled, propertyIds, blendedTargetLVR, lenderMaxLVR?, allocationStrategy? }. Pools 2+ securities into a blended-LVR release; \`allocationStrategy\` defaults to 'highest_equity_first' (pulls from healthiest properties first), 'pro_rata' spreads pulldown evenly. Use when standalone per-property release returns $0 or materially less than what finance has quoted.
14. **capitalAllocations** (Phase K3) — Hyper-granular routing of pool cash (equity release + cash-on-hand) into typed sinks. Use this when the broker says things like "use $80k of the released equity to pay down the Latitude card and park the rest in offset" — translate that into one allocation per sink. Available sinks: \`liability_payoff\` (reduces a liability + its servicing), \`offset_deposit\` (cancels loan interest on a property), \`rate_buydown\` (permanently lowers a property's rate ~25 bps per 1% of loan), \`debt_recycle\` (OO→IP refinance, tax-deductible), \`acquisition_deposit\` (reserved for next purchase), \`holding_reserve\` (cash buffer), \`repayment_reduction\` (direct $/mo cut). The engine clamps total allocations at the available pool balance and surfaces overcommit as validation errors. Pair with \`equityRelease\` or \`crossCollatPool\` to source the pool, or with \`acquisition.cashOnHand\` for cash-only routing.

## Acquisition Awareness
If the user mentions buying a property, a deposit goal, or a specific budget:
- ALWAYS set the acquisition block on at least one scenario (ideally all three)
- ALWAYS pass \`targetPurchasePrice\` so the engine returns a binary "Achievable / Short by $X" result
- Sensible defaults:
  - state: infer from primary residence (default 'NSW')
  - intent: 'investor' unless they say it's their home
  - category: 'established' unless they mention new build / off-the-plan / land
  - isFirstHomeBuyer: true if the client has no existing properties
  - lmiMode: 'display_deduction' (most common bank treatment)
  - cashOnHand: from conversation, otherwise estimate conservatively from savings

## Scenario Design Principles
- **Differentiate the three scenarios meaningfully.** Do NOT submit three near-identical combinations — they should explore different trade-offs (e.g. one conservative / cash-flow-driven, one balanced, one aggressive / equity-release-driven).
- **Lead with the binding constraint.** If DTI is the binding constraint, scenarios should attack DTI (debt payoff, dtiCapOverride). If servicing surplus is binding, attack expenses / liabilities / IO refinance. If LVR is binding, attack deposit (equity release, sell down). Use the data to identify what is actually limiting the client BEFORE proposing levers.
- **Sequence sensibly.** Within a scenario, prefer combinations that a finance team can actually execute in order (discharge debts → reprice / refinance → release equity → submit purchase). Avoid combinations that depend on a future event you cannot evidence.
- **Stack levers responsibly.** Stacking 5+ levers per scenario looks impressive but compounds risk. 2-4 well-chosen levers usually beats 6 marginal ones.
- **Always reference specific numbers from the client's data** — name the actual liability, the actual property, the actual rate. Generic advice is rejected.
- **Call out caveats inline in the reasoning** — HEM floors, DTI exception requirements, valuation risk, CGT, IO term limits, payslip evidence requirements.

## Binding Constraint Discipline (Phase J1)
The system pre-computes the BINDING CONSTRAINT (the actual ceiling on this client's capacity) and surfaces it in the snapshot below. You MUST honour it:
- **Scenario 1 MUST directly attack the binding constraint.** If DTI is binding → debt payoff or dtiCapOverride. If surplus is binding → liability payoff, IO refinance, expense reduction. If LVR/deposit is binding → equity release, cross-collat pool, sell-down.
- **Scenarios 2–3 may explore alternates** (different lever mix, different risk profile) but must still meaningfully move the needle.
- If you propose a lever that does NOT relieve the binding constraint, justify in \`reasoning\` why the secondary effect (e.g. reducing risk, freeing cash) still matters.

## Rejected Levers (Phase J1)
For EACH scenario, populate \`rejectedLevers\` with 2–4 levers you considered but discarded, each with a one-line reason grounded in the client's data (e.g. "Sell IP at 12 King St — only 6% equity, would crystallise a loss"). This makes your recommendation defensible to the broker — they will be asked "why didn't you propose X?" by clients and the finance team.

## Evidence Required (Phase J2)
For EACH scenario, populate \`evidenceRequired\` with 1–5 SPECIFIC documents or confirmations the broker must collect before sending this strategy to finance. Tie each item to a lever you actually used:
- \`incomeGrowthPercent > 0\` → "2 most recent payslips + YTD pay summary" (or "Updated employment contract showing $X salary")
- \`refinancedToIOPropertyIds\` → "Updated rental ledger 12mo for [address]" + "IO term policy confirmation from [lender]"
- \`equityRelease\` / \`crossCollatPool\` → "Desktop valuation or AVM for [address]" + "Cross-collat appetite confirmed by [lender]"
- \`consolidatedLiabilityIds\` → "Discharge confirmation from [provider]" + "Closure of redraw / limit reduction letter"
- \`dtiCapOverride\` → "Lender exception submission template + 2yr financials"
- \`valuationOverrides\` → "Comp sales pack from [agent]" or "AVM report from [provider]"
Generic items like "supporting documents" are REJECTED. Be specific to THIS client and THIS scenario.

## Conversation Guidelines
- Be conversational and ask clarifying questions if the request is vague (especially: target budget, timeframe, risk appetite, owner-occupier vs investment intent).
- Always reference specific numbers from the client's data — name the liability, the property address, the contracted rate.
- Explain WHY each strategy works, not just what to do.
- Anticipate the rationale brief: write \`reasoning\` for each scenario as if it will be quoted directly into a finance handoff (because it will).
- When you're ready to recommend scenarios, call the generate_scenarios tool.
- When the broker asks to refine a previously-generated scenario (e.g. "make scenario 2 more conservative"), reference the PRIOR SCENARIOS block in context — do not re-derive from scratch.
- Keep prose tight — this is for professional mortgage brokers, not retail clients.`;

const SCENARIO_TOOL = {
  type: "function",
  function: {
    name: "generate_scenarios",
    description:
      "Generate exactly 3 borrowing capacity improvement scenarios based on the client's financial data and the conversation.",
    parameters: {
      type: "object",
      properties: {
        scenarios: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Short descriptive name for this scenario (max 50 chars)",
              },
              reasoning: {
                type: "string",
                description:
                  "2-3 sentence explanation of why this strategy improves capacity",
              },
              adjustments: {
                type: "object",
                properties: {
                  consolidatedLiabilityIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "IDs of liabilities to pay off",
                  },
                  refinancedToIOPropertyIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "IDs of properties to refinance to IO",
                  },
                  rateAdjustment: {
                    type: "number",
                    description: "Rate adjustment in percentage points (e.g., -0.5)",
                  },
                  incomeGrowthPercent: {
                    type: "number",
                    description: "Income growth percentage (e.g., 10 for +10%)",
                  },
                  expenseReductionPercent: {
                    type: "number",
                    description: "Expense reduction percentage (e.g., 15 for -15%)",
                  },
                  equityRelease: {
                    type: "object",
                    properties: {
                      propertyId: { type: "string" },
                      targetLVR: { type: "number", description: "Target LVR as decimal e.g. 0.8 for 80%" },
                    },
                    required: ["propertyId", "targetLVR"],
                    description: "Equity release configuration. Set to null if not applicable.",
                    nullable: true,
                  },
                  loanTermAdjustment: {
                    type: "number",
                    description: "Years to add (+) or subtract (-) from base loan term. E.g., 5 extends by 5 years, -5 shortens by 5 years. Use 0 for no change.",
                  },
                  portfolioSellPropertyIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "IDs of properties to sell — removes their loan servicing from commitments. Use empty array if not applicable.",
                  },
                  dtiCapOverride: {
                    type: "object",
                    properties: {
                      enabled: { type: "boolean", description: "Whether to enable a custom DTI cap" },
                      value: { type: "number", description: "DTI cap multiplier e.g. 8 for 8x gross income" },
                      lenderProfile: {
                        type: "string",
                        enum: ["bank_standard", "anz", "macquarie", "westpac", "non_bank"],
                        description: "Phase I1 — flip to this lender's shading profile (re-shades bonus/commission/rental per their policy). ANZ/Westpac=100% bonus w/ 2yr history, Macquarie=95%, non_bank skips HEM floor.",
                      },
                    },
                    required: ["enabled", "value"],
                    description: "Override DTI cap to model different lender policies. Set enabled=false if not applicable.",
                    nullable: true,
                  },
                  lenderProfile: {
                    type: "string",
                    enum: ["bank_standard", "anz", "macquarie", "westpac", "non_bank"],
                    description: "Phase I1 — top-level lender flip when not changing DTI cap. Triggers re-shading of bonus/commission/rental per that lender's policy.",
                    nullable: true,
                  },
                  propertyRateChanges: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        propertyId: { type: "string" },
                        newRate: { type: "number", description: "New contracted annual rate in % (e.g. 5.89)" },
                      },
                      required: ["propertyId", "newRate"],
                    },
                    description: "Per-property rate changes for partial portfolio refinances. Use empty array if not applicable.",
                  },
                  valuationOverrides: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        propertyId: { type: "string" },
                        newValue: { type: "number", description: "New AUD valuation for this property" },
                        basis: {
                          type: "string",
                          enum: ["manual", "desktop", "avm", "comparable_sales"],
                          description: "Methodology basis — drives PDF audit watermark",
                        },
                        source: { type: "string", description: "Free-text justification (agent name, comp address, AVM provider)" },
                      },
                      required: ["propertyId", "newValue", "basis"],
                    },
                    description: "Phase G1 — valuation uplifts. Apply BEFORE equity release scenarios when valuations are stale. Use empty array if not applicable.",
                  },
                  crossCollatPool: {
                    type: "object",
                    properties: {
                      enabled: { type: "boolean" },
                      propertyIds: {
                        type: "array",
                        items: { type: "string" },
                        description: "Property IDs to pool into the cross-collat release",
                      },
                      blendedTargetLVR: {
                        type: "number",
                        description: "Target blended LVR across the pool (e.g. 0.80 for 80%)",
                      },
                      lenderMaxLVR: {
                        type: "number",
                        description: "Per-security lender ceiling (default 0.95)",
                      },
                      allocationStrategy: {
                        type: "string",
                        enum: ["highest_equity_first", "pro_rata"],
                        description: "How to distribute the pool pulldown across securities",
                      },
                    },
                    required: ["enabled", "propertyIds", "blendedTargetLVR"],
                    description: "Phase G2 — cross-collateralised pool release. Set enabled=false when not applicable.",
                    nullable: true,
                  },
                  acquisition: {
                    type: "object",
                    properties: {
                      state: {
                        type: "string",
                        enum: ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "NT", "ACT"],
                        description: "Australian state where the property will be purchased",
                      },
                      intent: {
                        type: "string",
                        enum: ["owner_occupier", "investor"],
                        description: "Purchase intent — investor uses harsher stamp duty in some states",
                      },
                      category: {
                        type: "string",
                        enum: ["established", "new", "vacant_land"],
                        description: "Property type — affects FHB concessions",
                      },
                      isFirstHomeBuyer: { type: "boolean" },
                      lmiMode: {
                        type: "string",
                        enum: ["none", "display_deduction", "debt_capitalised"],
                        description: "How LMI premium is applied",
                      },
                      cashOnHand: {
                        type: "number",
                        description: "Cash deposit available beyond any equity release (AUD)",
                      },
                      targetPurchasePrice: {
                        type: "number",
                        description: "Target purchase price the strategy is solving for (AUD). Set when the user provides a budget so the engine reports meetsTarget / shortfall.",
                      },
                    },
                    required: ["state", "intent"],
                    description: "Acquisition context for max purchase price math. ONLY include when the user is targeting a new property purchase. Omit otherwise.",
                    nullable: true,
                  },
                  capitalAllocations: {
                    type: "array",
                    description: "Phase K3 — Hyper-granular routing of pool capital (equity release + cash-on-hand) into specific sinks. Use this when you want to (a) pay down a SPECIFIC liability with a SPECIFIC dollar amount from the released equity, (b) park funds in an offset account, (c) buy down a property's interest rate, (d) reserve a precise deposit for the next purchase, etc. Each allocation consumes from the default pool. The engine clamps total allocations at the available pool balance. Use empty array if not applicable.",
                    items: {
                      type: "object",
                      properties: {
                        amount: { type: "number", description: "Dollars to route from the pool into this sink" },
                        sinkType: {
                          type: "string",
                          enum: ["liability_payoff", "offset_deposit", "rate_buydown", "debt_recycle", "acquisition_deposit", "holding_reserve", "repayment_reduction"],
                          description: "Where the cash goes. liability_payoff → reduces a liability balance + servicing. offset_deposit → cancels interest on a property loan. rate_buydown → permanently buys down a property's rate (~25 bps per 1% of loan balance). debt_recycle → OO loan paydown + IP redraw (servicing-neutral, tax-deductible). acquisition_deposit → reserved for next purchase deposit. holding_reserve → cash buffer (no servicing impact). repayment_reduction → direct $/mo cut on a target loan.",
                        },
                        sinkTargetId: { type: "string", description: "Liability id (for liability_payoff) or property id (for offset_deposit, rate_buydown, debt_recycle, repayment_reduction). Omit for acquisition_deposit and holding_reserve." },
                        offsetRatePoints: { type: "number", description: "Optional override of the rate used for offset interest savings (defaults to property contracted rate)." },
                        rateBuydownPoints: { type: "number", description: "Optional explicit rate buydown in percentage points (max 2.0). If omitted the engine derives buydown from amount/loan ratio." },
                        repaymentReductionMonthly: { type: "number", description: "$/mo reduction on the target loan (only for repayment_reduction sink). Capped at the loan's existing servicing." },
                      },
                      required: ["amount", "sinkType"],
                    },
                  },
                },
                required: [
                  "consolidatedLiabilityIds",
                  "refinancedToIOPropertyIds",
                  "rateAdjustment",
                  "incomeGrowthPercent",
                  "expenseReductionPercent",
                  "loanTermAdjustment",
                  "portfolioSellPropertyIds",
                ],
              },
              estimatedImpact: {
                type: "string",
                description:
                  "Estimated capacity change e.g. '+$85,000' or '+12%'",
              },
              rejectedLevers: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    lever: {
                      type: "string",
                      description: "Short name of the lever you considered (e.g. 'Sell 12 King St', 'Refinance to IO', 'DTI exception to 8x')",
                    },
                    reason: {
                      type: "string",
                      description: "One-line justification for rejecting this lever, grounded in the client's data",
                    },
                  },
                  required: ["lever", "reason"],
                },
                description: "Phase J1 — 2-4 levers you considered but rejected, each with a data-grounded reason. Surfaced to the broker so they can defend the recommendation.",
              },
              executionRisk: {
                type: "string",
                enum: ["low", "medium", "high"],
                description: "Phase J1 — execution risk profile. low = standard policy, medium = needs evidence, high = needs lender exception or material trade-off.",
              },
              evidenceRequired: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: { type: "string" },
                description: "Phase J2 — concrete documents/confirmations the broker must collect to defend this scenario to the finance team (e.g. '2 most recent payslips', 'Tenancy ledger 12mo', 'Discharge letter from Latitude', 'Updated valuation comp from agent X'). Be specific to the levers used — generic items will be rejected.",
              },
            },
            required: ["name", "reasoning", "adjustments", "estimatedImpact", "rejectedLevers", "executionRisk", "evidenceRequired"],
          },
        },
      },
      required: ["scenarios"],
    },
  },
};

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { messages, clientContext, priorScenarios } = body;

    // Auth check
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Borrowing Capacity is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'borrowing-capacity');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap conversation length
    const cappedMessages = messages.slice(-20);

    // ── Phase H: detect target purchase price + clarification mode ──────
    const inferredTargetPrice = detectTargetPrice(cappedMessages);
    const lastUserMessage = [...cappedMessages].reverse().find((m: any) => m.role === 'user')?.content || '';
    const clarificationMode = isClarificationMessage(lastUserMessage);
    // Phase J2: structured acquisition hints from the conversation prose
    const acquisitionHints = extractAcquisitionHints(cappedMessages);
    console.log('[bc-scenario-agent] inferredTargetPrice:', inferredTargetPrice, '| clarificationMode:', clarificationMode, '| acquisitionHints:', acquisitionHints);

    // Build context summary from client data
    let contextBlock = "";
    if (clientContext) {
      const { baseInputs, baseResult, liabilities, properties } = clientContext;

      // Phase E (M4): Pre-compute the binding constraint so the AI stops
      // proposing levers that don't move the actual ceiling.
      const grossAnnualIncome = Number(baseInputs?.grossAnnualIncome || 0);
      const dtiCap = Number(baseInputs?.dtiCapLimit || 6);
      const dtiCapEnabled = !!baseInputs?.dtiCapEnabled;
      const totalDebt = Number(baseInputs?.totalDebtBalances || 0);
      const capacity = Number(baseResult?.borrowingCapacity || 0);
      const dtiHeadroom = grossAnnualIncome > 0
        ? (grossAnnualIncome * dtiCap - totalDebt - capacity) / Math.max(1, grossAnnualIncome * dtiCap)
        : 1;
      const surplus = Number(baseResult?.monthlySurplus || 0);

      let bindingConstraint = "surplus (serviceability)";
      if (dtiCapEnabled && dtiHeadroom < 0.05) bindingConstraint = `DTI cap (${dtiCap}x gross income — capacity is hard-capped here, income-growth and debt-payoff levers help most)`;
      else if (surplus < 500) bindingConstraint = "monthly surplus (expense reduction or income growth move the needle most)";
      else if (capacity < 100000) bindingConstraint = "low absolute capacity — focus on commitment reduction";

      contextBlock = `\n\n## Client Financial Snapshot
**Current Borrowing Capacity**: $${capacity.toLocaleString()}
**Serviceability Band**: ${baseResult?.serviceabilityBand || "N/A"}
**Monthly Surplus**: $${surplus.toLocaleString()}
**DTI Ratio**: ${baseResult?.dtiRatio || "N/A"} (cap ${dtiCapEnabled ? `${dtiCap}x ENABLED` : `${dtiCap}x not enforced`})
**🎯 Binding Constraint**: ${bindingConstraint}

**Income**: Gross $${grossAnnualIncome.toLocaleString()}/yr | Shaded $${baseInputs?.shadedAnnualIncome?.toLocaleString() || 0}/yr
**Living Expenses**: $${baseInputs?.monthlyLivingExpenses?.toLocaleString() || 0}/mo
**Existing Commitments**: $${baseInputs?.monthlyCommitments?.toLocaleString() || 0}/mo
**Interest Rate**: ${baseInputs?.interestRate || 0}% + ${baseInputs?.bufferRate || 0}% buffer
**Loan Term**: ${baseInputs?.loanTermYears || 30} years

### Liabilities (${liabilities?.length || 0})
${(liabilities || []).map((l: any) => `- [${l.id}] ${l.label} (${l.type}): Balance $${l.balance?.toLocaleString()}, Servicing $${l.monthlyServicing?.toLocaleString()}/mo${l.limit ? `, Limit $${l.limit.toLocaleString()}` : ""}`).join("\n") || "None"}

### Properties (${properties?.length || 0})
${(properties || []).map((p: any) => `- [${p.id}] ${p.address} (${p.property_type}): Value $${p.current_value?.toLocaleString()}, Loan $${p.loan_remaining?.toLocaleString()}, LVR ${p.current_value > 0 ? ((p.loan_remaining / p.current_value) * 100).toFixed(0) : 0}%`).join("\n") || "None"}

## Scenario Discipline (Phase E)
- The binding constraint above tells you which lever moves capacity most. Prioritise it.
- Cap any single 'incomeGrowthPercent' at 25 and 'expenseReductionPercent' at 30 unless the user explicitly pushes higher.
- Always justify the assumption in 'reasoning' with concrete numbers from the snapshot.`;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Phase J1: prior-scenario memory block ───────────────────────────
    let priorScenariosBlock = '';
    if (Array.isArray(priorScenarios) && priorScenarios.length > 0) {
      const summarised = priorScenarios.slice(0, 3).map((s: any, i: number) => {
        const v = s?.engineValidation || {};
        const cap = typeof v.borrowingCapacity === 'number' ? `$${Math.round(v.borrowingCapacity).toLocaleString()}` : 'n/a';
        const change = typeof v.capacityChange === 'number' ? `${v.capacityChange >= 0 ? '+' : ''}$${Math.round(v.capacityChange).toLocaleString()}` : 'n/a';
        const meets = v.meetsTarget === true ? 'meets target' : (typeof v.shortfallToTarget === 'number' && v.shortfallToTarget > 0 ? `short $${Math.round(v.shortfallToTarget).toLocaleString()}` : '');
        const risk = s?.executionRisk ? ` risk=${s.executionRisk}` : '';
        const adj = s?.adjustments ? JSON.stringify(s.adjustments).slice(0, 280) : '';
        return `Scenario ${i + 1}: ${s?.name || 'Untitled'} — capacity ${cap} (${change})${meets ? `, ${meets}` : ''}${risk}\n  adjustments: ${adj}`;
      }).join('\n');
      priorScenariosBlock = `\n\n## Prior Scenarios (engine-validated)\nThe broker is iterating on these previously-generated scenarios. Reference them by name when refining; do not re-derive numbers from scratch.\n${summarised}`;
    }

    // ── Phase H: inject inferred target + clarification directive ───────
    let directives = '';
    if (inferredTargetPrice) {
      directives += `\n\n## 🎯 DETECTED TARGET PURCHASE PRICE: $${inferredTargetPrice.toLocaleString()}\nThe broker has mentioned a target purchase price of $${inferredTargetPrice.toLocaleString()}. You MUST set \`acquisition.targetPurchasePrice = ${inferredTargetPrice}\` on EVERY scenario you generate so the engine returns a binary "Achievable / Short by $X" verdict. Do not omit this field.`;
    }
    if (acquisitionHints && (acquisitionHints.state || acquisitionHints.intent || acquisitionHints.category || acquisitionHints.isFirstHomeBuyer || acquisitionHints.cashOnHand)) {
      const hintLines: string[] = [];
      if (acquisitionHints.state) hintLines.push(`- state: ${acquisitionHints.state}`);
      if (acquisitionHints.intent) hintLines.push(`- intent: ${acquisitionHints.intent}`);
      if (acquisitionHints.category) hintLines.push(`- category: ${acquisitionHints.category}`);
      if (acquisitionHints.isFirstHomeBuyer != null) hintLines.push(`- isFirstHomeBuyer: ${acquisitionHints.isFirstHomeBuyer}`);
      if (acquisitionHints.cashOnHand != null) hintLines.push(`- cashOnHand: $${acquisitionHints.cashOnHand.toLocaleString()}`);
      directives += `\n\n## 📋 EXTRACTED ACQUISITION HINTS\nThe broker's prose surfaced these acquisition parameters — use them as the defaults on \`acquisition\` (do NOT contradict them without explicit reason):\n${hintLines.join('\n')}`;
    }
    if (clarificationMode) {
      directives += `\n\n## ⚠️ CLARIFICATION MODE\nThe broker is asking a clarifying question about a previously-generated scenario, NOT requesting new scenarios. DO NOT call the generate_scenarios tool. Respond in natural-language prose only. Reference the engine-validated numbers from the prior scenarios (capacity, meetsTarget, shortfall, loanRequired) directly in your answer.`;
    }

    const aiMessages = [
      { role: "system", content: SYSTEM_PROMPT + contextBlock + priorScenariosBlock + directives },
      ...cappedMessages.map((m: any) => ({ role: m.role, content: m.content })),
    ];

    // Phase 4 (LLM Router): model selection + fallback chain via
    // agent_model_assignments (agent_key='bc_scenario_agent').
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');

    // ── 504 hardening ───────────────────────────────────────────────────
    // The model call(s) can take tens of seconds. Awaiting the full completion
    // before returning a Response let the gateway time out (504). Instead we
    // open the SSE stream IMMEDIATELY, emit keepalive pings, and run the LLM
    // work INSIDE the stream. A wall-clock deadline + per-call timeout bound the
    // total under the function limit; the revision pass is skipped when short.
    const STARTED_AT = Date.now();
    const DEADLINE_AT = STARTED_AT + 110_000;   // total budget for all model work
    const FIRST_CALL_TIMEOUT_MS = 75_000;
    const REVISION_MIN_BUDGET_MS = 45_000;       // only revise if this much remains
    const REVISION_TIMEOUT_MS = 45_000;

    const callAI = async (msgs: any[], timeoutMs: number) => {
      const tools = clarificationMode ? undefined : [SCENARIO_TOOL];
      return await callLLMRaw({
        agentKey: 'bc_scenario_agent',
        messages: msgs as any,
        tools,
        extraBody: {},
        timeoutMs,
        deadlineAt: DEADLINE_AT,
      });
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;
        const enqueue = (chunk: Uint8Array) => {
          if (streamClosed) return;
          try { controller.enqueue(chunk); } catch { /* consumer gone */ }
        };
        const send = (obj: unknown) => enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        const ping = () => enqueue(encoder.encode(`: keepalive\n\n`));
        ping(); // flush first bytes so the gateway opens the response immediately
        const keepalive = setInterval(ping, 10_000);

        try {
          const response = await callAI(aiMessages, FIRST_CALL_TIMEOUT_MS);

          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error("[bc-scenario-agent] AI gateway error:", response.status, errText);
            const msg = response.status === 429
              ? "Rate limit exceeded. Please try again shortly."
              : response.status === 402
                ? "AI credits exhausted. Please top up in Settings → Workspace → Usage."
                : response.status === 504
                  ? "The AI model took too long to respond. Please try again in a moment."
                  : "AI service error. Please try again.";
            send({ error: msg });
            return;
          }

    // Parse the non-streaming AI response, post-process scenarios with the
    // unified engine, and emit a synthetic SSE stream so the existing client
    // parser keeps working unchanged.
    const aiData = await response.json();
    const choice = aiData?.choices?.[0];
    const messageObj = choice?.message ?? {};
    let assistantText: string = messageObj?.content ?? '';
    const toolCalls = Array.isArray(messageObj?.tool_calls) ? messageObj.tool_calls : [];

    let validatedScenarios: AIScenario[] | null = null;
    let toolCallArgsString: string | undefined;
    let revisionAttempts = 0;

    if (toolCalls.length > 0 && clientContext) {
      try {
        const rawArgs = toolCalls[0]?.function?.arguments ?? '{}';
        const parsed = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        if (parsed?.scenarios && Array.isArray(parsed.scenarios)) {
          validatedScenarios = validateAIScenarios(parsed.scenarios as AIScenario[], clientContext, inferredTargetPrice);
          console.log('[bc-scenario-agent] Validated', validatedScenarios.length, 'scenarios via engine (pass 1)');

          // ── Phase J2: validation feedback loop ──────────────────────
          // If the engine flagged structural problems (no positive uplift,
          // hard errors, or every scenario fails the target), re-prompt the
          // model ONCE with explicit corrective guidance. This is the cheapest
          // way to lift "first-shot" quality without adding manual cleanup.
          const baseCapacity = Number(clientContext?.baseResult?.borrowingCapacity || 0);
          const failures: string[] = [];
          validatedScenarios.forEach((s, i) => {
            const v = s.engineValidation;
            if (!v) return;
            const reasons: string[] = [];
            if (v.capacityChange <= 0 && baseCapacity > 0) reasons.push(`zero/negative capacity uplift (${v.capacityChange})`);
            const errIssues = (v.validationIssues || []).filter((x: any) => x.severity === 'error');
            if (errIssues.length > 0) reasons.push(`${errIssues.length} engine error(s): ${errIssues.map((x: any) => x.message).slice(0, 2).join('; ')}`);
            if (typeof v.targetPurchasePrice === 'number' && v.targetPurchasePrice > 0 && v.meetsTarget === false && (v.shortfallToTarget || 0) > v.targetPurchasePrice * 0.15) {
              reasons.push(`misses target by ${Math.round(((v.shortfallToTarget || 0) / v.targetPurchasePrice) * 100)}% (>15% gap)`);
            }
            if (reasons.length > 0) failures.push(`Scenario ${i + 1} "${s.name}": ${reasons.join(' | ')}`);
          });

          // Trigger re-prompt only when ≥2 of 3 are weak (single weak scenario
          // can be a deliberate "stretch" option — don't punish that) AND there
          // is enough wall-clock budget left for a second model call — otherwise
          // the second call is what tips the request over into a gateway 504.
          const revisionBudgetLeft = DEADLINE_AT - Date.now();
          const SHOULD_REVISE = failures.length >= 2 && !clarificationMode && revisionBudgetLeft >= REVISION_MIN_BUDGET_MS;
          if (failures.length >= 2 && !clarificationMode && revisionBudgetLeft < REVISION_MIN_BUDGET_MS) {
            console.log('[bc-scenario-agent] Skipping revision pass — only', revisionBudgetLeft, 'ms budget left');
          }

          if (SHOULD_REVISE) {
            revisionAttempts = 1;
            console.log('[bc-scenario-agent] Triggering revision pass — failures:', failures);
            const revisionInstruction = `\n\n## ⚠️ ENGINE FEEDBACK — REVISE\nYour previous tool call produced scenarios that did NOT pass engine validation:\n${failures.map(f => `- ${f}`).join('\n')}\n\nRegenerate exactly 3 scenarios that EACH:\n1. Produce a strictly POSITIVE \`capacityChange\` (the engine will recompute — be defensible).\n2. Avoid the listed engine errors.\n3. Either CLEAR the target purchase price or shrink the shortfall to <15% of the target. If neither is achievable for this client given current data, say so explicitly in \`reasoning\` and recommend a smaller target.\n4. Each scenario must address the binding constraint (see snapshot above) — do not propose dead levers.\n\nRespond ONLY by calling generate_scenarios with the corrected payload.`;
            const revisedMessages = [
              ...aiMessages,
              { role: 'assistant', content: assistantText || '', tool_calls: toolCalls },
              { role: 'tool', tool_call_id: toolCalls[0]?.id || 'call_0', content: JSON.stringify({ status: 'engine_validation_failed', failures }) },
              { role: 'user', content: revisionInstruction },
            ];
            const revResp = await callAI(revisedMessages, Math.min(REVISION_TIMEOUT_MS, Math.max(1, DEADLINE_AT - Date.now())));
            if (revResp.ok) {
              const revData = await revResp.json();
              const revMessage = revData?.choices?.[0]?.message ?? {};
              const revToolCalls = Array.isArray(revMessage?.tool_calls) ? revMessage.tool_calls : [];
              if (revToolCalls.length > 0) {
                try {
                  const rArgs = revToolCalls[0]?.function?.arguments ?? '{}';
                  const rParsed = typeof rArgs === 'string' ? JSON.parse(rArgs) : rArgs;
                  if (rParsed?.scenarios && Array.isArray(rParsed.scenarios)) {
                    const revised = validateAIScenarios(rParsed.scenarios as AIScenario[], clientContext, inferredTargetPrice);
                    // Pick the better set: revised wins if it has fewer failing scenarios
                    const countFails = (set: AIScenario[]) => set.reduce((acc, s) => {
                      const v = s.engineValidation;
                      if (!v) return acc + 1;
                      if (v.capacityChange <= 0 && baseCapacity > 0) return acc + 1;
                      if ((v.validationIssues || []).some((x: any) => x.severity === 'error')) return acc + 1;
                      return acc;
                    }, 0);
                    if (countFails(revised) <= countFails(validatedScenarios)) {
                      validatedScenarios = revised;
                      if (revMessage?.content) assistantText = revMessage.content;
                      console.log('[bc-scenario-agent] Revision accepted (pass 2)');
                    } else {
                      console.log('[bc-scenario-agent] Revision rejected — keeping pass 1');
                    }
                  }
                } catch (revErr) {
                  console.error('[bc-scenario-agent] Failed to parse revision payload:', revErr);
                }
              }
            } else {
              console.warn('[bc-scenario-agent] Revision call non-ok:', revResp.status);
            }
          }

          toolCallArgsString = JSON.stringify({ scenarios: validatedScenarios, revisionAttempts });
        }
      } catch (err) {
        console.error('[bc-scenario-agent] Failed to validate scenarios:', err);
      }
    }

          // Emit the assistant prose + validated scenarios as synthetic SSE
          // events the existing front-end parser already understands.
          if (assistantText) {
            send({ choices: [{ delta: { content: assistantText } }] });
          }
          if (toolCallArgsString) {
            send({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    function: { name: 'generate_scenarios', arguments: toolCallArgsString },
                  }],
                },
              }],
            });
          }
          if (!assistantText && !toolCallArgsString) {
            send({ error: 'The assistant did not return a usable response. Please rephrase and try again.' });
          }
        } catch (streamErr) {
          console.error('[bc-scenario-agent] stream worker error:', streamErr);
          send({ error: streamErr instanceof Error ? streamErr.message : 'Unexpected error generating scenarios.' });
        } finally {
          clearInterval(keepalive);
          enqueue(encoder.encode('data: [DONE]\n\n'));
          streamClosed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("[bc-scenario-agent] Error:", e);
    return new Response(
      JSON.stringify(internalError(e, 'bc-scenario-agent')),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

