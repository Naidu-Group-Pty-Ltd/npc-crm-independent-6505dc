/**
 * Workflow Playground — core graph model.
 *
 * A workflow is a directed graph of nodes. Every node is one of three kinds:
 *   trigger — starts a run. Exactly one per workflow, and it has no inputs.
 *   action  — calls an integration. Consumes the run payload, emits its own keys.
 *   logic   — control flow that never leaves the platform (branch, delay, loop…).
 *
 * The graph is stored as JSON in `workflows.graph`, so these types are the wire
 * format as well as the in-memory model. Keep them additive: a saved workflow
 * written by an older build must still parse.
 */

/**
 * Integration categories, restated rather than imported.
 *
 * The app's `src/lib/integrations/registry` is the authority on this union, but
 * this module also has to parse under Deno in an Edge Function, where `@/`
 * resolves to nothing and the registry's browser dependencies do not belong.
 * `catalog.spec.ts` asserts the two agree, so a category added to the registry
 * and forgotten here fails in CI rather than at run time.
 */
export const INTEGRATION_CATEGORY_IDS = [
  'ai',
  'property_data',
  'crm_marketing',
  'communications',
  'documents',
  'automation',
  'payments',
  'compliance',
  'analytics',
  'productivity',
  'storage',
  'media',
  'infrastructure',
] as const;

export type IntegrationCategoryId = (typeof INTEGRATION_CATEGORY_IDS)[number];

/** Logic nodes have no integration, so they carry their own pseudo-category. */
export type NodeCategoryId = IntegrationCategoryId | 'logic' | 'platform';

export type NodeKind = 'trigger' | 'action' | 'logic';

/**
 * How a field is edited. `expression` accepts `{{node.key}}` references to
 * upstream outputs; everything else is a literal.
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'expression'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'json'
  | 'duration'
  | 'cron'
  | 'keyValue';

export interface FieldOption {
  value: string;
  label: string;
  /** Shown under the label in the select — use for units, limits, cost hints. */
  hint?: string;
}

export interface NodeField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  /** One sentence, plain language, describing what the value does. */
  help?: string;
  options?: FieldOption[];
  /** Only show this field when another field equals one of these values. */
  showWhen?: { field: string; equals: string[] };
  defaultValue?: string | number | boolean;
}

/**
 * A named value a node emits. Downstream nodes reference it as
 * `{{<nodeId>.<key>}}`; the inspector builds that token for you.
 */
export interface NodeOutput {
  key: string;
  label: string;
  /** Informational only — the runtime is schemaless. Drives the token picker. */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'file';
}

/**
 * One entry in the palette. `integrationId` links back to
 * `INTEGRATIONS` so the node inherits the brand mark and, critically, the
 * credential state — a node whose integration has no saved key is rendered
 * unconfigured and blocks the run.
 */
export interface CatalogNode {
  /** Stable id, `<integration>.<operation>`. Persisted in saved graphs. */
  id: string;
  kind: NodeKind;
  name: string;
  /** Plain-language description of what happens, in the interface's voice. */
  summary: string;
  category: NodeCategoryId;
  integrationId?: string;
  /** Lucide icon name for logic/platform nodes that have no brand mark. */
  icon?: string;
  fields: NodeField[];
  outputs: NodeOutput[];
  /** Deep link to the provider's reference for this specific operation. */
  docsUrl?: string;
  /** Extra search terms beyond name/summary. */
  keywords?: string[];
  /** Branch-style nodes emit more than one edge; these label the handles. */
  branches?: { id: string; label: string }[];
  /**
   * How to actually call this operation.
   *
   * A step with a request descriptor can run for real; one without it can only
   * be simulated. This is deliberately data rather than code: 252 operations
   * cannot each have a hand-written executor, and the difference between
   * "sends an SMS" and "posts to Slack" is a URL, an auth style and a body
   * shape — none of which needs a function to express. See
   * `httpRequest.pure.ts` for the template language and `stepExecutor.ts` for
   * the one executor that performs every descriptor there is.
   */
  request?: NodeRequest;
}

/** How a request presents the integration's credentials. */
export type NodeAuth =
  | { type: 'bearer'; secret: string }
  | { type: 'basic'; userSecret: string; passSecret: string }
  | { type: 'header'; name: string; secret: string; prefix?: string }
  | { type: 'query'; name: string; secret: string }
  | { type: 'none' };

/**
 * A declarative HTTP call.
 *
 * Every string is a template — see `httpRequest.pure.ts`. An array of strings
 * is a candidate list: the first that resolves to something non-empty wins,
 * which is how a step-level override falls back to an integration-wide default
 * (Twilio's sending number, say) without a special case.
 */
export interface NodeRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Candidate list allowed, so a per-step endpoint can fall back to a saved one. */
  url: string | string[];
  auth?: NodeAuth;
  headers?: Record<string, string>;
  /** Appended to the URL. An entry resolving to empty is omitted entirely. */
  query?: Record<string, string | string[]>;
  /** `form` sends application/x-www-form-urlencoded, as Twilio requires. */
  encoding?: 'json' | 'form';
  /**
   * An object template, or a single template resolving to one — a webhook step
   * whose whole body is the JSON the person typed has no field names to map.
   */
  body?: Record<string, unknown> | string;
  /**
   * Declared output key → dotted path into the response body. `$status` yields
   * the HTTP status, `$body` the whole payload.
   */
  outputs?: Record<string, string>;
  /**
   * Vendors that answer 200 and put the failure in the body. Slack is the
   * common one: `{"ok": false, "error": "channel_not_found"}` is a failure that
   * every HTTP-status check in the world calls a success.
   */
  okPath?: string;
  errorPath?: string;
  /** Credential keys without which the call cannot be attempted. */
  requires?: string[];
}

export interface Vec2 {
  x: number;
  y: number;
}

/** A node placed on the canvas. */
export interface WorkflowNode {
  id: string;
  /** References `CatalogNode.id`. */
  type: string;
  position: Vec2;
  /** User-supplied override for the catalog name. */
  label?: string;
  config: Record<string, unknown>;
  /** Muted nodes stay on the canvas but are skipped at run time. */
  disabled?: boolean;
  notes?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Which branch handle the edge leaves from; undefined for single-output nodes. */
  sourceBranch?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  graph: WorkflowGraph;
  status: 'draft' | 'live' | 'paused';
  createdAt: string;
  updatedAt: string;
}

/** One reason a workflow cannot run yet. Surfaced by the readiness rail. */
export interface ReadinessIssue {
  /** Blocking issues prevent activation; warnings do not. */
  severity: 'blocking' | 'warning';
  code:
    | 'no-trigger'
    | 'multiple-triggers'
    | 'missing-credential'
    | 'missing-field'
    | 'orphan-node'
    | 'cycle'
    | 'empty-branch';
  /** Written for the person fixing it: what is wrong and what to do. */
  message: string;
  nodeId?: string;
}

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };
