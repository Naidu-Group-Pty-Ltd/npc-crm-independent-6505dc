import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function readNumericConstant(name: string): number {
  const match = functionSource.match(new RegExp(`const ${name} = ([\\d_]+);`));
  expect(match, `${name} must be a numeric fail-fast limit`).not.toBeNull();
  return Number(match![1].replaceAll('_', ''));
}

describe('render-investment-report-pdf resource limits', () => {
  it('keeps Api2PDF rendering within fail-fast budgets', () => {
    expect(readNumericConstant('MAX_RENDER_WAIT_MS')).toBeLessThanOrEqual(115_000);
    expect(readNumericConstant('API2PDF_REQUEST_TIMEOUT_MS')).toBeLessThanOrEqual(45_000);
  });
});

describe('render-investment-report-pdf authorization contract', () => {
  it('authorizes object access before loading report content', () => {
    const authResult = functionSource.indexOf('const { error: authError, userId, authMethod }');
    const accessLookup = functionSource.indexOf('.select("generated_by, client_property_id")', authResult);
    const ownershipCheck = functionSource.indexOf('reportAccess?.generated_by === userId', accessLookup);
    const clientOwnershipCheck = functionSource.indexOf('.eq("created_by", userId)', ownershipCheck);
    const denial = functionSource.indexOf('if (!canAccessReport)', clientOwnershipCheck);
    const contentLookup = functionSource.indexOf('"id, property_address, report_content', denial);

    expect(functionSource).toContain('authMethod !== "service_role"');
    expect(authResult).toBeGreaterThan(-1);
    expect(accessLookup).toBeGreaterThan(authResult);
    expect(ownershipCheck).toBeGreaterThan(accessLookup);
    expect(clientOwnershipCheck).toBeGreaterThan(ownershipCheck);
    expect(denial).toBeGreaterThan(clientOwnershipCheck);
    expect(contentLookup).toBeGreaterThan(denial);
  });

  it('escapes watermark text before embedding it in the SVG data URI', () => {
    // The literal this used to pin was `contact.company_name || brandName ||
    // "NPC"` — a fallback that tiled another tenant's trading name across every
    // body page of an unbranded deployment's report. The issuer is resolved
    // once now (`_shared/reports/issuerIdentity.pure.ts`); what this contract
    // is actually about — that the name is escaped BEFORE it enters the data
    // URI — is unchanged and is what the two assertions below check.
    expect(functionSource).toContain(
      'const wmText = esc(issuer.name.toUpperCase());',
    );
    expect(functionSource).not.toContain('|| "NPC"');
    expect(functionSource).toContain('url("${wmSvg}")');
    expect(functionSource).not.toContain("url('${wmSvg}')");
  });
});
