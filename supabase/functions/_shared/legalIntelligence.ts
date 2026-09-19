/**
 * Shared Legal Matter intelligence helpers (Solicitor Portal — Phase 7).
 *
 * Pure, dependency-free domain logic for:
 *   • the matter pipeline board (stage ordering + position normalisation)
 *   • portfolio KPIs (throughput, cycle time, stage mix)
 *   • at-risk / stuck matter detection
 *   • the AI contract analysis tool schema + persisted row whitelist
 *
 * Kept in `_shared` so the portal function and any future Command Centre
 * surface compute identical numbers instead of drifting apart.
 */

export const CONTRACT_ANALYSIS_SELECT = `
  id, legal_matter_id, firm_id, document_id, source_label, status, model,
  summary, parties, key_dates, special_conditions, risk_flags, financials,
  confidence, created_by_type, created_by_solicitor_user_id, confirmed_at,
  confirmed_by_type, review_notes, created_at, updated_at
`;

export const CONTRACT_ANALYSIS_STATUSES = ['draft', 'confirmed', 'dismissed'] as const;
export type ContractAnalysisStatus = (typeof CONTRACT_ANALYSIS_STATUSES)[number];

/** Left→right pipeline lanes on the matter board. Terminal lanes sit last. */
export const PIPELINE_STAGES = [
  'instructed',
  'contract_review',
  'exchanged',
  'cooling_off',
  'conditions',
  'unconditional',
  'pre_settlement',
  'settled',
  'post_settlement',
  'on_hold',
  'terminated',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages that no longer need active progression. */
export const CLOSED_STAGES = new Set<string>(['settled', 'post_settlement', 'terminated']);

/**
 * How many days a matter may sit in a stage before it is considered stuck.
 * Tuned to typical AU conveyancing cadence; closed stages are never stuck.
 */
export const STAGE_STALL_DAYS: Record<string, number> = {
  instructed: 7,
  contract_review: 10,
  exchanged: 7,
  cooling_off: 10,
  conditions: 21,
  unconditional: 30,
  pre_settlement: 14,
  on_hold: 30,
};

export interface MatterRiskSignal {
  code:
    | 'settlement_overdue'
    | 'settlement_imminent'
    | 'cooling_off_imminent'
    | 'finance_clause_overdue'
    | 'finance_clause_imminent'
    | 'building_pest_overdue'
    | 'sunset_approaching'
    | 'stage_stalled'
    | 'no_recent_activity'
    | 'flagged_by_npc';
  severity: 'critical' | 'high' | 'medium';
  label: string;
  detail: string;
}

export interface MatterRiskAssessment {
  matter_id: string;
  score: number;
  level: 'critical' | 'high' | 'medium' | 'ok';
  signals: MatterRiskSignal[];
  days_in_stage: number | null;
}

const SEVERITY_WEIGHT: Record<MatterRiskSignal['severity'], number> = {
  critical: 40,
  high: 25,
  medium: 12,
};

const MS_PER_DAY = 86_400_000;

function startOfDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** Whole days from `now` until an ISO date (negative = in the past). */
export function daysUntil(value: unknown, now: Date = new Date()): number | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.round((startOfDay(parsed) - startOfDay(now)) / MS_PER_DAY);
}

/** Whole days elapsed since an ISO timestamp (negative = future). */
export function daysSince(value: unknown, now: Date = new Date()): number | null {
  const d = daysUntil(value, now);
  return d === null ? null : -d;
}

/**
 * Derive every risk signal for a matter from its own dated fields plus stage
 * dwell time. Deterministic and side-effect free — no AI involved, so the
 * dashboard never presents a model guess as a compliance fact.
 */
export function assessMatterRisk(matter: Record<string, any>, now: Date = new Date()): MatterRiskAssessment {
  const signals: MatterRiskSignal[] = [];
  const status = String(matter.status || '');
  const closed = CLOSED_STAGES.has(status);
  const daysInStage = daysSince(matter.stage_entered_at ?? matter.updated_at, now);

  const settlement = daysUntil(matter.settlement_date, now);
  if (!closed && settlement !== null) {
    if (settlement < 0) {
      signals.push({
        code: 'settlement_overdue',
        severity: 'critical',
        label: 'Settlement date passed',
        detail: `Booked settlement was ${Math.abs(settlement)} day${Math.abs(settlement) === 1 ? '' : 's'} ago and the matter is still ${status.replace(/_/g, ' ')}.`,
      });
    } else if (settlement <= 7) {
      signals.push({
        code: 'settlement_imminent',
        severity: settlement <= 3 ? 'high' : 'medium',
        label: 'Settlement imminent',
        detail: `Settles in ${settlement} day${settlement === 1 ? '' : 's'}.`,
      });
    }
  }

  const coolingOff = daysUntil(matter.cooling_off_expiry, now);
  if (!closed && coolingOff !== null && coolingOff >= 0 && coolingOff <= 2 && status === 'cooling_off') {
    signals.push({
      code: 'cooling_off_imminent',
      severity: 'high',
      label: 'Cooling-off expiring',
      detail: coolingOff === 0 ? 'Cooling-off expires today.' : `Cooling-off expires in ${coolingOff} day${coolingOff === 1 ? '' : 's'}.`,
    });
  }

  const finance = daysUntil(matter.finance_clause_date, now);
  const financeSatisfied = ['unconditional', 'pre_settlement', ...CLOSED_STAGES].includes(status);
  if (!financeSatisfied && finance !== null) {
    if (finance < 0) {
      signals.push({
        code: 'finance_clause_overdue',
        severity: 'critical',
        label: 'Finance clause lapsed',
        detail: `Finance date passed ${Math.abs(finance)} day${Math.abs(finance) === 1 ? '' : 's'} ago without the matter going unconditional.`,
      });
    } else if (finance <= 5) {
      signals.push({
        code: 'finance_clause_imminent',
        severity: 'high',
        label: 'Finance clause due',
        detail: `Finance approval is due in ${finance} day${finance === 1 ? '' : 's'}.`,
      });
    }
  }

  const buildingPest = daysUntil(matter.building_pest_date, now);
  if (!financeSatisfied && buildingPest !== null && buildingPest < 0 && buildingPest >= -30) {
    signals.push({
      code: 'building_pest_overdue',
      severity: 'medium',
      label: 'Building & pest date passed',
      detail: `Building and pest date passed ${Math.abs(buildingPest)} day${Math.abs(buildingPest) === 1 ? '' : 's'} ago.`,
    });
  }

  const sunset = daysUntil(matter.sunset_date, now);
  if (!closed && sunset !== null && sunset >= 0 && sunset <= 90) {
    signals.push({
      code: 'sunset_approaching',
      severity: sunset <= 30 ? 'high' : 'medium',
      label: 'Sunset date approaching',
      detail: `Sunset clause bites in ${sunset} day${sunset === 1 ? '' : 's'}.`,
    });
  }

  const stallLimit = STAGE_STALL_DAYS[status];
  if (!closed && stallLimit && daysInStage !== null && daysInStage > stallLimit) {
    signals.push({
      code: 'stage_stalled',
      severity: daysInStage > stallLimit * 2 ? 'high' : 'medium',
      label: 'Stuck in stage',
      detail: `${daysInStage} days in ${status.replace(/_/g, ' ')} (expected under ${stallLimit}).`,
    });
  }

  const idle = daysSince(matter.updated_at, now);
  if (!closed && idle !== null && idle >= 21) {
    signals.push({
      code: 'no_recent_activity',
      severity: 'medium',
      label: 'No recent activity',
      detail: `Nothing has been updated on this matter for ${idle} days.`,
    });
  }

  if (matter.risk_flag) {
    signals.push({
      code: 'flagged_by_npc',
      severity: 'high',
      label: 'Flagged at risk',
      detail: String(matter.risk_notes || 'Flagged for attention.').slice(0, 240),
    });
  }

  const score = signals.reduce((sum, s) => sum + SEVERITY_WEIGHT[s.severity], 0);
  const level: MatterRiskAssessment['level'] = signals.some((s) => s.severity === 'critical')
    ? 'critical'
    : signals.some((s) => s.severity === 'high')
      ? 'high'
      : signals.length
        ? 'medium'
        : 'ok';

  return { matter_id: String(matter.id), score, level, signals, days_in_stage: daysInStage };
}

export interface PortfolioKpis {
  total: number;
  active: number;
  closed: number;
  by_status: Record<string, number>;
  settling_7d: number;
  settling_30d: number;
  settled_90d: number;
  overdue_settlements: number;
  at_risk: number;
  critical: number;
  stalled: number;
  avg_days_to_settle: number | null;
  avg_days_in_stage: number | null;
  total_pipeline_value: number;
  settlements_by_month: Array<{ month: string; count: number; value: number }>;
}

/** Aggregate portfolio-level KPIs from a matter list plus their risk assessments. */
export function computePortfolioKpis(
  matters: Array<Record<string, any>>,
  assessments: MatterRiskAssessment[],
  now: Date = new Date(),
): PortfolioKpis {
  const byId = new Map(assessments.map((a) => [a.matter_id, a]));
  const byStatus: Record<string, number> = {};
  const monthly = new Map<string, { count: number; value: number }>();

  let active = 0;
  let closed = 0;
  let settling7 = 0;
  let settling30 = 0;
  let settled90 = 0;
  let overdue = 0;
  let pipelineValue = 0;
  const settleDurations: number[] = [];
  const stageDurations: number[] = [];

  for (const m of matters) {
    const status = String(m.status || 'instructed');
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const isClosed = CLOSED_STAGES.has(status);
    if (isClosed) closed += 1; else active += 1;

    const price = Number(m.purchase_price);
    if (!isClosed && Number.isFinite(price)) pipelineValue += price;

    const settlement = daysUntil(m.settlement_date, now);
    if (!isClosed && settlement !== null) {
      if (settlement < 0) overdue += 1;
      if (settlement >= 0 && settlement <= 7) settling7 += 1;
      if (settlement >= 0 && settlement <= 30) settling30 += 1;
    }

    const actual = m.actual_settlement_date;
    if (actual) {
      const since = daysSince(actual, now);
      if (since !== null && since >= 0 && since <= 90) settled90 += 1;
      const opened = m.opened_at || m.created_at;
      if (opened) {
        const openedDays = daysSince(opened, now);
        const settledDays = daysSince(actual, now);
        if (openedDays !== null && settledDays !== null && openedDays >= settledDays) {
          settleDurations.push(openedDays - settledDays);
        }
      }
      const key = String(actual).slice(0, 7);
      const bucket = monthly.get(key) ?? { count: 0, value: 0 };
      bucket.count += 1;
      if (Number.isFinite(price)) bucket.value += price;
      monthly.set(key, bucket);
    }

    const assessment = byId.get(String(m.id));
    if (!isClosed && assessment?.days_in_stage !== null && assessment?.days_in_stage !== undefined) {
      stageDurations.push(assessment.days_in_stage);
    }
  }

  const avg = (values: number[]) => (values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null);

  return {
    total: matters.length,
    active,
    closed,
    by_status: byStatus,
    settling_7d: settling7,
    settling_30d: settling30,
    settled_90d: settled90,
    overdue_settlements: overdue,
    at_risk: assessments.filter((a) => a.level === 'critical' || a.level === 'high').length,
    critical: assessments.filter((a) => a.level === 'critical').length,
    stalled: assessments.filter((a) => a.signals.some((s) => s.code === 'stage_stalled')).length,
    avg_days_to_settle: avg(settleDurations),
    avg_days_in_stage: avg(stageDurations),
    total_pipeline_value: Math.round(pipelineValue),
    settlements_by_month: Array.from(monthly.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, v]) => ({ month, count: v.count, value: Math.round(v.value) })),
  };
}

/** Group matters into pipeline lanes, ordered by board position then settlement. */
export function buildPipelineBoard(
  matters: Array<Record<string, any>>,
  assessments: MatterRiskAssessment[],
): Array<{ stage: PipelineStage; matter_ids: string[]; count: number; value: number }> {
  const byId = new Map(assessments.map((a) => [a.matter_id, a]));
  return PIPELINE_STAGES.map((stage) => {
    const inStage = matters
      .filter((m) => String(m.status) === stage)
      .sort((a, b) => (Number(a.kanban_position ?? 0) - Number(b.kanban_position ?? 0))
        || String(a.settlement_date || '9999').localeCompare(String(b.settlement_date || '9999')));
    return {
      stage,
      matter_ids: inStage.map((m) => String(m.id)),
      count: inStage.length,
      value: Math.round(inStage.reduce((sum, m) => sum + (Number(m.purchase_price) || 0), 0)),
      // risk roll-up is read off the assessments map by the caller when needed
      ...(byId.size ? {} : {}),
    };
  });
}

/**
 * Tool schema for the contract analyser. Deliberately flat and enum-light so the
 * gateway's schema compiler accepts it across models.
 */
export const CONTRACT_ANALYSIS_TOOL = {
  type: 'function',
  function: {
    name: 'record_contract_analysis',
    description: 'Record a structured review of an Australian property contract of sale.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Plain-English summary of the contract in 4-8 sentences for a conveyancer.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence between 0 and 1 that the extraction is complete and accurate.',
        },
        parties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              name: { type: 'string' },
              detail: { type: 'string' },
            },
            required: ['role', 'name'],
            additionalProperties: false,
          },
        },
        key_dates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              date: { type: 'string', description: 'ISO date YYYY-MM-DD if stated, otherwise empty.' },
              basis: { type: 'string', description: 'How the date is calculated if not a fixed date.' },
            },
            required: ['label'],
            additionalProperties: false,
          },
        },
        special_conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              reference: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              obligation_on: { type: 'string', description: 'buyer, seller, both or unclear' },
              deadline: { type: 'string' },
            },
            required: ['title', 'summary'],
            additionalProperties: false,
          },
        },
        risk_flags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', description: 'high, medium or low' },
              title: { type: 'string' },
              detail: { type: 'string' },
              recommended_action: { type: 'string' },
            },
            required: ['severity', 'title', 'detail'],
            additionalProperties: false,
          },
        },
        financials: {
          type: 'object',
          properties: {
            purchase_price: { type: 'string' },
            deposit: { type: 'string' },
            gst_treatment: { type: 'string' },
            adjustments: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['summary', 'special_conditions', 'risk_flags'],
      additionalProperties: false,
    },
  },
} as const;

export const CONTRACT_ANALYSIS_SYSTEM_PROMPT = [
  'You are an experienced Australian property conveyancing paralegal.',
  'You review contracts of sale and produce a structured, conservative first-pass review.',
  'Rules:',
  '- Only state what the supplied text supports. Never invent parties, dates, dollar figures or clause numbers.',
  '- If something is missing or ambiguous, say so explicitly rather than guessing.',
  '- Use Australian conveyancing terminology and state-specific language where the text indicates a state.',
  '- Dates must be ISO (YYYY-MM-DD) only when the text states an actual date; otherwise leave the date empty and explain the basis.',
  '- Flag risk for: short finance or cooling-off windows, unusual special conditions, sunset clauses, vendor-favourable',
  '  termination rights, deposit release, GST/withholding exposure, missing disclosures, and off-the-plan variations.',
  '- This is a drafting aid for a qualified practitioner, not legal advice, and must be confirmed by a human.',
].join('\n');

/** Clamp/normalise an AI tool payload before it is persisted. */
export function normaliseAnalysisPayload(raw: any): {
  summary: string;
  confidence: number | null;
  parties: unknown[];
  key_dates: unknown[];
  special_conditions: unknown[];
  risk_flags: unknown[];
  financials: Record<string, unknown>;
} {
  const arr = (value: unknown, max = 40) => (Array.isArray(value) ? value.slice(0, max) : []);
  const confidence = Number(raw?.confidence);
  return {
    summary: String(raw?.summary ?? '').slice(0, 8000),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
    parties: arr(raw?.parties),
    key_dates: arr(raw?.key_dates),
    special_conditions: arr(raw?.special_conditions, 80),
    risk_flags: arr(raw?.risk_flags),
    financials: (raw?.financials && typeof raw.financials === 'object') ? raw.financials : {},
  };
}
