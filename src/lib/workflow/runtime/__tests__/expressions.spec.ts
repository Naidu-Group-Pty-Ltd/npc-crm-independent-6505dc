import { describe, expect, it } from 'vitest';
import { compare, parseDuration, resolveConfig, resolveValue } from '../expressions';

const scope = {
  trigger: { firstName: 'Rae', count: 3, tags: ['a', 'b'], nested: { deep: 'found' }, zero: 0 },
  search: { results: [{ id: 1 }, { id: 2 }] },
};

describe('reference resolution', () => {
  it('passes the value through when the field is one reference', () => {
    // A loop needs a real array, not "[object Object]".
    expect(resolveValue('{{search.results}}', scope).value).toEqual([{ id: 1 }, { id: 2 }]);
    expect(resolveValue('{{trigger.count}}', scope).value).toBe(3);
  });

  it('interpolates when there is surrounding text', () => {
    expect(resolveValue('Hi {{trigger.firstName}}, you have {{trigger.count}}.', scope).value).toBe(
      'Hi Rae, you have 3.',
    );
  });

  it('reads dotted paths and array indexes', () => {
    expect(resolveValue('{{trigger.nested.deep}}', scope).value).toBe('found');
    expect(resolveValue('{{search.results.1.id}}', scope).value).toBe(2);
  });

  it('keeps a falsy value rather than treating it as missing', () => {
    const resolved = resolveValue('{{trigger.zero}}', scope);
    expect(resolved.value).toBe(0);
    expect(resolved.missing).toEqual([]);
  });

  it('reports a reference that resolved to nothing', () => {
    const resolved = resolveValue('{{trigger.nope}}', scope);
    expect(resolved.value).toBeUndefined();
    expect(resolved.missing).toEqual(['trigger.nope']);
  });

  it('renders a missing reference as empty when interpolating', () => {
    expect(resolveValue('Hi {{trigger.nope}}!', scope).value).toBe('Hi !');
  });

  it('never reaches through the prototype', () => {
    for (const path of ['constructor', 'toString', '__proto__.polluted']) {
      expect(resolveValue(`{{trigger.${path}}}`, scope).value).toBeUndefined();
    }
    expect(resolveValue('{{constructor.name}}', scope).value).toBeUndefined();
  });

  it('resolves through nested objects and arrays', () => {
    const { config, missing } = resolveConfig(
      {
        to: '{{trigger.firstName}}',
        headers: [{ key: 'X-Count', value: '{{trigger.count}}' }],
        body: { greeting: 'Hi {{trigger.firstName}}', missing: '{{trigger.nope}}' },
      },
      scope,
    );
    expect(config.to).toBe('Rae');
    expect((config.headers as { value: unknown }[])[0].value).toBe(3);
    expect((config.body as Record<string, unknown>).greeting).toBe('Hi Rae');
    expect(missing).toEqual(['trigger.nope']);
  });

  it('leaves non-strings alone', () => {
    expect(resolveValue(42, scope).value).toBe(42);
    expect(resolveValue(true, scope).value).toBe(true);
    expect(resolveValue(null, scope).value).toBeNull();
  });
});

describe('comparison', () => {
  it('coerces for numeric comparisons but not for equality', () => {
    expect(compare('42', 'gt', 7)).toBe(true);
    expect(compare(5, 'lt', '9')).toBe(true);
    expect(compare('7', 'eq', 7)).toBe(true);
  });

  it('distinguishes empty from zero', () => {
    expect(compare(0, 'empty')).toBe(false);
    expect(compare(0, 'exists')).toBe(true);
    expect(compare('', 'empty')).toBe(true);
    expect(compare([], 'empty')).toBe(true);
    expect(compare(undefined, 'exists')).toBe(false);
  });

  it('matches inside strings and arrays', () => {
    expect(compare('Unconditional', 'contains', 'condition')).toBe(true);
    expect(compare(['investor', 'buyer'], 'contains', 'buyer')).toBe(true);
    expect(compare(['investor'], 'contains', 'seller')).toBe(false);
  });

  it('handles not-equal', () => {
    expect(compare('a', 'neq', 'b')).toBe(true);
    expect(compare('a', 'neq', 'a')).toBe(false);
  });
});

describe('durations', () => {
  it('reads the units the fields offer', () => {
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('4h')).toBe(14_400_000);
    expect(parseDuration('2d')).toBe(172_800_000);
    expect(parseDuration('45s')).toBe(45_000);
    expect(parseDuration('500ms')).toBe(500);
  });

  it('tolerates spacing and case', () => {
    expect(parseDuration(' 2 H ')).toBe(7_200_000);
  });

  it('rejects what it cannot read', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('5 fortnights')).toBeNull();
  });
});
