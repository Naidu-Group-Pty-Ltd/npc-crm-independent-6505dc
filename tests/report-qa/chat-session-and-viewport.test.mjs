import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/ReportQA.tsx', 'utf8');

test('streaming chat sends the authoritative HttpOnly staff session cookie', () => {
  const requestStart = page.indexOf('const sendChatRequest');
  assert.notEqual(requestStart, -1);
  const request = page.slice(requestStart, requestStart + 1_100);
  assert.match(request, /credentials: 'include'/);
  assert.doesNotMatch(request, /credentials: 'omit'/);
});

test('chat scrolling is contained in the Radix viewport and follows streaming output', () => {
  assert.match(page, /querySelector<HTMLElement>\('\[data-radix-scroll-area-viewport\]'\)/);
  assert.match(page, /viewport\.scrollTo\(\{ top: viewport\.scrollHeight, behavior \}\)/);
  assert.match(page, /streamingContent\]\);/);
});

test('each loaded report exposes an explicit removal control', () => {
  assert.match(page, /aria-label=\{`Remove \$\{report\.name\} from this chat`\}/);
  assert.match(page, /<Trash2 className="h-3\.5 w-3\.5" \/>/);
  assert.match(page, /void removeReport\(report\.name\)/);
});