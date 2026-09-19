type StableJsonTask = { kind: 'value'; value: unknown } | { kind: 'text'; value: string };

function stableJsonStringify(value: unknown): string {
  const output: string[] = [];
  const tasks: StableJsonTask[] = [{ kind: 'value', value }];

  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === 'text') {
      output.push(task.value);
      continue;
    }

    if (Array.isArray(task.value)) {
      tasks.push({ kind: 'text', value: ']' });
      for (let index = task.value.length - 1; index >= 0; index -= 1) {
        tasks.push({ kind: 'value', value: task.value[index] });
        if (index > 0) tasks.push({ kind: 'text', value: ',' });
      }
      tasks.push({ kind: 'text', value: '[' });
      continue;
    }

    if (task.value && typeof task.value === 'object') {
      const entries = Object.entries(task.value as Record<string, unknown>)
        .filter(([, nested]) => !['undefined', 'function', 'symbol'].includes(typeof nested))
        .sort(([left], [right]) => left.localeCompare(right));
      tasks.push({ kind: 'text', value: '}' });
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, nested] = entries[index];
        tasks.push({ kind: 'value', value: nested });
        tasks.push({ kind: 'text', value: ':' });
        tasks.push({ kind: 'text', value: JSON.stringify(key) });
        if (index > 0) tasks.push({ kind: 'text', value: ',' });
      }
      tasks.push({ kind: 'text', value: '{' });
      continue;
    }

    output.push(JSON.stringify(task.value) ?? 'null');
  }

  return output.join('');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fingerprint the immutable inputs for one report-generation version.
 * Chunk/resume calls share the fingerprint, while changed inputs or a later
 * report version receive a new Mission Control reservation.
 */
export async function buildInvestmentReportMeteringParts(
  body: Record<string, unknown> | null | undefined,
  reportVersion: number | string | null | undefined,
): Promise<Array<string | number>> {
  const inputFingerprint = await sha256Hex(stableJsonStringify({
    propertyAddress: body?.propertyAddress ?? null,
    propertyDetails: body?.propertyDetails ?? null,
    tier: body?.tier ?? null,
  }));

  return body?.reportId
    ? [String(body.reportId), reportVersion ?? 'unknown-version', inputFingerprint]
    : [inputFingerprint];
}
