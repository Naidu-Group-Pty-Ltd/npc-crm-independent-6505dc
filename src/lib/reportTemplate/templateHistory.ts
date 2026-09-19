import type { ReportTemplate } from './templateSchema';

export type TemplatePatchOp = 'add' | 'remove' | 'replace';

export interface TemplatePatch {
  op: TemplatePatchOp;
  path: Array<string | number>;
  value?: unknown;
  oldValue?: unknown;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const cloneValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const hasOwn = (obj: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export function diffTemplateValues(
  previous: unknown,
  next: unknown,
  path: Array<string | number> = [],
): TemplatePatch[] {
  if (Object.is(previous, next)) return [];

  if (Array.isArray(previous) && Array.isArray(next)) {
    const patches: TemplatePatch[] = [];
    const common = Math.min(previous.length, next.length);
    for (let index = 0; index < common; index += 1) {
      patches.push(...diffTemplateValues(previous[index], next[index], [...path, index]));
    }
    for (let index = previous.length - 1; index >= next.length; index -= 1) {
      patches.push({ op: 'remove', path: [...path, index], oldValue: cloneValue(previous[index]) });
    }
    for (let index = common; index < next.length; index += 1) {
      patches.push({ op: 'add', path: [...path, index], value: cloneValue(next[index]) });
    }
    return patches;
  }

  if (isPlainObject(previous) && isPlainObject(next)) {
    const patches: TemplatePatch[] = [];
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    keys.forEach((key) => {
      const childPath = [...path, key];
      const previousHasKey = hasOwn(previous, key);
      const nextHasKey = hasOwn(next, key);
      if (!nextHasKey) {
        patches.push({ op: 'remove', path: childPath, oldValue: cloneValue(previous[key]) });
        return;
      }
      if (!previousHasKey) {
        patches.push({ op: 'add', path: childPath, value: cloneValue(next[key]) });
        return;
      }
      patches.push(...diffTemplateValues(previous[key], next[key], childPath));
    });
    return patches;
  }

  return [{
    op: 'replace',
    path,
    value: cloneValue(next),
    oldValue: cloneValue(previous),
  }];
}

export function invertTemplatePatches(patches: TemplatePatch[]): TemplatePatch[] {
  return patches.slice().reverse().map((patch) => {
    if (patch.op === 'add') return { op: 'remove', path: patch.path, oldValue: cloneValue(patch.value) };
    if (patch.op === 'remove') return { op: 'add', path: patch.path, value: cloneValue(patch.oldValue) };
    return {
      op: 'replace',
      path: patch.path,
      value: cloneValue(patch.oldValue),
      oldValue: cloneValue(patch.value),
    };
  });
}

const getParent = (root: unknown, path: Array<string | number>): { parent: any; key: string | number } => {
  if (path.length === 0) return { parent: { value: root }, key: 'value' };
  let parent: any = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    parent = parent[path[index]];
  }
  return { parent, key: path[path.length - 1] };
};

export function applyTemplatePatches(
  template: ReportTemplate,
  patches: TemplatePatch[],
): ReportTemplate {
  let next: any = cloneValue(template);

  patches.forEach((patch) => {
    if (patch.path.length === 0) {
      if (patch.op === 'remove') next = undefined;
      else next = cloneValue(patch.value);
      return;
    }

    const { parent, key } = getParent(next, patch.path);
    if (Array.isArray(parent) && typeof key === 'number') {
      if (patch.op === 'remove') parent.splice(key, 1);
      else if (patch.op === 'add') parent.splice(key, 0, cloneValue(patch.value));
      else parent[key] = cloneValue(patch.value);
      return;
    }

    if (patch.op === 'remove') delete parent[key];
    else parent[key] = cloneValue(patch.value);
  });

  return next as ReportTemplate;
}
