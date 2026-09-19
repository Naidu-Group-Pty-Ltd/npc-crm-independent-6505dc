/**
 * Audit item 28: `synthetic.aml.auditor` and `synthetic.aml.mlro` were offered
 * as attendees on an Outlook invite.
 */
import { describe, expect, it } from 'vitest';

import { isAssignablePerson, isUnroutableAddress } from './assignablePerson.pure';

describe('isAssignablePerson', () => {
  it('hides the seeded compliance accounts that were reported', () => {
    expect(isAssignablePerson({
      username: 'synthetic.aml.auditor',
      email: 'synthetic.aml.auditor@example.invalid',
    })).toBe(false);
    expect(isAssignablePerson({
      username: 'synthetic.aml.mlro',
      email: 'synthetic.aml.mlro@example.invalid',
    })).toBe(false);
  });

  it('keeps real colleagues', () => {
    expect(isAssignablePerson({ username: 'Arvin', email: 'arvin@npcservices.com.au' })).toBe(true);
    expect(isAssignablePerson({ username: 'Rugesh Naidu', email: 'rugesh@npcservices.com.au' })).toBe(true);
  });

  it('keeps a colleague who has no address recorded', () => {
    // Plenty of internal records name someone with no email. Hiding them would
    // take real people out of every assignment list in the product.
    expect(isAssignablePerson({ username: 'Mithruban', email: null })).toBe(true);
    expect(isAssignablePerson({ username: 'Mithruban', email: '' })).toBe(true);
    expect(isAssignablePerson({ username: 'Mithruban' })).toBe(true);
  });

  it('judges the address, so a future seed needs no code change', () => {
    // The rule is RFC 2606 / 6761 reserved domains, not a list of names.
    expect(isAssignablePerson({ username: 'anything', email: 'a@b.invalid' })).toBe(false);
    expect(isAssignablePerson({ username: 'anything', email: 'a@b.test' })).toBe(false);
    expect(isAssignablePerson({ username: 'anything', email: 'someone@example.com' })).toBe(false);
    // A name that merely looks synthetic but is contactable stays.
    expect(isAssignablePerson({ username: 'synthetic.tester', email: 'real@npcservices.com.au' })).toBe(true);
  });
});

describe('isUnroutableAddress', () => {
  it('is case and whitespace insensitive', () => {
    expect(isUnroutableAddress('  SYNTHETIC.AML.MLRO@EXAMPLE.INVALID ')).toBe(true);
  });

  it('does not mistake a real domain for a reserved one', () => {
    expect(isUnroutableAddress('someone@invalid-domain.com.au')).toBe(false);
    expect(isUnroutableAddress('someone@testing.com.au')).toBe(false);
  });
});
