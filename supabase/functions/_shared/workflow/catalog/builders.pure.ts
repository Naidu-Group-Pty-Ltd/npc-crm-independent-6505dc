/**
 * Terse constructors for catalog entries.
 *
 * The catalog is long by nature — one entry per real API operation across the
 * integration library — so the shape of each entry has to stay scannable. These
 * helpers exist so a provider file reads as a list of capabilities rather than a
 * wall of object literals.
 */

import type {
  CatalogNode,
  FieldOption,
  NodeCategoryId,
  NodeField,
  NodeOutput,
  NodeRequest,
} from '../types.pure.ts';

type FieldOpts = Partial<Omit<NodeField, 'key' | 'label' | 'type'>>;

const field =
  (type: NodeField['type']) =>
  (key: string, label: string, opts: FieldOpts = {}): NodeField => ({
    key,
    label,
    type,
    ...opts,
  });

export const f = {
  text: field('text'),
  textarea: field('textarea'),
  /** Accepts `{{node.key}}` references to upstream outputs. */
  expr: field('expression'),
  number: field('number'),
  bool: field('boolean'),
  json: field('json'),
  duration: field('duration'),
  cron: field('cron'),
  keyValue: field('keyValue'),
  select: (key: string, label: string, options: FieldOption[], opts: FieldOpts = {}): NodeField => ({
    key,
    label,
    type: 'select',
    options,
    ...opts,
  }),
  multi: (key: string, label: string, options: FieldOption[], opts: FieldOpts = {}): NodeField => ({
    key,
    label,
    type: 'multiselect',
    options,
    ...opts,
  }),
};

/** `opt('gpt-4o', 'GPT-4o', 'Vision, 128k context')` */
export const opt = (value: string, label?: string, hint?: string): FieldOption => ({
  value,
  label: label ?? value,
  hint,
});

/**
 * Output shorthand. `out('id:string:Charge ID')` — type and label are optional
 * and default to `string` and a title-cased key.
 */
export const out = (spec: string): NodeOutput => {
  const [key, type = 'string', ...rest] = spec.split(':');
  const label =
    rest.join(':') ||
    key.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { key, type: type as NodeOutput['type'], label };
};

export const outs = (...specs: string[]): NodeOutput[] => specs.map(out);

interface ProviderSpec {
  integrationId: string;
  category: NodeCategoryId;
  /** Base documentation URL; operations append their own path. */
  docs?: string;
}

interface OperationSpec {
  /** Operation slug — combined with the integration id to form the node id. */
  op: string;
  name: string;
  summary: string;
  kind?: CatalogNode['kind'];
  fields?: NodeField[];
  outputs?: NodeOutput[];
  docsUrl?: string;
  keywords?: string[];
  branches?: CatalogNode['branches'];
  icon?: string;
  /** Declaring this is what makes the operation runnable rather than simulated. */
  request?: NodeRequest;
}

/**
 * Declares every operation for one integration. Returns catalog nodes with the
 * integration id, category and `<integration>.<op>` node id filled in, so the
 * provider files only state what is actually specific to each operation.
 */
export function provider(spec: ProviderSpec, operations: OperationSpec[]): CatalogNode[] {
  return operations.map((o) => ({
    id: `${spec.integrationId}.${o.op}`,
    kind: o.kind ?? 'action',
    name: o.name,
    summary: o.summary,
    category: spec.category,
    integrationId: spec.integrationId,
    fields: o.fields ?? [],
    outputs: o.outputs ?? [],
    docsUrl: o.docsUrl ?? spec.docs,
    keywords: o.keywords,
    branches: o.branches,
    icon: o.icon,
    request: o.request,
  }));
}

/**
 * A node with no integration behind it — logic and platform-native entries.
 * These carry their own full id rather than deriving one from an integration.
 */
export function native(
  category: NodeCategoryId,
  operations: (Omit<OperationSpec, 'op'> & { id: string })[],
): CatalogNode[] {
  return operations.map((o) => ({
    id: o.id,
    kind: o.kind ?? 'logic',
    name: o.name,
    summary: o.summary,
    category,
    icon: o.icon,
    fields: o.fields ?? [],
    outputs: o.outputs ?? [],
    keywords: o.keywords,
    branches: o.branches,
    request: o.request,
  }));
}

/** Every action that sends a message shares these delivery outputs. */
export const DELIVERY_OUTPUTS = outs('messageId:string:Message ID', 'status:string', 'sentAt:string:Sent at');

/** Common shape for "the provider created a record and gave us its id". */
export const recordOutputs = (label: string) =>
  outs(`id:string:${label} ID`, 'url:string:Web URL', 'createdAt:string:Created at');
