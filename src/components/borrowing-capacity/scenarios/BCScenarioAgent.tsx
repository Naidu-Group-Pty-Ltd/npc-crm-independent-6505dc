import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Bot, Send, ChevronDown, ChevronUp, Sparkles, Loader2,
  TrendingUp, CheckCircle2, Zap, Trash2,
} from 'lucide-react';
import { VoiceToTextButton } from '@/components/ui/VoiceToTextButton';
import ReactMarkdown from 'react-markdown';
import type { BorrowingCapacityInput, BorrowingCapacityResult } from '@/utils/borrowingCapacityCalculations';
import type { LiabilityItem, PropertyItem } from './StrategyScenarioModeling';
import { toast } from 'sonner';
import { resolveAuthBearer } from '@/lib/secureInvoke';
import { runScenarioWithInputs, type ScenarioContext } from '@/utils/scenarioDeltaEngine';
import type { ScenarioDelta } from '@/utils/borrowingCapacityTypes';

// ── Types ──────────────────────────────────────────────

interface ScenarioAdjustments {
  consolidatedLiabilityIds: string[];
  refinancedToIOPropertyIds: string[];
  rateAdjustment: number;
  incomeGrowthPercent: number;
  expenseReductionPercent: number;
  equityRelease?: { propertyId: string; targetLVR: number } | null;
  loanTermAdjustment?: number;
  portfolioSellPropertyIds?: string[];
  dtiCapOverride?: { enabled: boolean; value: number; lenderProfile?: string } | null;
  lenderProfile?: 'bank_standard' | 'anz' | 'macquarie' | 'westpac' | 'non_bank' | null;
  /** Phase F1 — per-property rate repricing for partial portfolio refinances. */
  propertyRateChanges?: Array<{ propertyId: string; newRate: number }>;
  /** Phase G1 — Valuation overrides (manual/AVM/desktop/comp sales) */
  valuationOverrides?: Array<{
    propertyId: string;
    newValue: number;
    basis: 'manual' | 'desktop' | 'avm' | 'comparable_sales';
    source?: string;
  }>;
  /** Phase G2 — Cross-collateralised pool release */
  crossCollatPool?: {
    enabled: boolean;
    propertyIds: string[];
    blendedTargetLVR: number;
    lenderMaxLVR?: number;
    allocationStrategy?: 'highest_equity_first' | 'pro_rata';
  } | null;
  capitalAllocations?: Array<{
    amount: number;
    sinkType: 'liability_payoff' | 'offset_deposit' | 'rate_buydown' | 'debt_recycle' | 'acquisition_deposit' | 'holding_reserve' | 'repayment_reduction';
    sinkTargetId?: string;
    offsetRatePoints?: number;
    rateBuydownPoints?: number;
    repaymentReductionMonthly?: number;
  }>;
  /** Phase D + F2: Acquisition context driving stamp duty + LMI math.
   *  When set, the engine derives a maximum purchase price for the scenario.
   *  When `targetPurchasePrice` is included, the engine also reports
   *  `meetsTarget` / `shortfallToTarget`. */
  acquisition?: {
    state: 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'NT' | 'ACT';
    intent: 'owner_occupier' | 'investor';
    category?: 'established' | 'new' | 'vacant_land';
    isFirstHomeBuyer?: boolean;
    isForeignBuyer?: boolean;
    lmiMode?: 'none' | 'display_deduction' | 'debt_capitalised';
    cashOnHand?: number;
    targetPurchasePrice?: number;
  } | null;
}

/** Phase H: Engine-validated metrics returned by the server preview.
 *  Populated BEFORE the user clicks Apply so the cards display engine truth
 *  (capacity, meetsTarget, shortfall, loanRequired) instead of LLM estimates. */
export interface AIScenarioEngineValidation {
  borrowingCapacity: number;
  capacityChange: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
  meetsTarget?: boolean;
  shortfallToTarget?: number;
  maxPurchasePrice?: number;
  loanRequiredForPurchase?: number;
  netCashAfterSettlement?: number;
  releasedCapital?: number;
  targetPurchasePrice?: number;
  validationIssues?: Array<{ deltaId: string; deltaType: string; severity: string; message: string }>;
}

export interface AIScenario {
  name: string;
  reasoning: string;
  adjustments: ScenarioAdjustments;
  estimatedImpact: string;
  /** Phase E (L1): Engine-reconciled impact, populated by parent after applying. */
  reconciledImpact?: string;
  /** Phase H: pre-Apply engine validation from the server preview. */
  engineValidation?: AIScenarioEngineValidation;
  /** Phase J1: Levers the model considered but discarded, with reasons. */
  rejectedLevers?: Array<{ lever: string; reason: string }>;
  /** Phase J1: Execution risk profile (low / medium / high). */
  executionRisk?: 'low' | 'medium' | 'high';
  /** Phase J2: Concrete evidence the broker must collect before submission. */
  evidenceRequired?: string[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface BCScenarioAgentProps {
  baseInputs: BorrowingCapacityInput;
  baseResult: BorrowingCapacityResult;
  liabilities: LiabilityItem[];
  properties: PropertyItem[];
  onApplyScenario: (scenario: AIScenario) => void | string | Promise<string | void>;
  /** Optional client identifier — used to scope persisted chat history per client. */
  clientId?: string;
  /** Phase I1 — typed income components forwarded to the engine for lender-aware re-shading. */
  incomeComponents?: import('@/utils/lenderShadingProfiles').ScenarioIncomeComponent[];
  /** Phase I1 — current lender profile id (defaults to bank_standard). */
  currentLenderProfileId?: string;
  /** Phase I2 — monthly HEM benchmark; engine floors expenses here. */
  hemBenchmark?: number;
  /** Live engine truth for the CURRENTLY-APPLIED scenario, recomputed by the
   *  parent from the same `scenarioResult` that drives the Compound Impact
   *  Summary. When provided it supersedes the applied card's pre-Apply preview
   *  so the card's "Engine Truth" reconciles exactly with the live calculator
   *  (eliminates the pre-Apply-vs-applied drift). Null when no levers are live. */
  appliedEngineSnapshot?: AIScenarioEngineValidation | null;
}

// ── Persistence helpers ────────────────────────────────

interface PersistedChatState {
  messages: ChatMessage[];
  scenarios: AIScenario[];
  appliedIndex: number | null;
  isOpen: boolean;
}

const STORAGE_PREFIX = 'bc-scenario-agent:';

function getStorageKey(clientId?: string): string {
  return `${STORAGE_PREFIX}${clientId || 'global'}`;
}


function normalizePercentRatio(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n > 1 ? n / 100 : n;
}

function normalizeScenarioAdjustments(adjustments?: Partial<ScenarioAdjustments> | null): ScenarioAdjustments {
  const a = adjustments ?? {};
  const equityRelease = a.equityRelease?.propertyId
    ? {
        propertyId: String(a.equityRelease.propertyId),
        targetLVR: normalizePercentRatio(a.equityRelease.targetLVR, 0.80),
      }
    : null;
  const crossCollatPool = a.crossCollatPool?.enabled
    ? {
        enabled: true,
        propertyIds: Array.isArray(a.crossCollatPool.propertyIds) ? a.crossCollatPool.propertyIds.filter(Boolean).map(String) : [],
        blendedTargetLVR: normalizePercentRatio(a.crossCollatPool.blendedTargetLVR, 0.80),
        lenderMaxLVR: normalizePercentRatio(a.crossCollatPool.lenderMaxLVR, 0.95),
        allocationStrategy: a.crossCollatPool.allocationStrategy ?? 'highest_equity_first',
      }
    : null;

  return {
    consolidatedLiabilityIds: Array.isArray(a.consolidatedLiabilityIds) ? a.consolidatedLiabilityIds.filter(Boolean).map(String) : [],
    refinancedToIOPropertyIds: Array.isArray(a.refinancedToIOPropertyIds) ? a.refinancedToIOPropertyIds.filter(Boolean).map(String) : [],
    rateAdjustment: Number.isFinite(Number(a.rateAdjustment)) ? Number(a.rateAdjustment) : 0,
    incomeGrowthPercent: Number.isFinite(Number(a.incomeGrowthPercent)) ? Number(a.incomeGrowthPercent) : 0,
    expenseReductionPercent: Number.isFinite(Number(a.expenseReductionPercent)) ? Number(a.expenseReductionPercent) : 0,
    equityRelease,
    loanTermAdjustment: Number.isFinite(Number(a.loanTermAdjustment)) ? Number(a.loanTermAdjustment) : 0,
    portfolioSellPropertyIds: Array.isArray(a.portfolioSellPropertyIds) ? a.portfolioSellPropertyIds.filter(Boolean).map(String) : [],
    dtiCapOverride: a.dtiCapOverride
      ? {
          enabled: !!a.dtiCapOverride.enabled,
          value: Number.isFinite(Number(a.dtiCapOverride.value)) ? Number(a.dtiCapOverride.value) : 6,
          lenderProfile: a.dtiCapOverride.lenderProfile,
        }
      : null,
    lenderProfile: a.lenderProfile ?? null,
    propertyRateChanges: Array.isArray(a.propertyRateChanges) ? a.propertyRateChanges : [],
    valuationOverrides: Array.isArray(a.valuationOverrides) ? a.valuationOverrides : [],
    crossCollatPool,
    acquisition: a.acquisition ?? null,
  };
}

function normalizeAIScenario(scenario: AIScenario): AIScenario {
  return {
    ...scenario,
    name: scenario.name || 'Suggested Scenario',
    adjustments: normalizeScenarioAdjustments(scenario.adjustments),
  };
}

function loadPersistedState(clientId?: string): PersistedChatState | null {
  try {
    const raw = localStorage.getItem(getStorageKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios.map(normalizeAIScenario) : [],
      appliedIndex: typeof parsed.appliedIndex === 'number' ? parsed.appliedIndex : null,
      isOpen: typeof parsed.isOpen === 'boolean' ? parsed.isOpen : true,
    };
  } catch {
    return null;
  }
}

export function aiAdjustmentsToDeltas(adj: ScenarioAdjustments): ScenarioDelta[] {
  const deltas: ScenarioDelta[] = [];

  for (const id of adj.consolidatedLiabilityIds || []) {
    deltas.push({ id, label: `Pay off liability ${id}`, type: 'liability_payoff', value: 0, unit: 'absolute' });
  }
  for (const id of adj.refinancedToIOPropertyIds || []) {
    deltas.push({ id, label: `Refinance ${id} to IO`, type: 'property_refinance', value: 0, unit: 'absolute' });
  }
  for (const id of adj.portfolioSellPropertyIds || []) {
    deltas.push({ id, label: `Sell ${id}`, type: 'property_sell', value: 0, unit: 'absolute' });
  }
  if (adj.incomeGrowthPercent && Math.abs(adj.incomeGrowthPercent) > 0.001) {
    deltas.push({ id: `income-${adj.incomeGrowthPercent}`, label: `Income ${adj.incomeGrowthPercent > 0 ? '+' : ''}${adj.incomeGrowthPercent}%`, type: 'income_change', value: adj.incomeGrowthPercent, unit: 'percent' });
  }
  if (adj.expenseReductionPercent && adj.expenseReductionPercent > 0.001) {
    deltas.push({ id: `expense-${adj.expenseReductionPercent}`, label: `Reduce expenses ${adj.expenseReductionPercent}%`, type: 'expense_change', value: -adj.expenseReductionPercent, unit: 'percent' });
  }
  if (adj.loanTermAdjustment && Math.abs(adj.loanTermAdjustment) > 0) {
    deltas.push({ id: `loan-term-${adj.loanTermAdjustment}`, label: `Loan term ${adj.loanTermAdjustment > 0 ? '+' : ''}${adj.loanTermAdjustment}yr`, type: 'loan_term_change', value: adj.loanTermAdjustment, unit: 'years' });
  }
  if (adj.rateAdjustment && Math.abs(adj.rateAdjustment) > 0.001) {
    deltas.push({ id: `rate-${adj.rateAdjustment}`, label: `Rates ${adj.rateAdjustment >= 0 ? '+' : ''}${adj.rateAdjustment}%`, type: 'rate_change', value: adj.rateAdjustment, unit: 'rate_points' });
  }
  for (const change of adj.propertyRateChanges || []) {
    if (change.propertyId && Number.isFinite(change.newRate) && change.newRate > 0) {
      deltas.push({ id: change.propertyId, label: `Reprice ${change.propertyId} → ${change.newRate}%`, type: 'property_rate_change', value: change.newRate, unit: 'rate_points' });
    }
  }
  for (const vo of adj.valuationOverrides || []) {
    if (vo.propertyId && Number.isFinite(vo.newValue) && vo.newValue > 0) {
      deltas.push({ id: vo.propertyId, label: `Revalue ${vo.propertyId} → ${vo.newValue}`, type: 'property_value_change', value: vo.newValue, unit: 'absolute', meta: { basis: vo.basis, source: vo.source || '' } });
    }
  }
  if (adj.equityRelease?.propertyId && Number.isFinite(adj.equityRelease.targetLVR)) {
    // targetLVR is a RATIO (e.g. 0.80) — must be `unit: 'ratio'` so the engine
    // treats it as 0.80, not 0.80/100 = 0.008. Mirrors recommendSolutions and
    // crossCollatPool; using 'percent' here silently released ~nothing.
    deltas.push({ id: adj.equityRelease.propertyId, label: `Equity release ${adj.equityRelease.propertyId} → ${(adj.equityRelease.targetLVR * 100).toFixed(0)}% LVR`, type: 'equity_release', value: adj.equityRelease.targetLVR, unit: 'ratio', meta: { targetLVR: adj.equityRelease.targetLVR } });
  }
  if (adj.crossCollatPool?.enabled && adj.crossCollatPool.propertyIds?.length) {
    deltas.push({ id: 'pool-default', label: `Cross-collat pool → ${(adj.crossCollatPool.blendedTargetLVR * 100).toFixed(0)}% blended LVR`, type: 'portfolio_lvr_release', value: adj.crossCollatPool.blendedTargetLVR, unit: 'ratio', meta: { propertyIds: adj.crossCollatPool.propertyIds, lenderMaxLVR: adj.crossCollatPool.lenderMaxLVR ?? null, allocationStrategy: adj.crossCollatPool.allocationStrategy ?? 'highest_equity_first' } });
  }
  const lenderProfile = adj.lenderProfile ?? adj.dtiCapOverride?.lenderProfile;
  if (adj.dtiCapOverride?.enabled && Number.isFinite(adj.dtiCapOverride.value)) {
    deltas.push({ id: 'dti-cap', label: `DTI cap ${adj.dtiCapOverride.value}x${lenderProfile ? ` (${lenderProfile})` : ''}`, type: 'dti_cap_change', value: adj.dtiCapOverride.value, unit: 'ratio', meta: lenderProfile ? { enabled: true, lenderProfile } : { enabled: true } });
  } else if (lenderProfile) {
    deltas.push({ id: 'dti-cap', label: `Lender flip → ${lenderProfile}`, type: 'dti_cap_change', value: 99, unit: 'ratio', meta: { enabled: false, lenderProfile } });
  }
  for (let i = 0; i < (adj.capitalAllocations || []).length; i++) {
    const allocation = adj.capitalAllocations![i];
    if (!allocation || !Number.isFinite(allocation.amount) || allocation.amount <= 0 || !allocation.sinkType) continue;
    deltas.push({
      id: `cap-alloc-${i}-${allocation.sinkType}`,
      label: `Allocate $${Math.round(allocation.amount).toLocaleString('en-AU')} → ${allocation.sinkType.replace(/_/g, ' ')}`,
      type: 'capital_allocation',
      value: allocation.amount,
      unit: 'absolute',
      meta: {
        sinkType: allocation.sinkType,
        sinkTargetId: allocation.sinkTargetId,
        sourcePool: 'pool-default',
        offsetRatePoints: allocation.offsetRatePoints,
        rateBuydownPoints: allocation.rateBuydownPoints,
        repaymentReductionMonthly: allocation.repaymentReductionMonthly,
      },
    });
  }

  return deltas;
}

function savePersistedState(clientId: string | undefined, state: PersistedChatState) {
  try {
    localStorage.setItem(getStorageKey(clientId), JSON.stringify(state));
  } catch {
    // Storage may be full or unavailable — fail silently
  }
}

// ── Component ──────────────────────────────────────────

export function BCScenarioAgent({
  baseInputs,
  baseResult,
  liabilities,
  properties,
  onApplyScenario,
  clientId,
  incomeComponents,
  currentLenderProfileId,
  hemBenchmark,
  appliedEngineSnapshot,
}: BCScenarioAgentProps) {
  // Load persisted state synchronously on mount so history is available immediately
  const initialState = loadPersistedState(clientId);
  const [isOpen, setIsOpen] = useState(initialState?.isOpen ?? true);
  const [messages, setMessages] = useState<ChatMessage[]>(initialState?.messages ?? []);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scenarios, setScenarios] = useState<AIScenario[]>(initialState?.scenarios ?? []);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(initialState?.appliedIndex ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reload state when the client context changes (e.g. switching clients without unmount)
  useEffect(() => {
    const next = loadPersistedState(clientId);
    setMessages(next?.messages ?? []);
    setScenarios(next?.scenarios ?? []);
    setAppliedIndex(next?.appliedIndex ?? null);
    setIsOpen(next?.isOpen ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Persist on every meaningful change
  useEffect(() => {
    savePersistedState(clientId, { messages, scenarios, appliedIndex, isOpen });
  }, [clientId, messages, scenarios, appliedIndex, isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      // WP-11B/C cookie-only: this endpoint uses wildcard CORS (no cookies),
      // so it authenticates via the access-token JWT Bearer (verifyAuth JWT
      // path). The raw session token is no longer read or sent.
      //
      // Resolved rather than read: the access token lives in tab-scoped
      // `sessionStorage`, so a second tab has a perfectly good session — its
      // HttpOnly cookie — and no token to send with it. Reading storage
      // directly sends the ANON key instead and the agent answers
      // "Authentication required" to a signed-in person. Same defect, same
      // fix, as the Report Q&A chat.
      const { token: accessToken } = await resolveAuthBearer({ refreshIfMissing: true });

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bc-scenario-agent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          credentials: 'omit',
          body: JSON.stringify({
            messages: updatedMessages,
            clientContext: {
              baseInputs,
              baseResult,
              liabilities,
              properties,
              // Phase I1/I2 — propagate so the server preview re-shades and
              // floors expenses identically to the client engine.
              incomeComponents,
              currentLenderProfileId,
              hemBenchmark,
            },
            // Phase J1 — give the model an explicit memory of the prior run
            // so refinement requests reference real numbers, not re-derived ones.
            priorScenarios: scenarios.length > 0
              ? scenarios.slice(0, 3).map(s => ({
                  name: s.name,
                  adjustments: s.adjustments,
                  engineValidation: s.engineValidation,
                  executionRisk: s.executionRisk,
                }))
              : undefined,
          }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error('No response body');

      // Stream SSE
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      let toolCallArgs = '';
      let hasToolCall = false;
      let streamError: string | null = null;

      const updateAssistant = (text: string) => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: text } : m);
          }
          return [...prev, { role: 'assistant', content: text }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);

            // In-stream error: the edge function now opens the SSE response
            // immediately (to avoid gateway 504s) and reports model/timeout
            // errors as a `data: { error }` event rather than a non-200 status.
            // Record it and stop — surfaced as a toast after the read loop.
            if (parsed?.error) {
              streamError = String(parsed.error);
              break;
            }

            const delta = parsed.choices?.[0]?.delta;

            // Text content
            if (delta?.content) {
              assistantText += delta.content;
              updateAssistant(assistantText);
            }

            // Tool call accumulation
            if (delta?.tool_calls) {
              hasToolCall = true;
              for (const tc of delta.tool_calls) {
                if (tc.function?.arguments) {
                  toolCallArgs += tc.function.arguments;
                }
              }
            }
          } catch {
            // Partial JSON, skip
          }
        }
        if (streamError) break;
      }

      // Surface a model/timeout error reported inside the stream as a toast,
      // mirroring the pre-stream non-200 handling above.
      if (streamError) {
        throw new Error(streamError);
      }

      // Parse tool call result for scenarios
      if (hasToolCall && toolCallArgs) {
        try {
          const parsed = JSON.parse(toolCallArgs);
          if (parsed.scenarios && Array.isArray(parsed.scenarios)) {
            const ctx: ScenarioContext = {
              baseInputs,
              baseResult,
              properties: properties.map(p => ({
                id: p.id,
                address: p.address,
                propertyType: p.property_type,
                currentValue: p.current_value || 0,
                loanRemaining: p.loan_remaining || 0,
                monthlyRepayment: p.monthly_interest_repayment || 0,
                loanRepaymentAmount: p.loan_repayment_amount ?? p.monthly_interest_repayment ?? 0,
                netMonthlyCashflow: p.net_monthly_cashflow ?? 0,
                interestRate: p.interest_rate,
              })),
              liabilities: liabilities.map(l => ({
                id: l.id,
                type: l.type,
                label: l.label,
                balance: l.balance,
                limit: l.limit,
                monthlyServicing: l.monthlyServicing,
              })),
              incomeComponents,
              currentLenderProfileId,
              hemBenchmark,
            };
            const locallyValidated = (parsed.scenarios as AIScenario[]).map((rawScenario) => {
              const scenario = normalizeAIScenario(rawScenario);
              try {
                const acq = scenario.adjustments?.acquisition;
                const runCtx: ScenarioContext = acq
                  ? {
                      ...ctx,
                      acquisition: {
                        state: acq.state,
                        intent: acq.intent,
                        category: acq.category,
                        isFirstHomeBuyer: acq.isFirstHomeBuyer,
                        isForeignBuyer: acq.isForeignBuyer,
                        lmiMode: acq.lmiMode,
                        cashOnHand: acq.cashOnHand,
                        targetPurchasePrice: acq.targetPurchasePrice,
                      },
                    }
                  : ctx;
                const preview = runScenarioWithInputs(scenario.name, aiAdjustmentsToDeltas(scenario.adjustments), runCtx);
                const acqCapacity = preview.result.acquisitionCapacity;
                return {
                  ...scenario,
                  engineValidation: {
                    ...scenario.engineValidation,
                    borrowingCapacity: Math.round(preview.result.borrowingCapacity),
                    capacityChange: Math.round(preview.result.borrowingCapacity - baseResult.borrowingCapacity),
                    monthlySurplus: Math.round(preview.result.monthlySurplus),
                    serviceabilityBand: preview.result.serviceabilityBand,
                    dtiRatio: Number(preview.result.dtiRatio?.toFixed(2) ?? 0),
                    meetsTarget: acqCapacity?.meetsTarget,
                    shortfallToTarget: acqCapacity?.shortfallToTarget,
                    maxPurchasePrice: acqCapacity?.maxPurchasePrice,
                    loanRequiredForPurchase: acqCapacity?.loanRequiredForPurchase,
                    netCashAfterSettlement: acqCapacity?.netCashAfterSettlement,
                    releasedCapital: acqCapacity?.releasedCapital,
                    targetPurchasePrice: acqCapacity?.targetPurchasePrice,
                    validationIssues: [
                      ...(scenario.engineValidation?.validationIssues ?? []),
                      ...(preview.result.validationIssues ?? []),
                    ],
                  },
                } satisfies AIScenario;
              } catch (e) {
                console.warn('[BCScenarioAgent] Local scenario preview failed; using server validation', e);
                return scenario;
              }
            });
            setScenarios(locallyValidated);
            setAppliedIndex(null);
            // Phase H: only emit the generic fallback when the model returned
            // ZERO prose AND the user message wasn't a clarifying question.
            // Otherwise the assistant's own answer (or the server's
            // clarification-mode prose) is preserved.
            const lower = trimmed.toLowerCase();
            const looksLikeClarification = lower.includes('?') &&
              !/(generate|create|build|run|propose|recommend|show me|give me)/.test(lower);
            if (!assistantText.trim() && !looksLikeClarification) {
              const summaryText = `I've generated **3 scenarios** based on your requirements. Each card below shows the **engine-validated** capacity and (when a target price was detected) whether the strategy actually clears the budget. Click **"Apply"** to load it into the strategy modelling section.`;
              updateAssistant(summaryText);
            }
          }
        } catch (e) {
          console.error('[BCScenarioAgent] Failed to parse tool call:', e);
        }
      }
    } catch (err: any) {
      console.error('[BCScenarioAgent] Error:', err);
      toast.error(err.message || 'Failed to get AI response');
      // Remove loading state but keep messages
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, baseInputs, baseResult, liabilities, properties, scenarios, incomeComponents, currentLenderProfileId, hemBenchmark]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleApply = (scenario: AIScenario, index: number) => {
    const safeScenario = normalizeAIScenario(scenario);
    try {
      setAppliedIndex(index);
      setScenarios(prev => prev.map((s, i) => i === index ? safeScenario : s));
      // Phase E (L1): callback may return engine-reconciled impact string —
      // update the badge so users see verified math, not just AI estimate.
      const maybe = onApplyScenario(safeScenario) as unknown;
      Promise.resolve(maybe as Promise<string | void> | string | void).then((reconciled) => {
        if (typeof reconciled === 'string' && reconciled.length > 0) {
          setScenarios(prev => prev.map((s, i) => i === index ? { ...s, reconciledImpact: reconciled } : s));
        }
      }).catch((err) => {
        console.error('[BCScenarioAgent] Apply scenario callback failed:', err);
        toast.error(err?.message || 'Failed to apply scenario');
        setAppliedIndex(null);
      });
      toast.success(`"${safeScenario.name}" applied to strategy levers`);
    } catch (err: any) {
      console.error('[BCScenarioAgent] Apply scenario failed:', err);
      toast.error(err?.message || 'Failed to apply scenario');
      setAppliedIndex(null);
    }
  };

  const suggestedPrompts = [
    "My client wants to buy a $650k investment property. What strategies can maximise their capacity?",
    "Which debts should we pay off first to get the biggest capacity boost?",
    "Can we improve capacity by refinancing investment loans to Interest-Only?",
  ];

  return (
    <div className="mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-4 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 h-auto"
          >
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-foreground">Strategy Advisor</p>
                <p className="text-xs text-muted-foreground">AI-powered scenario generation</p>
              </div>
            </div>
            {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 border rounded-lg overflow-hidden bg-card">
            {/* Chat toolbar */}
            {(messages.length > 0 || scenarios.length > 0) && (
              <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/30">
                <span className="text-[11px] text-muted-foreground">
                  {messages.length} message{messages.length === 1 ? '' : 's'} • saved
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setMessages([]);
                    setScenarios([]);
                    setAppliedIndex(null);
                    try { localStorage.removeItem(getStorageKey(clientId)); } catch {}
                    toast.success('Chat history cleared');
                  }}
                  disabled={isLoading}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
            )}
            {/* Chat messages */}
            <div ref={scrollRef} className="max-h-[300px] overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center py-4">
                  <Sparkles className="h-8 w-8 text-primary/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-3">
                    Describe your client's goals and I'll generate 3 tailored scenarios
                  </p>
                  <div className="flex flex-col gap-2">
                    {suggestedPrompts.map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}
                        className="text-xs text-left px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1 [&>ul]:mb-1">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t p-3 flex gap-2 items-end">
              <VoiceToTextButton
                onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)}
                disabled={isLoading}
                size="sm"
              />
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what the client needs..."
                className="min-h-[40px] max-h-[80px] resize-none text-sm"
                rows={1}
                disabled={isLoading}
              />
              <Button
                size="icon"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Scenario Cards */}
          {scenarios.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {scenarios.map((scenario, i) => {
                // Reconcile the applied card's "Engine Truth" with the LIVE
                // calculator. The pre-Apply preview (engineValidation) is derived
                // from a separate delta translation and can drift from the live
                // strategy recompute shown in the Compound Impact Summary. Once a
                // card is applied, the parent feeds the live `scenarioResult`
                // snapshot here so both surfaces report the identical figure.
                const isApplied = appliedIndex === i;
                const liveSnapshot = isApplied ? appliedEngineSnapshot : null;
                const effectiveValidation = liveSnapshot
                  ? { ...scenario.engineValidation, ...liveSnapshot }
                  : scenario.engineValidation;
                return (
                <div
                  key={i}
                  className={`border rounded-lg p-4 transition-all ${
                    appliedIndex === i
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold leading-tight">{scenario.name}</h4>
                      {scenario.executionRisk && (
                        <Badge
                          variant="outline"
                          className={`mt-1 text-[9px] h-4 px-1.5 ${
                            scenario.executionRisk === 'low'
                              ? 'border-success/40 text-success dark:text-success'
                              : scenario.executionRisk === 'medium'
                                ? 'border-brand-500/40 text-brand-600 dark:text-brand-400'
                                : 'border-destructive/40 text-destructive'
                          }`}
                        >
                          {scenario.executionRisk.toUpperCase()} RISK
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant={effectiveValidation || scenario.reconciledImpact ? "default" : "outline"}
                      className="shrink-0 text-xs"
                      title={
                        liveSnapshot ? "Engine-verified (applied · live)"
                        : scenario.reconciledImpact ? "Engine-verified (post-Apply)"
                        : scenario.engineValidation ? "Engine-validated (pre-Apply preview)"
                        : "AI estimate (not yet verified)"
                      }
                    >
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {liveSnapshot
                        ? `${effectiveValidation!.capacityChange >= 0 ? '+' : ''}$${Math.round(effectiveValidation!.capacityChange).toLocaleString('en-AU')}`
                        : (scenario.reconciledImpact
                          || (scenario.engineValidation
                            ? `${scenario.engineValidation.capacityChange >= 0 ? '+' : ''}$${Math.round(scenario.engineValidation.capacityChange).toLocaleString('en-AU')}`
                            : scenario.estimatedImpact))}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground mb-3 whitespace-pre-wrap break-words">
                    {scenario.reasoning}
                  </p>

                  {/* Phase J1: Rejected levers — defends the recommendation */}
                  {scenario.rejectedLevers && scenario.rejectedLevers.length > 0 && (
                    <details className="mb-3 rounded-md border border-border/60 bg-muted/30 p-2">
                      <summary className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">
                        Considered & Rejected ({scenario.rejectedLevers.length})
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-[11px]">
                        {scenario.rejectedLevers.map((rl, idx) => (
                          <li key={idx} className="flex gap-1.5">
                            <span className="text-muted-foreground shrink-0">×</span>
                            <span><span className="font-medium">{rl.lever}:</span> <span className="text-muted-foreground">{rl.reason}</span></span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Phase J2: Evidence the broker must collect — defensible handoff */}
                  {scenario.evidenceRequired && scenario.evidenceRequired.length > 0 && (
                    <details className="mb-3 rounded-md border border-primary/30 bg-primary/5 p-2" open>
                      <summary className="text-[10px] uppercase tracking-wide text-primary cursor-pointer">
                        Evidence Required ({scenario.evidenceRequired.length})
                      </summary>
                      <ul className="mt-1.5 space-y-1 text-[11px]">
                        {scenario.evidenceRequired.map((ev, idx) => (
                          <li key={idx} className="flex gap-1.5">
                            <span className="text-primary shrink-0">▸</span>
                            <span className="text-foreground">{ev}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {/* Phase H: Engine truth panel. Pre-Apply this shows the preview;
                      once applied it reconciles to the LIVE calculator snapshot. */}
                  {effectiveValidation && (() => {
                    const v = effectiveValidation!;
                    const fmt = (n?: number) => typeof n === 'number'
                      ? `$${Math.round(n).toLocaleString('en-AU')}`
                      : '—';
                    const hasTarget = typeof v.targetPurchasePrice === 'number' && v.targetPurchasePrice > 0;
                    const meets = v.meetsTarget === true;
                    const bandClass = v.serviceabilityBand === 'green'
                      ? 'text-success dark:text-success'
                      : v.serviceabilityBand === 'amber'
                        ? 'text-brand-600 dark:text-brand-400'
                        : 'text-destructive';
                    return (
                      <div className="mb-3 rounded-md border border-border/60 bg-muted/40 p-2 space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                          <span>{liveSnapshot ? 'Engine Truth (live)' : 'Engine Truth'}</span>
                          {hasTarget && (
                            <Badge
                              variant={meets ? 'default' : 'destructive'}
                              className="h-4 px-1.5 text-[9px]"
                            >
                              {meets ? 'Achievable' : `Short ${fmt(v.shortfallToTarget)}`}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                          <span className="text-muted-foreground">Capacity</span>
                          <span className="text-right font-medium">
                            {fmt(v.borrowingCapacity)}
                            {v.capacityChange !== 0 && (
                              <span className={v.capacityChange > 0 ? 'text-success dark:text-success ml-1' : 'text-destructive ml-1'}>
                                ({v.capacityChange > 0 ? '+' : ''}{fmt(v.capacityChange)})
                              </span>
                            )}
                          </span>
                          <span className="text-muted-foreground">Surplus / mo</span>
                          <span className="text-right font-medium">{fmt(v.monthlySurplus)}</span>
                          <span className="text-muted-foreground">Band / DTI</span>
                          <span className={`text-right font-medium ${bandClass}`}>
                            {v.serviceabilityBand.toUpperCase()} • {v.dtiRatio.toFixed(2)}x
                          </span>
                          {hasTarget && (
                            <>
                              <span className="text-muted-foreground">Target / Max</span>
                              <span className="text-right font-medium">
                                {fmt(v.targetPurchasePrice)} / {fmt(v.maxPurchasePrice)}
                              </span>
                              {typeof v.loanRequiredForPurchase === 'number' && (
                                <>
                                  <span className="text-muted-foreground">Loan req'd</span>
                                  <span className="text-right font-medium">{fmt(v.loanRequiredForPurchase)}</span>
                                </>
                              )}
                              {typeof v.netCashAfterSettlement === 'number' && (
                                <>
                                  <span className="text-muted-foreground">Net cash</span>
                                  <span className={`text-right font-medium ${v.netCashAfterSettlement < 0 ? 'text-destructive' : ''}`}>
                                    {fmt(v.netCashAfterSettlement)}
                                  </span>
                                </>
                              )}
                              {typeof v.releasedCapital === 'number' && v.releasedCapital > 0 && (
                                <>
                                  <span className="text-muted-foreground">Released</span>
                                  <span className="text-right font-medium">{fmt(v.releasedCapital)}</span>
                                </>
                              )}
                            </>
                          )}
                        </div>
                        {v.validationIssues && v.validationIssues.length > 0 && (
                          <div className="text-[10px] text-brand-600 dark:text-brand-400 pt-1 border-t border-border/40">
                            ⚠ {v.validationIssues.length} validation note{v.validationIssues.length > 1 ? 's' : ''} — verify with finance.
                          </div>
                        )}
                        {!liveSnapshot && (
                          <p className="text-[10px] italic text-muted-foreground/70 pt-1 border-t border-border/40">
                            Estimate — verify on Apply.
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Adjustment badges */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {scenario.adjustments.consolidatedLiabilityIds?.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Pay off {scenario.adjustments.consolidatedLiabilityIds.length} debt{scenario.adjustments.consolidatedLiabilityIds.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                    {scenario.adjustments.refinancedToIOPropertyIds?.length > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        IO refinance
                      </Badge>
                    )}
                    {scenario.adjustments.rateAdjustment !== 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Rate {scenario.adjustments.rateAdjustment > 0 ? '+' : ''}{scenario.adjustments.rateAdjustment}%
                      </Badge>
                    )}
                    {scenario.adjustments.incomeGrowthPercent !== 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Income {scenario.adjustments.incomeGrowthPercent > 0 ? '+' : ''}{scenario.adjustments.incomeGrowthPercent}%
                      </Badge>
                    )}
                    {scenario.adjustments.expenseReductionPercent > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Expenses -{scenario.adjustments.expenseReductionPercent}%
                      </Badge>
                    )}
                    {scenario.adjustments.equityRelease && (
                      <Badge variant="secondary" className="text-[10px]">
                        Equity release {Math.round((scenario.adjustments.equityRelease.targetLVR ?? 0) * 100)}% LVR
                      </Badge>
                    )}
                    {(scenario.adjustments.loanTermAdjustment ?? 0) !== 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Term {(scenario.adjustments.loanTermAdjustment ?? 0) > 0 ? '+' : ''}{scenario.adjustments.loanTermAdjustment}yr
                      </Badge>
                    )}
                    {(scenario.adjustments.portfolioSellPropertyIds?.length ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Sell {scenario.adjustments.portfolioSellPropertyIds!.length} property(s)
                      </Badge>
                    )}
                    {scenario.adjustments.dtiCapOverride?.enabled && (
                      <Badge variant="secondary" className="text-[10px]">
                        DTI cap {scenario.adjustments.dtiCapOverride.value}x
                      </Badge>
                    )}
                    {(scenario.adjustments.propertyRateChanges?.length ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Reprice {scenario.adjustments.propertyRateChanges!.length} loan{scenario.adjustments.propertyRateChanges!.length > 1 ? 's' : ''}
                      </Badge>
                    )}
                    {(scenario.adjustments.valuationOverrides?.length ?? 0) > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        Revalue {scenario.adjustments.valuationOverrides!.length} property(s)
                      </Badge>
                    )}
                    {scenario.adjustments.crossCollatPool?.enabled && (
                      <Badge variant="secondary" className="text-[10px]">
                        Cross-collat pool {Math.round((scenario.adjustments.crossCollatPool.blendedTargetLVR ?? 0) * 100)}% LVR
                      </Badge>
                    )}
                    {scenario.adjustments.lenderProfile && !scenario.adjustments.dtiCapOverride?.enabled && (
                      <Badge variant="secondary" className="text-[10px]">
                        Lender: {scenario.adjustments.lenderProfile}
                      </Badge>
                    )}
                    {scenario.adjustments.acquisition && (
                      <Badge variant="outline" className="text-[10px]">
                        Acquisition{scenario.adjustments.acquisition.targetPurchasePrice ? ` · target $${Math.round(scenario.adjustments.acquisition.targetPurchasePrice).toLocaleString('en-AU')}` : ''}
                      </Badge>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant={appliedIndex === i ? 'default' : 'outline'}
                    className="w-full text-xs h-8"
                    onClick={() => handleApply(scenario, i)}
                  >
                    {appliedIndex === i ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Applied
                      </>
                    ) : (
                      <>
                        <Zap className="h-3 w-3 mr-1" />
                        Apply Scenario
                      </>
                    )}
                  </Button>
                </div>
                );
              })}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
