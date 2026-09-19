/**
 * Four regressions this suite exists to stop, all of them things a screenshot
 * shows and a unit test does not.
 *
 * Asserted on source because each is a structural property of one file — that a
 * primary action is on the card rather than behind a menu, that a list comes
 * from a server round trip rather than from a table read, that a dialog has a
 * scroll boundary, and that no production menu names a finance partner. A
 * behavioural test of any one of them would pass while the property it protects
 * was reintroduced two components away.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');
/** Source with comments removed — a rule must be in the code, not in prose about it. */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD = 'src/components/clients/ClientCard.tsx';
const COMPOSER = 'src/components/clients/ClientEmailCompose.tsx';
const PICKER = 'src/components/clients/FinanceRecipientPicker.tsx';
const TYPESET = 'src/components/clients/ClientDetailsDownloadButton.tsx';
const GENERATOR = 'src/components/clients/FormaraPDFGenerator.tsx';

describe('the client card opens a client in one interaction', () => {
  const card = code(CARD);

  it('carries a visible View details control', () => {
    expect(card).toContain('View details');
    expect(card).toContain('aria-label={`View details for ${fullName}`}');
  });

  /**
   * The same handler the card was given. A second route into the record is how
   * one of them ends up opening a stale id.
   */
  it('routes it through the existing onView, not its own navigation', () => {
    expect(card).not.toContain('useNavigate');
    // A client URL in a navigation, not a substring anywhere in the file: the
    // bare `/clients/` also matched the module path of a shared helper this
    // card imports, so the rule had to name what it is actually about.
    expect(card).not.toMatch(/navigate\(\s*[`'"][^`'"]*\/clients\//);
    expect(card).not.toMatch(/<Link[^>]*to=\{?[`'"][^`'"]*\/clients\//);
    expect(card).not.toMatch(/href=\{?[`'"][^`'"]*\/clients\//);
    expect((card.match(/onClick=\{onView\}/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('does not also offer View details in the overflow menu', () => {
    expect(card).not.toContain('<Eye className="mr-2 h-4 w-4" />View details');
  });

  /** Everything the menu is still for. */
  it.each(['Sync to GHL', 'View in GHL', 'Delete'])('keeps %s in the overflow menu', (label) => {
    expect(card).toContain(label);
  });
});

describe('the email composer', () => {
  const composer = code(COMPOSER);

  /**
   * The shared mailbox's address is a server secret, so a list the browser
   * builds cannot state it — which is why the field used to read
   * "Organisation shared mailbox" where an address belongs.
   */
  it('takes its sender list from the function that validates the send', () => {
    expect(composer).toContain('useSenderMailboxes');
    expect(composer).not.toContain("from('custom_users')");
    expect(composer).not.toContain('personal_mailbox');
    expect(composer).not.toContain("emailAddress: 'Organisation shared mailbox'");
  });

  it('shows a name and the address it will send from', () => {
    expect(composer).toContain('{mailbox.displayName}');
    expect(composer).toContain('{mailbox.emailAddress}');
  });

  it('says when the list is loading and when it could not be read', () => {
    expect(composer).toContain('Loading available sending accounts…');
    expect(composer).toContain('Unable to retrieve authorised sending accounts.');
  });

  /**
   * `DialogContent` is `sm:overflow-visible`, so a dialog that does not bound
   * itself overflows the viewport rather than scrolling. Expanding Cc/Bcc adds
   * two fields, and that is what took Send Email off screen.
   */
  it('bounds itself and scrolls its body rather than the page', () => {
    expect(composer).toContain('flex max-h-[90dvh] flex-col');
    expect(composer).toContain('min-h-0 flex-1');
    expect(composer).toContain('overflow-y-auto');
  });

  it('keeps the header and the send controls outside the scroll region', () => {
    // Both regions shrink-0: a flex child that may shrink can be squeezed out
    // by a long body, which is the same defect wearing different CSS.
    expect(composer).toMatch(/<DialogHeader className="shrink-0/);
    expect(composer).toMatch(/<DialogFooter className="shrink-0/);
  });

  it('still base64-encodes the attached report and sends the chosen sender', () => {
    expect(composer).toContain('await fileToBase64(inlineAttachment.blob)');
    expect(composer).toContain("senderMailboxId: sender.source === 'personal' ? sender.id : undefined");
    expect(composer).toContain('mailboxSource: sender.source');
  });
});

describe('finance delivery names a relationship, never a person', () => {
  it('offers "Send to Finance" and no partner name on the typeset menu', () => {
    const typeset = code(TYPESET);
    expect(typeset).toContain('Send to Finance');
    expect(typeset).toContain('<FinanceRecipientPicker');
    // The defect verbatim: a menu label interpolating whichever contact row
    // came back first.
    expect(typeset).not.toContain('Send to {defaultContact');
    expect(typeset).not.toContain('useFinanceContacts');
  });

  it('offers one Quick Send item on the legacy generator, not a name', () => {
    const generator = code(GENERATOR);
    expect(generator).toContain('Quick Send to Finance');
    expect(generator).not.toContain('Quick Send to {defaultContact');
    expect(generator).not.toContain('useFinanceContacts');
    expect(generator).toContain('<FinanceRecipientPicker');
  });

  it('sends to the partner the picker returned, for both destinations', () => {
    for (const path of [TYPESET, GENERATOR]) {
      const source = code(path);
      expect(source, `${path} still defaults a recipient`).toContain('recipient');
      expect(source).toContain("invokeSecureFunction('share-report-with-finance'");
    }
  });

  it('asks the send function itself which partners are eligible', () => {
    const hook = code('src/hooks/useFinanceReportRecipients.ts');
    expect(hook).toContain("action: 'list_recipients'");
    expect(hook).toContain("invokeSecureFunction('share-report-with-finance'");
    // The client never re-derives eligibility; it renders what it is told.
    expect(hook).not.toContain('finance_portal_client_assignments');
  });

  it('surfaces the assigned partner and never preselects one it would refuse', () => {
    const hook = code('src/hooks/useFinanceReportRecipients.ts');
    expect(hook).toContain('is_assigned_to_client');
    expect(hook).toMatch(/const eligible = recipients\.filter\(\(recipient\) => recipient\.eligible\)/);
    expect(hook).toMatch(/eligible\.find\(\(recipient\) => recipient\.is_assigned_to_client\)/);
  });

  it('states the refusal beside a partner rather than hiding them', () => {
    const picker = code(PICKER);
    expect(picker).toContain('{recipient.blocked_message}');
    // Selectability is decided by `canReceive`, which asks what the delivery
    // actually needs (audit item 12). The rule this test protects — a partner
    // the send would refuse cannot be chosen — is unchanged for the Finance
    // Portal share; see the assertions below.
    expect(picker).toContain('disabled={!canReceive(recipient) || busy}');
    expect(picker).toMatch(/byEmail \? Boolean\(recipient\.email\) : recipient\.eligible/);
  });

  it('does not withhold an email from a partner the PORTAL would refuse', () => {
    // Audit item 12. "Send to Finance -> Compose Email with PDF" used to
    // address the client; it asks who now, through this same picker. But a
    // partner without a Finance Portal account can still be emailed — that is
    // most of the reason to compose one — so portal eligibility must not
    // disable them here, while the refusal itself stays on screen.
    const picker = code(PICKER);
    expect(picker).toMatch(/deliveryMode\?: 'portal' \| 'email'/);
    expect(picker).toContain("deliveryMode = 'portal'");
    expect(picker).toContain("const byEmail = deliveryMode === 'email';");
    expect(picker).toContain('They can still be emailed.');
  });

  it('offers a route out of an empty list instead of a dead end', () => {
    const picker = read(PICKER);
    expect(picker).toContain('No finance partner is currently assigned to this client.');
    expect(picker).toContain('Settings → Finance Agent Contacts');
    expect(picker).toContain('Admin → Finance Portal');
  });

  /**
   * Comments stripped: these files record the defect by name in their headers,
   * which is the point of them. What must not name a partner is the code.
   */
  it('has no named finance partner in any client action surface', () => {
    for (const path of [CARD, COMPOSER, PICKER, TYPESET, GENERATOR]) {
      expect(code(path), `${path} names a finance partner`).not.toMatch(/Graham|Turnbull/i);
    }
  });
});

describe('the eligibility rules have one statement', () => {
  const fn = read('supabase/functions/share-report-with-finance/index.ts');

  it('is the module the picker is answered from and the send is checked by', () => {
    expect(fn).toContain("from \"../_shared/financeReportRecipients.pure.ts\"");
    expect(fn).toContain("action === 'list_recipients'");
    // One call for the listing, one for the send it performs.
    expect((fn.match(/evaluateRecipient\(/g) ?? []).length).toBe(2);
  });

  it('re-checks authority for the listing, not only for the send', () => {
    const listing = fn.slice(fn.indexOf("action === 'list_recipients'"), fn.indexOf('const bytes ='));
    expect(listing).toContain('canShareForClient(');
  });

  it('no longer inlines the conditions it used to duplicate', () => {
    expect(fn).not.toContain('const canViewDocs =');
    expect(fn).not.toContain("'The selected Finance Partner is inactive'");
  });
});
