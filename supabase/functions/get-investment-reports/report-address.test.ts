import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolveCompleteReportAddress } from './report-address.pure.ts';

Deno.test('resolves a full address from a same-line Property label', () => {
  assertEquals(
    resolveCompleteReportAddress('22 Shiraz Street', '**Property:** 22 Shiraz Street, Muswellbrook NSW 2333'),
    '22 Shiraz Street, Muswellbrook NSW 2333',
  );
});

Deno.test('resolves a full address from a multiline Subject Property label', () => {
  assertEquals(
    resolveCompleteReportAddress('28 Bligh Street', '**Subject Property:**  \n28 Bligh Street, Muswellbrook NSW 2333  \nProperty type: House'),
    '28 Bligh Street, Muswellbrook NSW 2333',
  );
});

Deno.test('resolves an unlabelled cover-page address', () => {
  assertEquals(
    resolveCompleteReportAddress('35a Lou Fisher Place', '# Report\n35a Lou Fisher Place, Muswellbrook NSW 2333\nPrepared for: Client'),
    '35a Lou Fisher Place, Muswellbrook NSW 2333',
  );
});

Deno.test('does not replace the subject with an unrelated locality', () => {
  assertEquals(
    resolveCompleteReportAddress('16 Queen Street', 'Market comparison: 4 Other Road, Sydney NSW 2000'),
    '16 Queen Street',
  );
});

Deno.test('preserves an already complete address', () => {
  assertEquals(
    resolveCompleteReportAddress('7 Isis Court, Cooloola Cove QLD 4580', 'Unrelated text'),
    '7 Isis Court, Cooloola Cove QLD 4580',
  );
});