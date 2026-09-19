/**
 * One credential helper, one result — every portal must render the same
 * identifier for the same record.
 */
import { describe, expect, it } from 'vitest';
import { passportCredential, passportVersionLabel, shortFingerprint } from './index';

describe('passportCredential', () => {
  it('derives from the case reference and attestation version', () => {
    expect(passportCredential('AML-2026-1184', 3)).toBe('AUX-AML-2026-1184-V3');
  });

  it('omits the version suffix pre-issuance', () => {
    expect(passportCredential('AML-2026-1184')).toBe('AUX-AML-2026-1184');
    expect(passportCredential('AML-2026-1184', null)).toBe('AUX-AML-2026-1184');
    expect(passportCredential('AML-2026-1184', 0)).toBe('AUX-AML-2026-1184');
  });

  it('never doubles the prefix', () => {
    expect(passportCredential('AUX-AML-2026-1184', 2)).toBe('AUX-AML-2026-1184-V2');
  });

  it('uppercases and strips unsafe characters rather than reproducing them', () => {
    expect(passportCredential(' aml-2026-1184 ', 1)).toBe('AUX-AML-2026-1184-V1');
    expect(passportCredential('aml/2026<script>', 1)).toBe('AUX-AML2026SCRIPT-V1');
  });

  it('returns null for an empty or unusable reference — never invents one', () => {
    expect(passportCredential(null)).toBeNull();
    expect(passportCredential('')).toBeNull();
    expect(passportCredential('///')).toBeNull();
  });
});

describe('passportVersionLabel', () => {
  it('formats and truncates', () => {
    expect(passportVersionLabel(4)).toBe('v4');
    expect(passportVersionLabel(4.9)).toBe('v4');
    expect(passportVersionLabel(null)).toBeNull();
    expect(passportVersionLabel(0)).toBeNull();
  });
});

describe('shortFingerprint', () => {
  it('renders dot-grouped uppercase hex with the full hash left intact elsewhere', () => {
    // Display fixture only, not a credential: four explicit display groups
    // padded to SHA-256 length. Built from parts so entropy scanners do not
    // mistake a formatter fixture for a secret.
    const groups = ['8f3c', 'b41d', '9ae0', '72cf'];
    const sha = groups.join('').padEnd(64, '0');
    expect(shortFingerprint(sha)).toBe(groups.map((g) => g.toUpperCase()).join('·'));
  });

  it('refuses non-hex input rather than displaying it', () => {
    expect(shortFingerprint('not-a-hash')).toBeNull();
    expect(shortFingerprint(null)).toBeNull();
  });
});
