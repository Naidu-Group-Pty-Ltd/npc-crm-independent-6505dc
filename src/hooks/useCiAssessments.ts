/**
 * Data access for Commercial & Industrial finance assessments.
 *
 * Everything goes through the `manage-ci-assessments` edge function — the
 * tables admit service_role only, so there is no direct-from-browser path and
 * no way for this module to widen access by accident.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invokeSecureFunction, type InvokeResult } from '@/lib/secureInvoke';
import {
  hydrateAssessmentPayload,
  type AssessmentPayload,
  type AssessmentStatus,
} from '@/lib/ciAssessment/types';
import type { AssessmentResult } from '@/lib/ciAssessment/engine';

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface AssessmentListRow {
  id: string;
  reference: string;
  title: string;
  status: AssessmentStatus;
  segment: 'commercial' | 'industrial';
  assessment_type: string;
  requested_loan: number | null;
  maximum_indicative_loan: number | null;
  proposed_lvr: number | null;
  proposed_dscr: number | null;
  outcome: string | null;
  binding_constraint: string | null;
  client_id: string | null;
  linked_at: string | null;
  current_calculation_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface AssessmentRow extends AssessmentListRow {
  payload: unknown;
}

export interface CalculationRunRow {
  id: string;
  engine_version: string;
  policy_version: string;
  scenario_key: string;
  outcome: string | null;
  binding_constraint: string | null;
  maximum_indicative_loan: number | null;
  created_at: string;
  outputs?: unknown;
}

export interface ClientSearchRow {
  id: string;
  primary_first_name: string | null;
  primary_surname: string | null;
  primary_email: string | null;
  /** The `clients` table stores this as `primary_mobile`, not `primary_phone`. */
  primary_mobile: string | null;
  updated_at: string | null;
}

/** One client's Commercial & Industrial records, as `client_workspace` returns them. */
export interface ClientCiWorkspace {
  assessments: Array<{
    id: string;
    user_id: string;
    reference: string;
    title: string;
    status: string;
    segment: 'commercial' | 'industrial';
    assessment_type: string;
    requested_loan: number | null;
    maximum_indicative_loan: number | null;
    proposed_lvr: number | null;
    proposed_dscr: number | null;
    outcome: string | null;
    binding_constraint: string | null;
    current_calculation_id: string | null;
    linked_at: string | null;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  }>;
  runs: Array<{
    id: string;
    assessment_id: string;
    scenario_key: string;
    outcome: string | null;
    binding_constraint: string | null;
    maximum_indicative_loan: number | null;
    engine_version: string;
    policy_version: string;
    created_at: string;
  }>;
  renders: Array<{
    id: string;
    assessment_id: string;
    status: 'running' | 'succeeded' | 'failed';
    file_name: string;
    page_count: number | null;
    bytes: number | null;
    has_analysis: boolean;
    analysis_note: string | null;
    created_at: string;
  }>;
  links: Array<{
    id: string;
    assessment_id: string;
    linked_at: string;
    unlinked_at: string | null;
    applied_changes: unknown[];
  }>;
  /** The client the workspace belongs to, so a caller need not fetch it twice. */
  client?: {
    id: string;
    primary_first_name: string | null;
    primary_surname: string | null;
    primary_email: string | null;
    primary_mobile: string | null;
  } | null;
  /**
   * What was read into each assessment, one row per document.
   *
   * The intake pack is parsed in the browser and the files themselves are
   * never uploaded, so this is the record of them: the file the values came
   * from, how many fields it filled, and when.
   */
  uploads?: Array<{
    assessmentId: string;
    name: string;
    source: string;
    fields: number;
    capturedAt: string | null;
  }>;
  /**
   * Assessments that belong to this client but are not linked to them —
   * created from the client's own linking step, or linked once and unlinked
   * since. The tab offers the step that finishes the job.
   */
  candidates?: Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    segment: 'commercial' | 'industrial';
    requested_loan: number | null;
    maximum_indicative_loan: number | null;
    updated_at: string;
  }>;
}

export interface AuditEventRow {
  id: string;
  event_type: string;
  detail: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
}

type Envelope<T> = { success?: boolean; data?: T; total?: number; error?: string; code?: string };

async function call<T>(operation: string, payload: Record<string, unknown> = {}): Promise<InvokeResult<Envelope<T>>> {
  return invokeSecureFunction<Envelope<T>>('manage-ci-assessments', { operation, ...payload });
}

/** Flatten the edge envelope into `{ data, error }` the callers already expect. */
function unwrap<T>(res: InvokeResult<Envelope<T>>): { data: T | null; error: string | null; code?: string } {
  if (res.error) return { data: null, error: res.error.message };
  if (res.data && res.data.success === false) {
    return { data: null, error: res.data.error ?? 'Request failed', code: res.data.code };
  }
  return { data: (res.data?.data ?? null) as T | null, error: null };
}

export const ciAssessmentApi = {
  list: async (options: {
    status?: string; segment?: string; search?: string; limit?: number; offset?: number;
  } = {}) => {
    const res = await call<AssessmentListRow[]>('list', options);
    const unwrapped = unwrap<AssessmentListRow[]>(res);
    return { ...unwrapped, total: res.data?.total ?? 0 };
  },

  get: (assessmentId: string) =>
    call<{ assessment: AssessmentRow; latestRun: CalculationRunRow | null }>('get', { assessmentId })
      .then(unwrap),

  create: (input: { title: string; segment: 'commercial' | 'industrial'; assessmentType: string; payload: AssessmentPayload }) =>
    call<AssessmentRow>('create', {
      segment: input.segment,
      data: { title: input.title, assessmentType: input.assessmentType },
      payload: input.payload,
    }).then(unwrap),

  autosave: (input: {
    assessmentId: string; payload: AssessmentPayload; expectedVersion: number;
    title?: string; segment?: 'commercial' | 'industrial'; assessmentType?: string; section?: string;
  }) =>
    call<AssessmentRow>(input.section ? 'update_section' : 'autosave', {
      assessmentId: input.assessmentId,
      payload: input.payload,
      expectedVersion: input.expectedVersion,
      segment: input.segment,
      section: input.section,
      data: { title: input.title, assessmentType: input.assessmentType },
    }).then(unwrap),

  /**
   * Rename, and only rename.
   *
   * Separate from `autosave` because the two answer to different rules: the
   * payload may not move once an assessment is completed, but its name may —
   * an assessment is usually called something forgettable while it is being
   * built and earns its real name at the end. Sending no payload also means a
   * rename cannot lose a version race with the autosave timer.
   */
  rename: (input: { assessmentId: string; title: string }) =>
    call<AssessmentRow>('rename', {
      assessmentId: input.assessmentId,
      data: { title: input.title },
    }).then(unwrap),

  runCalculation: (input: {
    assessmentId: string; payload: AssessmentPayload; result: AssessmentResult; scenarioKey?: string;
  }) =>
    call<CalculationRunRow>('run_calculation', {
      assessmentId: input.assessmentId,
      inputsSnapshot: input.payload,
      policySnapshot: input.result.policy,
      outputs: input.result,
      scenarioKey: input.scenarioKey ?? 'base',
    }).then(unwrap),

  listCalculations: (assessmentId: string) =>
    call<CalculationRunRow[]>('list_calculations', { assessmentId }).then(unwrap),

  saveScenario: (input: {
    assessmentId: string; scenarioKey: string; label: string;
    changedAssumption?: string; parameters?: Record<string, unknown>; outputs?: unknown;
  }) =>
    call('save_scenario', {
      assessmentId: input.assessmentId,
      scenarioKey: input.scenarioKey,
      scenarioLabel: input.label,
      changedAssumption: input.changedAssumption,
      parameters: input.parameters,
      outputs: input.outputs,
    }).then(unwrap),

  listScenarios: (assessmentId: string) =>
    call<unknown[]>('list_scenarios', { assessmentId }).then(unwrap),

  complete: (assessmentId: string) =>
    call<AssessmentRow>('complete', { assessmentId }).then(unwrap),

  searchClients: (search: string) =>
    call<ClientSearchRow[]>('search_clients', { search }).then(unwrap),

  createClient: (input: {
    firstName: string; surname: string; email?: string; mobile?: string;
    /** When set, the creation is written to this assessment's audit trail. */
    assessmentId?: string;
  }) =>
    call<ClientSearchRow>('create_client', input).then(unwrap),

  clientWorkspace: (clientId: string) =>
    call<ClientCiWorkspace>('client_workspace', { clientId }).then(unwrap),

  linkClient: (input: {
    assessmentId: string; clientId: string;
    reconciliationItems: unknown[]; appliedChanges: unknown[];
  }) =>
    call<AssessmentRow>('link_client', input).then(unwrap),

  unlinkClient: (assessmentId: string) =>
    call<AssessmentRow>('unlink_client', { assessmentId }).then(unwrap),

  archive: (assessmentId: string) =>
    call<AssessmentRow>('archive', { assessmentId }).then(unwrap),

  restore: (assessmentId: string) =>
    call<AssessmentRow>('restore', { assessmentId }).then(unwrap),

  audit: (assessmentId: string) =>
    call<AuditEventRow[]>('audit', { assessmentId }).then(unwrap),
};

// ---------------------------------------------------------------------------
// List hook
// ---------------------------------------------------------------------------

export interface AssessmentFilters {
  status?: string;
  segment?: string;
  search?: string;
}

export function useCiAssessments(filters: AssessmentFilters = {}) {
  const [rows, setRows] = useState<AssessmentListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Serialised so the effect below depends on the *contents* of the filter
  // rather than the identity of an object literal recreated every render.
  const key = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    const parsed = JSON.parse(key) as AssessmentFilters;
    const result = await ciAssessmentApi.list({ ...parsed, limit: 100 });
    if (result.error) {
      setError(result.error);
    } else {
      setRows(result.data ?? []);
      setTotal(result.total);
      setError(null);
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { void refresh(); }, [refresh]);

  const metrics = useMemo(() => {
    const active = rows.filter((row) => !row.archived_at && !['completed', 'linked', 'archived'].includes(row.status));
    const completed = rows.filter((row) => row.status === 'completed' || row.status === 'linked');
    const requiringReview = rows.filter((row) => row.status === 'requires_review');
    const lendingRows = rows.filter((row) => (row.requested_loan ?? 0) > 0);
    const lvrRows = rows.filter((row) => (row.proposed_lvr ?? 0) > 0);

    return {
      active: active.length,
      completed: completed.length,
      requiringReview: requiringReview.length,
      totalProposedLending: lendingRows.reduce((sum, row) => sum + (row.requested_loan ?? 0), 0),
      averageProposedLvr: lvrRows.length
        ? lvrRows.reduce((sum, row) => sum + (row.proposed_lvr ?? 0), 0) / lvrRows.length
        : 0,
    };
  }, [rows]);

  return { rows, total, loading, error, refresh, metrics };
}

// ---------------------------------------------------------------------------
// Single-assessment hook with autosave
// ---------------------------------------------------------------------------

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY_MS = 1200;

export function useCiAssessment(assessmentId: string | null) {
  const [record, setRecord] = useState<AssessmentRow | null>(null);
  const [payload, setPayload] = useState<AssessmentPayload | null>(null);
  const [latestRun, setLatestRun] = useState<CalculationRunRow | null>(null);
  const [loading, setLoading] = useState(Boolean(assessmentId));
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Refs, not state: the autosave timer reads these at fire time and must see
  // the newest values without re-arming on every keystroke.
  const versionRef = useRef<number>(0);
  const pendingRef = useRef<AssessmentPayload | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (!assessmentId) {
      setRecord(null); setPayload(null); setLoading(false);
      return;
    }
    setLoading(true);
    const result = await ciAssessmentApi.get(assessmentId);
    if (result.error || !result.data) {
      setError(result.error ?? 'Assessment not found');
      setRecord(null);
      setPayload(null);
    } else {
      setRecord(result.data.assessment);
      setPayload(hydrateAssessmentPayload(result.data.assessment.payload));
      setLatestRun(result.data.latestRun);
      versionRef.current = result.data.assessment.version;
      setError(null);
    }
    setLoading(false);
  }, [assessmentId]);

  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async (section?: string) => {
    const next = pendingRef.current;
    if (!assessmentId || !next || inFlightRef.current) return;

    inFlightRef.current = true;
    setSaveState('saving');
    const result = await ciAssessmentApi.autosave({
      assessmentId,
      payload: next,
      expectedVersion: versionRef.current,
      section,
    });
    inFlightRef.current = false;

    if (result.code === 'VERSION_CONFLICT') {
      // Do not clobber: surface the conflict and let the user reload.
      setSaveState('conflict');
      setError('This assessment was changed in another tab or session. Reload to continue.');
      return;
    }
    if (result.error || !result.data) {
      setSaveState('error');
      setError(result.error ?? 'Save failed');
      return;
    }

    versionRef.current = result.data.version;
    setRecord(result.data);
    setLastSavedAt(result.data.updated_at);
    setError(null);
    // Only settle to "saved" when nothing arrived while the request was open.
    setSaveState(pendingRef.current === next ? 'saved' : 'dirty');
    if (pendingRef.current === next) pendingRef.current = null;
  }, [assessmentId]);

  /** Debounced autosave. Call on every field change. */
  const update = useCallback((next: AssessmentPayload, section?: string) => {
    setPayload(next);
    pendingRef.current = next;
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(section); }, AUTOSAVE_DELAY_MS);
  }, [flush]);

  /** Save immediately — used when leaving a step or before calculating. */
  const saveNow = useCallback(async (section?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await flush(section);
  }, [flush]);

  /**
   * Persist the record title without a refetch.
   *
   * The title lives on the record rather than the payload, but reloading the
   * whole assessment to pick up the new value tore the workspace down to its
   * loading state mid-keystroke — which is what made the name field feel dead.
   * Take the version and record straight from the save response instead.
   *
   * It goes through `rename` rather than an autosave carrying a title. Sending
   * the payload to change a label meant a rename inherited every rule the
   * payload has: a completed assessment refused it outright ("An assessment
   * with status completed cannot be edited"), which is precisely when an
   * assessment finally gets its real name. The dedicated route writes the one
   * column, so the completed figures stay exactly as they were calculated.
   */
  const saveTitle = useCallback(async (title: string) => {
    if (!assessmentId) return;
    setSaveState('saving');
    const result = await ciAssessmentApi.rename({ assessmentId, title });
    if (result.code === 'VERSION_CONFLICT') {
      setSaveState('conflict');
      setError('This assessment was changed in another tab or session. Reload to continue.');
      return;
    }
    if (result.error || !result.data) {
      setSaveState('error');
      setError(result.error ?? 'Save failed');
      return;
    }
    versionRef.current = result.data.version;
    setRecord(result.data);
    setLastSavedAt(result.data.updated_at);
    setError(null);
    setSaveState('saved');
  }, [assessmentId]);


  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Warn before a reload or tab close discards work that has not reached the
  // server. Only armed while there is genuinely something pending.
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'error') return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  return {
    record,
    payload,
    latestRun,
    loading,
    error,
    saveState,
    lastSavedAt,
    hasUnsavedChanges: saveState === 'dirty' || saveState === 'error',
    update,
    saveNow,
    saveTitle,

    reload: load,
    setRecord,
    setLatestRun,
  };
}
