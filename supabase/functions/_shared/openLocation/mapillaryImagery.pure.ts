/**
 * Mapillary street-level imagery — the free Street View.
 *
 * The Graph API is reachable from this egress and answers its own refusal
 * (pg_net 248213, 16 Sep 2026: HTTP 500,
 * `{"error":{"message":"Invalid OAuth 2.0 Access Token","type":"MLYApiException","code":190,…}}`)
 * — the vendor rejecting a bad token is proof the vendor was reached, the
 * same refusal-is-the-pass reading `verification_selftest` uses. Access
 * needs a free client token (`MAPILLARY_ACCESS_TOKEN`, an Integrations
 * card), sent as a header so it never appears in a URL or a log line.
 *
 * Coverage is crowd-photographed, so a suburb street may genuinely have
 * no image: that is `available: false` with the Street View envelope's
 * own `ZERO_RESULTS` status word, which the panel already renders as a
 * coverage gap rather than a fault. Imagery is CC BY-SA 4.0 and the
 * attribution travels in the `copyright` field every consumer already
 * displays.
 */

export const MAPILLARY_GRAPH_BASE = 'https://graph.mapillary.com';
export const MAPILLARY_TOKEN_ENV = 'MAPILLARY_ACCESS_TOKEN';
export const MAPILLARY_ATTRIBUTION = '© Mapillary, CC BY-SA 4.0';

/** Roughly ±120 m — a street-corner window, not a suburb. */
const NEARBY_HALF_WIDTH_DEG = 0.0012;

export function buildMapillaryNearbyUrl(lat: number, lng: number): string {
  const cos = Math.max(0.2, Math.cos(lat * (Math.PI / 180)));
  const dLat = NEARBY_HALF_WIDTH_DEG;
  const dLng = NEARBY_HALF_WIDTH_DEG / cos;
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
    .map((n) => n.toFixed(6))
    .join(',');
  const fields = 'id,thumb_1024_url,captured_at,computed_geometry';
  return `${MAPILLARY_GRAPH_BASE}/images?bbox=${bbox}&fields=${fields}&limit=20`;
}

export function mapillaryAuthHeaders(token: string): Record<string, string> {
  return { Authorization: `OAuth ${token}` };
}

export interface MapillaryImage {
  id: string;
  thumbUrl: string;
  /** 'YYYY-MM', the same shape Google's metadata `date` takes. */
  capturedYearMonth: string | null;
  lat: number;
  lng: number;
}

/**
 * The nearest usable image to the subject, or null for a genuinely empty
 * answer. An entry without a thumb URL or a coordinate cannot be served
 * and is skipped, never guessed at.
 */
export function pickNearestMapillaryImage(
  body: unknown,
  target: { lat: number; lng: number },
): MapillaryImage | null {
  const entries = (body as { data?: unknown })?.data;
  if (!Array.isArray(entries)) return null;
  let best: (MapillaryImage & { d2: number }) | null = null;
  for (const e of entries) {
    const id = typeof e?.id === 'string' ? e.id : null;
    const thumbUrl = typeof e?.thumb_1024_url === 'string' ? e.thumb_1024_url : null;
    const coords = e?.computed_geometry?.coordinates;
    const lng = Number(Array.isArray(coords) ? coords[0] : NaN);
    const lat = Number(Array.isArray(coords) ? coords[1] : NaN);
    if (id === null || thumbUrl === null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const capturedAt = Number(e?.captured_at);
    let capturedYearMonth: string | null = null;
    if (Number.isFinite(capturedAt) && capturedAt > 0) {
      const d = new Date(capturedAt);
      if (Number.isFinite(d.getTime())) {
        capturedYearMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      }
    }
    const d2 = (lat - target.lat) ** 2 + (lng - target.lng) ** 2;
    if (best === null || d2 < best.d2) best = { id, thumbUrl, capturedYearMonth, lat, lng, d2 };
  }
  return best === null ? null : { id: best.id, thumbUrl: best.thumbUrl, capturedYearMonth: best.capturedYearMonth, lat: best.lat, lng: best.lng };
}

export type MapillaryRefusal =
  | { refused: true; kind: 'invalid_token' | 'api_error'; message: string }
  | { refused: false };

/**
 * Did Mapillary refuse the request? Read from the body's own error
 * envelope (`MLYApiException`, code 190 for a bad token), never inferred
 * from the HTTP digit alone — the vendor answers 500 for a refusal it
 * names precisely in the body.
 */
export function parseMapillaryRefusal(body: unknown): MapillaryRefusal {
  const err = (body as { error?: { message?: unknown; type?: unknown; code?: unknown } })?.error;
  if (!err || typeof err !== 'object') return { refused: false };
  const message = typeof err.message === 'string' ? err.message : 'Mapillary refused the request';
  const kind = err.code === 190 ? 'invalid_token' : 'api_error';
  return { refused: true, kind, message };
}
