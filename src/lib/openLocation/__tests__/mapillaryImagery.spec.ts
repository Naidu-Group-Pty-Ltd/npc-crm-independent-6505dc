/**
 * Mapillary parsing, pinned on the verbatim production refusal
 * [pg_net 248213]: HTTP 500, MLYApiException code 190 — the vendor was
 * reached and named the problem, which is the refusal-is-the-pass reading.
 */
import { describe, expect, it } from 'vitest';
import {
  MAPILLARY_ATTRIBUTION,
  MAPILLARY_TOKEN_ENV,
  buildMapillaryNearbyUrl,
  mapillaryAuthHeaders,
  parseMapillaryRefusal,
  pickNearestMapillaryImage,
} from '../mapillaryImagery.pure.ts';

const MEASURED_REFUSAL = {
  error: {
    message: 'Invalid OAuth 2.0 Access Token',
    type: 'MLYApiException',
    code: 190,
    error_data: {},
    fbtrace_id: 'AbCdEf',
  },
};

describe('parseMapillaryRefusal', () => {
  it('reads the verbatim code-190 refusal as an invalid token', () => {
    expect(parseMapillaryRefusal(MEASURED_REFUSAL)).toEqual({
      refused: true,
      kind: 'invalid_token',
      message: 'Invalid OAuth 2.0 Access Token',
    });
  });

  it('any other error envelope is an api_error, and a clean body is not a refusal', () => {
    expect(parseMapillaryRefusal({ error: { code: 4, message: 'rate limited' } }))
      .toMatchObject({ refused: true, kind: 'api_error' });
    expect(parseMapillaryRefusal({ data: [] })).toEqual({ refused: false });
  });
});

describe('buildMapillaryNearbyUrl and auth', () => {
  it('asks a street-corner bbox with named fields, and keeps the token out of the URL', () => {
    const url = buildMapillaryNearbyUrl(-37.8476934, 144.7007759);
    expect(url).toContain('https://graph.mapillary.com/images?bbox=');
    expect(url).toContain('fields=id,thumb_1024_url,captured_at,computed_geometry');
    expect(url).not.toContain('access_token');
    const bbox = new URL(url).searchParams.get('bbox')!.split(',').map(Number);
    expect(bbox).toHaveLength(4);
    expect(bbox[0]).toBeLessThan(144.7007759); // minLon west of the point
    expect(bbox[3]).toBeGreaterThan(-37.8476934); // maxLat north of it
    // ~±120 m, not a suburb.
    expect(bbox[3] - bbox[1]).toBeLessThan(0.005);
  });

  it('sends the token as an OAuth header', () => {
    expect(mapillaryAuthHeaders('MLY|123|abc')).toEqual({ Authorization: 'OAuth MLY|123|abc' });
    expect(MAPILLARY_TOKEN_ENV).toBe('MAPILLARY_ACCESS_TOKEN');
  });
});

describe('pickNearestMapillaryImage', () => {
  const target = { lat: -37.8476934, lng: 144.7007759 };
  const image = (id: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
    id,
    thumb_1024_url: `https://cdn.example/${id}.jpg`,
    captured_at: 1725840000000, // 2024-09-09 UTC
    computed_geometry: { type: 'Point', coordinates: [lng, lat] },
    ...extra,
  });

  it('chooses the nearest usable image and formats the capture as YYYY-MM', () => {
    const picked = pickNearestMapillaryImage(
      { data: [image('far', target.lat + 0.001, target.lng), image('near', target.lat + 0.0001, target.lng)] },
      target,
    );
    expect(picked?.id).toBe('near');
    expect(picked?.capturedYearMonth).toBe('2024-09');
    expect(picked?.thumbUrl).toContain('near.jpg');
  });

  it('skips entries that cannot be served rather than guessing', () => {
    const picked = pickNearestMapillaryImage(
      {
        data: [
          { id: 'no-thumb', computed_geometry: { coordinates: [target.lng, target.lat] } },
          { id: 'no-geometry', thumb_1024_url: 'https://cdn.example/x.jpg' },
          image('usable', target.lat + 0.0005, target.lng),
        ],
      },
      target,
    );
    expect(picked?.id).toBe('usable');
  });

  it('an empty answer is null — a coverage fact, not a fault', () => {
    expect(pickNearestMapillaryImage({ data: [] }, target)).toBeNull();
    expect(pickNearestMapillaryImage({}, target)).toBeNull();
  });

  it('a missing capture time serves the image with a null date, never an invented one', () => {
    const picked = pickNearestMapillaryImage(
      { data: [image('undated', target.lat, target.lng, { captured_at: undefined })] },
      target,
    );
    expect(picked?.id).toBe('undated');
    expect(picked?.capturedYearMonth).toBeNull();
  });
});

describe('the attribution', () => {
  it('names Mapillary and the CC BY-SA licence', () => {
    expect(MAPILLARY_ATTRIBUTION).toBe('© Mapillary, CC BY-SA 4.0');
  });
});
