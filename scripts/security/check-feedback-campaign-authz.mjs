import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = await Promise.all(
  [
    '../../src/pages/Feedback.tsx',
    '../../src/lib/missionControl.ts',
    '../../supabase/functions/mission-control-feedback-prompt/index.ts',
    '../../supabase/functions/_shared/missionControl.ts',
  ].map(async (path) => [path, await readFile(new URL(path, import.meta.url), 'utf8')]),
);

for (const [path, source] of files) {
  assert.doesNotMatch(
    source,
    /\bforce\b/i,
    `${path} must not expose or forward a feedback campaign eligibility override`,
  );
}

console.log('Feedback campaign eligibility authorization checks passed.');
