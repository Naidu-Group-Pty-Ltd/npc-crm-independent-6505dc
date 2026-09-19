import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildInvestmentReportMeteringParts } from '../investmentReportMeteringKey.ts';

Deno.test('investment report chunks share a metering key within one generation version', async () => {
  const first = await buildInvestmentReportMeteringParts({
    reportId: 'report-1',
    propertyAddress: '123 Alpha Street',
    propertyDetails: { price: 500_000, suburb: 'Example', queryType: 'address' },
    continueFrom: true,
    singleSection: true,
  }, 4);
  const next = await buildInvestmentReportMeteringParts({
    reportId: 'report-1',
    propertyAddress: '123 Alpha Street',
    propertyDetails: { queryType: 'address', suburb: 'Example', price: 500_000 },
    continueFrom: true,
    singleSection: true,
  }, 4);

  assertEquals(first, next);
});

Deno.test('investment report regenerations cannot reuse an earlier reservation', async () => {
  const body = {
    reportId: 'report-1',
    propertyAddress: '123 Alpha Street',
    propertyDetails: { price: 500_000 },
  };

  assertNotEquals(
    await buildInvestmentReportMeteringParts(body, 4),
    await buildInvestmentReportMeteringParts(body, 5),
  );
});

Deno.test('changed report inputs cannot reuse a reservation in the same version', async () => {
  const original = await buildInvestmentReportMeteringParts({
    reportId: 'report-1',
    propertyAddress: '123 Alpha Street',
    propertyDetails: { price: 500_000 },
  }, 4);
  const changed = await buildInvestmentReportMeteringParts({
    reportId: 'report-1',
    propertyAddress: '999 Beta Road',
    propertyDetails: { price: 750_000 },
  }, 4);

  assertNotEquals(original, changed);
});

Deno.test('deeply nested unused report details cannot bypass metering key generation', async () => {
  const propertyDetails: Record<string, unknown> = {};
  let nested = propertyDetails;
  for (let depth = 0; depth < 4_000; depth += 1) {
    const child: Record<string, unknown> = {};
    nested.unused = child;
    nested = child;
  }

  const parts = await buildInvestmentReportMeteringParts({
    reportId: 'report-deep',
    propertyDetails,
  }, 1);

  assertEquals(parts.length, 3);
  assertEquals(parts[0], 'report-deep');
});
