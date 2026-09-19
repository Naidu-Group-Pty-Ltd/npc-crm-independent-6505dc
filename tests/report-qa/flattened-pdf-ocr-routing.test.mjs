import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync('supabase/functions/report-qa/index.ts', 'utf8');
const page = fs.readFileSync('src/pages/ReportQA.tsx', 'utf8');

test('flattened PDF OCR does not require a pre-existing conversation', () => {
  assert.match(api, /'ocr-pages': \{ access: 'none', permission: 'can_edit', paid: true \}/);
  assert.match(page, /action: 'ocr-pages'/);
  assert.doesNotMatch(page.slice(page.indexOf("action: 'ocr-pages'"), page.indexOf("action: 'ocr-pages'") + 250), /conversationId/);
});

test('standalone OCR is image-only and cannot enable persistence', () => {
  assert.match(api, /const enableRAG = isOcrOnlyAction \? false/);
  assert.match(api, /if \(isOcrOnlyAction && !imagesOnly\)/);
  assert.match(api, /OCR pages are required/);
});