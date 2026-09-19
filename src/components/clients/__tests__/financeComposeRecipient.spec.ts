/**
 * Audit item 12 — "Send to Finance → Compose Email with PDF" wrote to the
 * client.
 *
 * The compose window opened with the customer's address in To, the subject
 * "Portfolio Update - <client>", and a body reading "Dear <client>, Please
 * find attached your updated portfolio documentation" — under a button
 * labelled Send to Finance.
 *
 * Nothing was misrouted. `onEmailClick(pdfBlob, fileName)` carried the
 * document and nothing about who it was for, and `clientEmail` was the only
 * address the dialog had ever been given, so it used it. The menu item beside
 * it, "Quick Send to Finance", already asked who through
 * `FinanceRecipientPicker`; the compose item did not ask at all.
 *
 * It asks now, through the same picker, and the answer travels with the
 * document.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');

function code(relative: string): string {
  return readFileSync(join(root, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\{\/\*)/.test(line))
    .join('\n');
}

const generator = code('src/components/clients/FormaraPDFGenerator.tsx');
const compose = code('src/components/clients/ClientEmailCompose.tsx');
const modal = code('src/components/clients/ClientDetailsModal.tsx');

describe('the compose item asks who, like the send item beside it', () => {
  it('opens the picker instead of composing straight away', () => {
    expect(generator).toMatch(/setPickerIntent\('compose'\); setFinancePickerOpen\(true\)/);
  });

  it('uses one picker for both acts', () => {
    // Two pickers is how two answers to "who at the finance partner" drift.
    const pickers = generator.match(/<FinanceRecipientPicker/g) ?? [];
    expect(pickers).toHaveLength(1);
    expect(generator).toMatch(/deliveryMode=\{pickerIntent === 'compose' \? 'email' : 'portal'\}/);
  });

  it('carries the chosen partner with the document', () => {
    expect(generator).toMatch(/onEmailClick\(pdfBlob, fileName, recipient\)/);
    expect(generator).toMatch(/recipient\?: FinanceReportRecipient/);
  });
});

describe('the dialog addresses whoever the email is for', () => {
  it('prefers the named recipient over the client', () => {
    expect(compose).toMatch(/setTo\(recipient\?\.email \|\| clientEmail \|\| ''\)/);
  });

  it('writes to them about the client, not to the client', () => {
    expect(compose).toMatch(/Please find attached the client details for \$\{clientName\}/);
    expect(compose).toMatch(/Dear \$\{recipient\.name\.split\(' '\)\[0\]\}/);
    expect(compose).toMatch(/Client details - \$\{clientName\}/);
  });

  it('says whose record it is in the dialog header', () => {
    expect(compose).toMatch(/Send an email to \$\{recipient\.name\} about \$\{clientName\}/);
  });

  it('leaves every other caller addressed to the client', () => {
    // `ClientDetailsDownloadButton` passes no recipient. Its wording, its
    // subject and its To must be exactly what they were.
    expect(compose).toMatch(/Portfolio Update - \$\{clientName\}/);
    expect(compose).toMatch(/Please find attached your updated portfolio documentation/);
    expect(compose).toMatch(/recipient = null,/);
  });
});

describe('the recipient does not outlive the send', () => {
  it('is cleared when the dialog closes', () => {
    // Otherwise the next "download PDF and email" would inherit the finance
    // partner from the previous finance send.
    expect(modal).toMatch(/setEmailRecipient\(null\);/);
  });

  it('defaults to none, so an unspecified caller is the client', () => {
    expect(modal).toMatch(/setEmailRecipient\(recipient \?\? null\)/);
  });
});
