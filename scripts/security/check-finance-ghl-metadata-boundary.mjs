import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const frontend = await readFile(
  new URL('../../src/pages/finance-portal/FinancePortalClients.tsx', import.meta.url),
  'utf8',
);
const edgeFunction = await readFile(
  new URL('../../supabase/functions/finance-portal-client-data/index.ts', import.meta.url),
  'utf8',
);

for (const operation of ['list_ghl_pipelines', 'list_ghl_pipeline_stages']) {
  assert.equal(
    frontend.includes(operation),
    false,
    `Finance portal frontend must not request the restricted ${operation} operation`,
  );
  assert.equal(
    edgeFunction.includes(operation),
    false,
    `Finance portal edge function must not expose the restricted ${operation} operation`,
  );
}

for (const callerControlledField of ['pipeline_ghl_id', 'pipeline_stage_ghl_id']) {
  assert.equal(
    edgeFunction.includes(callerControlledField),
    false,
    `Finance portal edge function must not forward caller-controlled ${callerControlledField}`,
  );
}

console.log('Finance portal GHL metadata boundary checks passed.');
