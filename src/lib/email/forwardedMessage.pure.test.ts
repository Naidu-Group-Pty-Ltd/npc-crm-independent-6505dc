import { describe, expect, it } from 'vitest';
import { buildForwardedHtml, buildForwardedSubject, escapeHtml } from './forwardedMessage.pure';

const source = {
  sender: 'architect_abhi5@yahoo.co.in',
  subject: 'Re: Handover Reschedule - Lot 613',
  received_at: '2026-08-30T11:54:00.000Z',
  to_recipients: ['amol.p@eldersrealestate.com.au', 'admin@npcservices.com.au'],
  cc_recipients: ['rugesh@npcservices.com.au'],
  body: 'Hi Arvin,\nThank you for your positive response.',
  body_html: '<div><p>Hi Arvin,</p><a class="cta" href="https://example.com/book">Book now</a></div>',
};

describe('buildForwardedHtml', () => {
  it('carries the original markup through — the CTAs are the whole point', () => {
    const html = buildForwardedHtml('FYI', source);
    expect(html).toContain('<a class="cta" href="https://example.com/book">Book now</a>');
    expect(html).toContain('---------- Forwarded message ----------');
  });

  it('keeps the operator note, with its line breaks', () => {
    const html = buildForwardedHtml('Please review.\nThanks', source);
    expect(html).toContain('Please review.<br />Thanks');
  });

  it('forwards without a note — a bare forward is a normal thing to do', () => {
    const html = buildForwardedHtml('   ', source);
    expect(html).toContain('Book now');
    expect(html).not.toContain('<div></div>');
  });

  it('names who sent what to whom and when', () => {
    const html = buildForwardedHtml('', source);
    expect(html).toContain('architect_abhi5@yahoo.co.in');
    expect(html).toContain('Re: Handover Reschedule - Lot 613');
    expect(html).toContain('amol.p@eldersrealestate.com.au, admin@npcservices.com.au');
    expect(html).toContain('rugesh@npcservices.com.au');
    expect(html).toContain('2026');
  });

  it('escapes what we compose but not the remote author\'s markup', () => {
    const html = buildForwardedHtml('<script>alert(1)</script>', source);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<a class="cta"');
  });

  it('escapes a plain-text body when no HTML was stored', () => {
    const html = buildForwardedHtml('', { ...source, body_html: null, body: 'a < b & c > d' });
    expect(html).toContain('a &lt; b &amp; c &gt; d');
  });

  it('falls back to the plain body when the stored HTML is blank', () => {
    const html = buildForwardedHtml('', { ...source, body_html: '   ', body: 'plain only' });
    expect(html).toContain('plain only');
  });

  it('omits a Cc row rather than printing an empty one', () => {
    const html = buildForwardedHtml('', { ...source, cc_recipients: [] });
    expect(html).not.toContain('Cc:');
  });

  it('omits the date rather than printing "Invalid Date"', () => {
    const html = buildForwardedHtml('', { ...source, received_at: 'not-a-date' });
    expect(html).not.toContain('Invalid');
    expect(html).not.toContain('Date:');
  });
});

describe('buildForwardedSubject', () => {
  it('adds the prefix once, however many hops', () => {
    expect(buildForwardedSubject('Handover')).toBe('Fwd: Handover');
    expect(buildForwardedSubject('Fwd: Handover')).toBe('Fwd: Handover');
    expect(buildForwardedSubject('FWD: Handover')).toBe('FWD: Handover');
  });

  it('never sends a blank subject', () => {
    expect(buildForwardedSubject(null)).toBe('Fwd: (No Subject)');
    expect(buildForwardedSubject('  ')).toBe('Fwd: (No Subject)');
  });
});

describe('escapeHtml', () => {
  it('covers the five characters that matter', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});
