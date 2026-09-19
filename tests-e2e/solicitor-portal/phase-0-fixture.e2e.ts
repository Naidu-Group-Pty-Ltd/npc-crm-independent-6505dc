import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('tests/solicitor-portal/fixtures/phase-0-scenarios.json', 'utf8'));

test('Phase 0 fixture retains repeat-client and privacy regression cases', async () => {
  expect(fixture.matters.filter((matter: { client_id: string }) => matter.client_id === 'client-repeat')).toHaveLength(4);
  expect(fixture.matters.some((matter: { internal_notes?: string }) => Boolean(matter.internal_notes))).toBeTruthy();
  expect(fixture.links.map((link: { state: string }) => link.state).sort()).toEqual(['linked', 'mismatched', 'unlinked']);
});
