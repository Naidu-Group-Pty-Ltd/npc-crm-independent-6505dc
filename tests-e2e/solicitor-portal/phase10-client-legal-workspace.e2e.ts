import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('Client Legal Workspace routes and accessibility controls remain wired', async () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const detail = readFileSync('src/pages/portal/PortalLegalDetail.tsx', 'utf8');
  expect(app).toContain('path="legal"');
  expect(app).toContain('path="legal/:caseId"');
  expect(detail).toContain('aria-label="Message to legal team"');
  expect(detail).toContain('aria-label="Upload requested legal document"');
  expect(detail).toContain('lg:grid-cols-2');
});
