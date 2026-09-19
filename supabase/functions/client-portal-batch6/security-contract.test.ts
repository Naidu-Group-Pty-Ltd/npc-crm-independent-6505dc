import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('assigned finance partner lookup', () => {
  it('uses schema-backed fields and surfaces query failures', () => {
    const assignedPartnerBranch = functionSource.match(
      /if \(operation === 'assigned_partner'\) \{([\s\S]*?)\n\s{4}if \(operation === 'onboarding_list'\)/,
    )?.[1];

    expect(assignedPartnerBranch).toBeDefined();
    expect(assignedPartnerBranch).toContain(".select('finance_user_id, assigned_at')");
    expect(assignedPartnerBranch).toContain(".order('assigned_at'");
    expect(assignedPartnerBranch).toContain("finance_agent_contacts:finance_contact_id(name)");
    expect(assignedPartnerBranch).toContain('if (assignmentError)');
    expect(assignedPartnerBranch).toContain('if (partnerError)');
    expect(assignedPartnerBranch).not.toContain('created_at');
    expect(assignedPartnerBranch).not.toContain(".select('id, full_name, email')");
  });
});

describe('client onboarding completion replay protection', () => {
  it('notifies finance assignees only after an atomic incomplete-to-complete transition', () => {
    const completionBranch = functionSource.match(
      /if \(operation === 'onboarding_complete'\) \{([\s\S]*?)\n\s{4}if \(operation === 'availability_slots'\)/,
    )?.[1];

    expect(completionBranch).toBeDefined();
    expect(completionBranch).toContain("if (step.status === 'complete') return json({ step });");
    expect(completionBranch).toContain(".eq('id', id).neq('status', 'complete').select().maybeSingle()");

    const concurrencyGuard = completionBranch?.indexOf('if (!data)');
    const notification = completionBranch?.indexOf('await notifyFinancePortalAssignees');
    expect(concurrencyGuard).toBeGreaterThan(-1);
    expect(notification).toBeGreaterThan(concurrencyGuard ?? -1);
  });
});

describe('client booking authorization', () => {
  it('scopes availability and booking creation to an assigned finance partner', () => {
    const availabilityBranch = functionSource.match(
      /if \(operation === 'availability_slots'\) \{([\s\S]*?)\n\s{4}if \(operation === 'booking_create'\)/,
    )?.[1];
    const bookingBranch = functionSource.match(
      /if \(operation === 'booking_create'\) \{([\s\S]*?)\n\s{4}if \(operation === 'bookings_list'\)/,
    )?.[1];

    for (const branch of [availabilityBranch, bookingBranch]) {
      expect(branch).toBeDefined();
      expect(branch).toContain("from('finance_portal_client_assignments')");
      expect(branch).toContain(".eq('client_id', clientId)");
      expect(branch).toContain('if (!assignment)');
    }
  });

  it('validates purchase-file ownership and requires an active offered slot before inserting', () => {
    const bookingBranch = functionSource.match(
      /if \(operation === 'booking_create'\) \{([\s\S]*?)\n\s{4}if \(operation === 'bookings_list'\)/,
    )?.[1];

    expect(bookingBranch).toBeDefined();
    expect(bookingBranch).toContain("from('purchase_files')");
    expect(bookingBranch).toContain(".eq('id', body.purchase_file_id).eq('client_id', clientId)");
    expect(bookingBranch).toContain("from('finance_partner_availability')");
    expect(bookingBranch).toContain(".eq('is_active', true)");
    expect(bookingBranch).toContain('isOfferedSlot(window, start, end)');
    expect(bookingBranch).toContain("return json({ error: 'Invalid booking interval' }, 400)");

    const slotValidation = bookingBranch?.indexOf('isOfferedSlot(window, start, end)');
    const insert = bookingBranch?.indexOf("from('finance_partner_bookings').insert");
    expect(slotValidation).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(slotValidation ?? -1);
  });
});
