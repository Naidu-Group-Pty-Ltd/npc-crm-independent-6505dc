import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validateVisionImageDataUrl } from '../visionImage.ts';

Deno.test('vision images must be bounded inline raster data URLs', () => {
  assert(validateVisionImageDataUrl('data:image/png;base64,QUFB', 3).ok);
  assert(!validateVisionImageDataUrl('https://example.test/image.png', 10).ok);
  assert(!validateVisionImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 100).ok);
  assert(!validateVisionImageDataUrl('data:image/png;base64,@@@@', 100).ok);
  const oversized = validateVisionImageDataUrl('data:image/jpeg;base64,QUFBQQ==', 3);
  assert(!oversized.ok); assertEquals(oversized.reason, 'too_large');
});
