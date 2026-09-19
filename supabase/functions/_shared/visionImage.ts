const VISION_IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/i;

/** Accepts one bounded, inline raster image and rejects remote/provider-fetched URLs. */
export function validateVisionImageDataUrl(value: unknown, maxDecodedBytes: number): { ok: true; dataUrl: string; mimeType: string; decodedBytes: number } | { ok: false; reason: 'invalid' | 'too_large' } {
  if (typeof value !== 'string' || !Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0) {
    return { ok: false, reason: 'invalid' };
  }
  const match = VISION_IMAGE_DATA_URL.exec(value);
  if (!match) return { ok: false, reason: 'invalid' };
  const payload = match[2];
  const decodedBytes = (payload.length * 3) / 4 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  if (decodedBytes > maxDecodedBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, dataUrl: value, mimeType: match[1].toLowerCase(), decodedBytes };
}
