import { describe, expect, it } from 'vitest';
import {
  cleanContactEmail,
  cleanContactPhone,
  describeContactSource,
  isIntakeOperatorEmail,
  resolveContact,
} from '@/lib/listingContact';

describe('cleanContactEmail', () => {
  it('accepts a real address', () => {
    expect(cleanContactEmail('Leanne.Pearman@jelliscraig.com.au')).toBe(
      'leanne.pearman@jelliscraig.com.au',
    );
  });

  it('refuses an address that exists to receive nothing', () => {
    // Worse than offering no action: the user believes they have contacted the
    // agent and nobody has.
    for (const email of [
      'noreply@agency.com.au',
      'no-reply@agency.com.au',
      'donotreply@agency.com.au',
      'bounces@agency.com.au',
      'postmaster@agency.com.au',
      'unsubscribe@agency.com.au',
      'notifications@agency.com.au',
    ]) {
      expect(cleanContactEmail(email), email).toBeNull();
    }
  });

  it('refuses a bulk-send envelope address', () => {
    // A quarter of these listings arrive relayed. The envelope reaches the mail
    // platform, not the agency.
    for (const email of [
      'bounce@u80386.ct.sendgrid.net',
      'reply@mail.mailchimpapp.net',
      'x@socketlabs.vaultre.com.au',
      'noreply@em1234.hubspot.com',
      // The portal's own broadcast platform. This is what a forwarded
      // realcommercial saved-search alert resolves to once the forwarder is
      // stripped off, and `email@` is not an address shape UNREACHABLE catches.
      'email@campaign.realcommercial.com.au',
    ]) {
      expect(cleanContactEmail(email), email).toBeNull();
    }
  });

  it('refuses anything that is not an address', () => {
    for (const value of ['', '  ', 'not an email', 'a@b', null, undefined, 42]) {
      expect(cleanContactEmail(value)).toBeNull();
    }
  });

  it('refuses our own side of the pipeline', () => {
    // Listings arrive forwarded by NPC staff, so the envelope carries a
    // colleague. Offering to email him about his own forward is the bug this
    // guard exists for.
    for (const email of [
      'lavankenobi@gmail.com',
      'naidu.rugesh@gmail.com',
      'property@npcservices.com.au',
      'rugesh@npcservices.com.au',
      'anyone@mail.npcservices.com.au',
    ]) {
      expect(cleanContactEmail(email), email).toBeNull();
    }
  });
});

describe('isIntakeOperatorEmail', () => {
  it('knows ours from theirs', () => {
    expect(isIntakeOperatorEmail('LavanKenobi@Gmail.com')).toBe(true);
    expect(isIntakeOperatorEmail('property@npcservices.com.au')).toBe(true);
    // A different mailbox at an unrelated host that merely ends similarly.
    expect(isIntakeOperatorEmail('agent@notnpcservices.com.au')).toBe(false);
    expect(isIntakeOperatorEmail('scott@shore-property.com.au')).toBe(false);
    expect(isIntakeOperatorEmail(null)).toBe(false);
  });
});

describe('cleanContactPhone', () => {
  it('formats the numbers these listings carry', () => {
    expect(cleanContactPhone('0400947799')).toBe('0400 947 799');
    expect(cleanContactPhone('+61 400 947 799')).toBe('0400 947 799');
    expect(cleanContactPhone('(03) 5472 1000')).toBe('(03) 5472 1000');
  });

  it('returns null for junk', () => {
    for (const value of ['', 'call us', '12', null, undefined]) {
      expect(cleanContactPhone(value)).toBeNull();
    }
  });
});

/**
 * The fallback chain is what makes this action available at all. Only 416
 * records carry `Agent Email`; folding in the agency inbox and the envelope the
 * listing arrived in takes it to 451.
 */
describe('resolveContact', () => {
  it('prefers the agent’s own address', () => {
    const contact = resolveContact({
      agentEmail: 'agent@agency.com.au',
      agencyEmail: 'info@agency.com.au',
      senderEmail: 'sender@agency.com.au',
      agentName: 'A. Agent',
    });
    expect(contact.email).toBe('agent@agency.com.au');
    expect(contact.emailSource).toBe('agent');
    expect(contact.direct).toBe(true);
  });

  it('falls back to the agency inbox', () => {
    const contact = resolveContact({
      agencyEmail: 'info@agency.com.au',
      senderEmail: 'sender@agency.com.au',
    });
    expect(contact.email).toBe('info@agency.com.au');
    expect(contact.emailSource).toBe('agency');
    expect(contact.direct).toBe(false);
  });

  it('falls back to whoever emailed the listing in', () => {
    // Not an "agent" field, but for an agent's own broadcast the sender is the
    // agent — which is why the source is reported alongside it.
    const contact = resolveContact({
      senderEmail: 'leanne@jelliscraig.com.au',
      senderName: 'Leanne Pearman',
    });
    expect(contact.email).toBe('leanne@jelliscraig.com.au');
    expect(contact.emailSource).toBe('sender');
    expect(contact.name).toBe('Leanne Pearman');
    expect(contact.direct).toBe(false);
  });

  it('does not offer the colleague who forwarded the listing in', () => {
    // rec8rDYuNQSk2jMng — "3 Fairmile Close", DiJones Commercial. A forwarded
    // realcommercial alert: no agent address anywhere, and the envelope is the
    // forwarder. The page used to show him as the agent.
    const contact = resolveContact({
      senderEmail: 'lavankenobi@gmail.com',
      senderName: 'Lavan Kenobi',
      agencyName: 'DiJones Commercial',
    });
    expect(contact.email).toBeNull();
    expect(contact.emailSource).toBeNull();
    expect(contact.name).toBeNull();
    expect(contact.agency).toBe('DiJones Commercial');
  });

  it('still reaches the agency when only the envelope is ours', () => {
    // The 46 Waters & Carpenter rows: forwarded by an operator, but the
    // extractor did find the agency inbox. That one is real and stays.
    const contact = resolveContact({
      senderEmail: 'naidu.rugesh@gmail.com',
      senderName: 'Rugesh Naidu',
      agencyEmail: 'sales@waterscarpenter.com.au',
      agencyName: 'First National Real Estate Waters & Carpenter',
    });
    expect(contact.email).toBe('sales@waterscarpenter.com.au');
    expect(contact.emailSource).toBe('agency');
    expect(contact.name).toBeNull();
  });

  it('refuses an internal address even in the agent column', () => {
    // Same mistake one field to the left: a model reading a forwarded chain can
    // report the forwarder as `agent_email`.
    const contact = resolveContact({
      agentEmail: 'property@npcservices.com.au',
      agencyEmail: 'sales@agency.com.au',
    });
    expect(contact.email).toBe('sales@agency.com.au');
    expect(contact.emailSource).toBe('agency');
    expect(contact.direct).toBe(false);
  });

  it('skips an unreachable candidate rather than stopping at it', () => {
    const contact = resolveContact({
      agentEmail: 'noreply@agency.com.au',
      agencyEmail: 'sales@agency.com.au',
    });
    expect(contact.email).toBe('sales@agency.com.au');
    expect(contact.emailSource).toBe('agency');
  });

  it('does not attach the sender’s name to the agency inbox', () => {
    // The envelope name describes whoever pressed send, which is not who
    // answers a general inbox.
    const contact = resolveContact({
      agencyEmail: 'info@agency.com.au',
      senderName: 'Marketing Robot',
    });
    expect(contact.name).toBeNull();
  });

  it('prefers a mobile over a landline', () => {
    const contact = resolveContact({
      agentMobile: '0400 947 799',
      agentPhone: '03 5472 1000',
      agencyPhone: '1300 000 000',
    });
    expect(contact.phone).toBe('0400 947 799');
    expect(contact.phoneSource).toBe('agent');
  });

  it('reports nothing when there is nothing', () => {
    // 990 of 1,441 records are in this state, so it is the common path and the
    // UI has to handle it without pretending otherwise.
    expect(resolveContact({})).toMatchObject({
      email: null,
      emailSource: null,
      phone: null,
      direct: false,
    });
  });

  it('resolves an email and a phone independently', () => {
    const contact = resolveContact({ senderEmail: 'x@agency.com.au', agentMobile: '0400947799' });
    expect(contact.emailSource).toBe('sender');
    expect(contact.phoneSource).toBe('agent');
  });
});

describe('describeContactSource', () => {
  it('explains an inferred address and stays quiet about a direct one', () => {
    expect(describeContactSource('agent')).toBeNull();
    expect(describeContactSource('agency')).toContain('Agency inbox');
    expect(describeContactSource('sender')).toContain('emailed from');
    expect(describeContactSource(null)).toBeNull();
  });
});
