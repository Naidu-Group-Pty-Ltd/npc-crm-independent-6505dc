import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolvePdfDescriptionTier } from './pdfDescriptionTier.pure.ts';

Deno.test('user-authenticated PDF jobs cannot enable picture descriptions', () => {
  assertEquals(resolvePdfDescriptionTier('on', 'session'), 'auto');
  assertEquals(resolvePdfDescriptionTier('premium', 'jwt'), 'auto');
});

Deno.test('service-role PDF jobs may enable picture descriptions', () => {
  assertEquals(resolvePdfDescriptionTier('on', 'service_role'), 'on');
  assertEquals(resolvePdfDescriptionTier('premium', 'service_role'), 'premium');
});

Deno.test('safe tiers and invalid values resolve without enabling descriptions', () => {
  assertEquals(resolvePdfDescriptionTier('off', 'session'), 'off');
  assertEquals(resolvePdfDescriptionTier('auto', 'jwt'), 'auto');
  assertEquals(resolvePdfDescriptionTier('unexpected', 'service_role'), 'auto');
});
