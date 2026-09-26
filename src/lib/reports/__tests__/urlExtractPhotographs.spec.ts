/**
 * A URL-extract report keeps the listing's own photographs — and only its own —
 * however long the listing's host takes to hand them over.
 *
 * The owner's decision (25 Sep 2026): a report made from a listing link
 * carries the photographs that listing publishes. The extraction names them
 * (`listingPagePhotographs.pure.ts`, pinned in its own spec), a report made
 * from it asks `listing-images` to keep them (`op: 'capture_report'`), and the
 * report broker reads them back for every document in the family.
 *
 * The owner then asked the question these specs exist to answer: what if the
 * photographs are not fetched within the minute the browser waits? Nothing
 * about the photographs depends on that minute. The server writes down what
 * was asked and answers at once, the work runs after the answer, and an
 * attempt that leaves work over is finished by the next document drawn — in
 * the listing's own order, so a lead photograph kept late still leads.
 *
 * And then the rule every one of these answers to: the photographs are of the
 * REPORT's address and property, never chosen to fill a slot. A capture starts
 * only when the address the extraction read is the report's own, and every
 * reader holds the report's address against it again, because a report can
 * be edited after it is made.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  beginCaptureAttempt,
  candidatesToTry,
  CAPTURE_LEASE_MS,
  CAPTURE_MAX_ATTEMPTS,
  CAPTURE_RECORD_NAME,
  CAPTURE_RETRY_AFTER_MS,
  captureFinish,
  captureFolder,
  captureIsFinal,
  captureObjectName,
  capturedPhotographsForReport,
  captureStateOf,
  extractionPhotographSource,
  finishCaptureAttempt,
  heldCapturedPhotographs,
  isLastingRefusal,
  MIN_PRINT_LONG_EDGE_PX,
  newCaptureRecord,
  parseCaptureObjectName,
  parseCaptureRecord,
  photographsAreOfReportAddress,
  placesTakenBefore,
  REPORT_FLOOR_PLAN_LIMIT,
  REPORT_PHOTOGRAPH_CAPTURE_PREFIX,
  REPORT_PHOTOGRAPH_LIMIT,
  type CapturedPhotograph,
  type CaptureFinish,
  type CaptureRecord,
} from '../../../../supabase/functions/_shared/reportPhotographs.pure';
import {
  CAPTURE_START_RETRY_DELAYS_MS,
  isRetryableCaptureFailure,
  namedPhotographCount,
  photographCaptureRequest,
  photographResumeRequest,
  PHOTOGRAPH_RESUME_TIMEOUT_MS,
  readPhotographCapture,
  startPhotographCapture,
  type CaptureTransportError,
  type PhotographCaptureRequest,
} from '../urlExtractPhotographs';

const REPORT = '60f205f9-3c1e-4d2a-9b7f-0a1b2c3d4e5f';
const JOB = '0b8c1a52-7d4e-4f3a-9c2b-1e5d6f7a8b9c';
const AUTHOR = 'b2d1c0e9-8f7a-4b6c-9d5e-4f3a2b1c0d9e';
const T0 = Date.parse('2026-09-25T13:00:00.000Z');
/** The address the extraction read, and the report made from it. */
const SOURCE = { address: '60 Lawley Street', suburb: 'Spalding' };

const hex = (seed: number) => seed.toString(16).padStart(16, '0');

function name(place: number, width = 1920, height = 1280, checksum = hex(0xc0 + place), signature = hex(0x5e0 + place)) {
  return captureObjectName({ place, width, height, checksum, signature, contentType: 'image/jpeg' });
}

function photo(place: number, overrides: Partial<CapturedPhotograph> = {}): CapturedPhotograph {
  const parsed = parseCaptureObjectName(name(place));
  if (!parsed) throw new Error('fixture must name');
  return { ...parsed, ...overrides };
}

const candidateUrls = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://i2.au.reastatic.net/2000x2000-fit/${hex(i).repeat(4)}/image.jpg`);

describe('the object name carries everything a reader needs, so there is no table to keep in step', () => {
  it('names one folder a report, and nothing that is not a report id', () => {
    expect(captureFolder(REPORT)).toBe(`${REPORT_PHOTOGRAPH_CAPTURE_PREFIX}/${REPORT}`);
    expect(captureFolder(` ${REPORT.toUpperCase()} `)).toBe(`${REPORT_PHOTOGRAPH_CAPTURE_PREFIX}/${REPORT}`);
    for (const bad of ['', 'recAbCdEfGhIjKlMn', '../listing', `${REPORT}/..`, null, undefined, 42]) {
      expect(captureFolder(bad)).toBeNull();
    }
  });

  it('round-trips place, size, checksum and signature through the name', () => {
    const named = captureObjectName({
      place: 3, width: 1920, height: 1280, checksum: 'A3F1C09E5B7D2468'.padEnd(64, '0'), signature: 'ff00ff00ff00ff00', contentType: 'image/jpeg',
    });
    expect(named).toBe('03-1920x1280-a3f1c09e5b7d2468-ff00ff00ff00ff00.jpg');
    expect(parseCaptureObjectName(named)).toEqual({
      name: named, place: 3, width: 1920, height: 1280, checksum: 'a3f1c09e5b7d2468', signature: 'ff00ff00ff00ff00',
    });
    expect(captureObjectName({ place: 0, width: 1600, height: 1067, checksum: hex(1), signature: hex(2), contentType: 'IMAGE/PNG' }))
      .toBe(`00-1600x1067-${hex(1)}-${hex(2)}.png`);
  });

  it('refuses to name what it cannot describe', () => {
    const base = { place: 0, width: 1920, height: 1280, checksum: hex(1), signature: hex(2), contentType: 'image/jpeg' };
    for (const bad of [
      { contentType: 'image/gif' },
      { contentType: '' },
      { checksum: 'not-a-hash' },
      { checksum: 'abc123' },
      { signature: 'abc' },
      { signature: 'zz00ff00ff00ff00' },
      { place: -1 },
      { place: 100 },
      { place: 1.5 },
      { width: 9 },
      { height: 100_000 },
    ]) {
      expect(captureObjectName({ ...base, ...bad })).toBeNull();
    }
  });

  it('reads nothing it did not write — including the record beside the photographs', () => {
    for (const foreign of [
      'photo.jpg',
      CAPTURE_RECORD_NAME,
      '03-1920x1280-a3f1c09e5b7d2468.jpg',
      `03-1920x1280-${hex(1)}-${hex(2)}.gif`,
      `3-1920x1280-${hex(1)}-${hex(2)}.jpg`,
      `../03-1920x1280-${hex(1)}-${hex(2)}.jpg`,
      '.emptyFolderPlaceholder',
      null,
      undefined,
      7,
    ]) {
      expect(parseCaptureObjectName(foreign)).toBeNull();
    }
  });
});

describe('a report reads its captured photographs in the listing\'s order, one copy each, only what could print', () => {
  it('orders by place, whatever order storage lists them in', () => {
    const chosen = capturedPhotographsForReport([{ name: name(7) }, { name: name(0) }, { name: name(2, 1280, 1920) }]);
    expect(chosen.map((p) => p.place)).toEqual([0, 2, 7]);
    expect(chosen[1]).toMatchObject({ width: 1280, height: 1920 });
  });

  it('holds one photograph a place and one a checksum, however the folder came to hold more', () => {
    const held = heldCapturedPhotographs([
      { name: name(1) },
      { name: name(1, 1920, 1280, hex(0x999)) },
      { name: name(4, 1920, 1280, hex(0xc0 + 1)) },
      { name: CAPTURE_RECORD_NAME },
    ]);
    expect(held.map((p) => p.place)).toEqual([1]);
  });

  it('applies the print floor again on the way out', () => {
    const below = MIN_PRINT_LONG_EDGE_PX - 1;
    const chosen = capturedPhotographsForReport([{ name: name(0, below, 600) }, { name: name(1, MIN_PRINT_LONG_EDGE_PX, 600) }]);
    expect(chosen.map((p) => p.place)).toEqual([1]);
  });

  it('keeps the report limit, lead first, and is empty rather than an error', () => {
    const many = Array.from({ length: REPORT_PHOTOGRAPH_LIMIT + 3 }, (_, i) => ({ name: name(i) }));
    expect(capturedPhotographsForReport(many)).toHaveLength(REPORT_PHOTOGRAPH_LIMIT);
    expect(capturedPhotographsForReport(many)[0].place).toBe(0);
    expect(capturedPhotographsForReport(null)).toEqual([]);
    expect(capturedPhotographsForReport([])).toEqual([]);
    expect(capturedPhotographsForReport(many, 0)).toEqual([]);
  });
});

describe('rule 4: the photographs are of the report\'s own address, and nothing is chosen to fill a slot', () => {
  const REPORT_ADDRESS = '60 Lawley Street, Spalding WA 6530';

  it('holds the same property however the address was typed', () => {
    for (const typed of [
      REPORT_ADDRESS,
      '60 LAWLEY ST, SPALDING WA 6530',
      '60 Lawley St Spalding',
      '60 Lawley Street, Spalding, Western Australia',
    ]) {
      expect(photographsAreOfReportAddress(typed, SOURCE), typed).toBe(true);
    }
    // The extraction may carry the whole line rather than the street alone.
    expect(photographsAreOfReportAddress(REPORT_ADDRESS, { address: '60 Lawley St, Spalding WA 6530', suburb: 'Spalding' })).toBe(true);
  });

  it('refuses another house: a different number, street or suburb', () => {
    for (const other of [
      '62 Lawley Street, Spalding WA 6530',
      '60 Lawley Road, Spalding WA 6530',
      '60 Lawley Street, Geraldton WA 6530',
      '60 Lowley Street, Spalding WA 6530',
    ]) {
      expect(photographsAreOfReportAddress(other, SOURCE), other).toBe(false);
    }
  });

  it('refuses one dwelling of a building for the building, and the building for one dwelling', () => {
    expect(photographsAreOfReportAddress('5/60 Lawley Street, Spalding WA 6530', SOURCE)).toBe(false);
    expect(photographsAreOfReportAddress(REPORT_ADDRESS, { address: '5/60 Lawley Street', suburb: 'Spalding' })).toBe(false);
    expect(photographsAreOfReportAddress('Unit 5, 60 Lawley Street, Spalding', { address: '5/60 Lawley Street', suburb: 'Spalding' })).toBe(true);
    expect(photographsAreOfReportAddress('4/60 Lawley Street, Spalding', { address: '5/60 Lawley Street', suburb: 'Spalding' })).toBe(false);
  });

  it('refuses whatever cannot be verified as one property: a lot, a suburb, a street with no suburb', () => {
    // A lot is not a street number, so a lot-only address cannot be verified.
    expect(photographsAreOfReportAddress('Lot 12 Hunza Road, Truganina VIC 3029', { address: 'Lot 12 Hunza Road', suburb: 'Truganina' })).toBe(false);
    expect(photographsAreOfReportAddress('Spalding WA 6530', SOURCE)).toBe(false);
    expect(photographsAreOfReportAddress('60 Lawley Street', SOURCE)).toBe(false);
    expect(photographsAreOfReportAddress(REPORT_ADDRESS, { address: '60 Lawley Street', suburb: '' })).toBe(false);
    expect(photographsAreOfReportAddress(REPORT_ADDRESS, { address: 'Lawley Street', suburb: 'Spalding' })).toBe(false);
    expect(photographsAreOfReportAddress(REPORT_ADDRESS, null)).toBe(false);
    expect(photographsAreOfReportAddress(null, SOURCE)).toBe(false);
    expect(photographsAreOfReportAddress(42, SOURCE)).toBe(false);
  });

  it('reads the address the extraction stored on its job, and nothing it did not state', () => {
    expect(extractionPhotographSource({ extractedDetails: { extractedAddress: ' 60 Lawley Street ', extractedSuburb: 'Spalding' } }))
      .toEqual(SOURCE);
    expect(extractionPhotographSource({ extractedDetails: { extractedAddress: '60 Lawley Street' } })).toBeNull();
    expect(extractionPhotographSource({ extractedDetails: { extractedSuburb: 'Spalding' } })).toBeNull();
    expect(extractionPhotographSource({ extractedDetails: 'x' })).toBeNull();
    expect(extractionPhotographSource(null)).toBeNull();
    expect(extractionPhotographSource([])).toBeNull();
  });
});

describe('the capture writes down what was asked, so any later request can finish it', () => {
  const fresh = () => newCaptureRecord({ scrapeJobId: JOB.toUpperCase(), requestedBy: AUTHOR, now: T0, source: SOURCE });

  it('round-trips through its own JSON, and refuses what is not a record', () => {
    const record = beginCaptureAttempt(fresh(), T0);
    expect(record.scrapeJobId).toBe(JOB);
    expect(parseCaptureRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    for (const bad of [
      null, 'x', [], {}, { ...record, version: 2 }, { ...record, scrapeJobId: 'job-1' }, { ...record, requestedBy: ' ' },
      { ...record, requestedAt: 'yesterday' }, { ...record, attempts: -1 }, { ...record, attempts: 1.5 },
      // A record that cannot say whose address its photographs are of.
      { ...record, source: undefined }, { ...record, source: { address: '60 Lawley Street' } },
      { ...record, source: { address: ' ', suburb: 'Spalding' } }, { ...record, source: 'Spalding' },
    ]) {
      expect(parseCaptureRecord(bad)).toBeNull();
    }
    const odd = parseCaptureRecord({ ...record, settled: ['a', 7, 'a'], refused: { x: 2, y: 'z', w: 0 }, finished: { at: 'no', reason: 'limit' } });
    expect(odd).toMatchObject({ settled: ['a'], refused: { x: 2 }, finished: null });
  });

  it('says where it stands at any moment', () => {
    expect(captureStateOf(null, T0)).toBe('none');
    const begun = beginCaptureAttempt(fresh(), T0);
    expect(begun.attempts).toBe(1);
    expect(captureStateOf(begun, T0 + 1_000)).toBe('running');
    // An attempt whose worker ended without saying so frees the capture when its lease lapses.
    expect(captureStateOf(begun, T0 + CAPTURE_LEASE_MS + 1)).toBe('pending');
    const leftOver = { ...begun, leaseUntil: null };
    expect(captureStateOf(leftOver, T0 + 1_000)).toBe('waiting');
    expect(captureStateOf(leftOver, T0 + CAPTURE_RETRY_AFTER_MS)).toBe('pending');
    expect(captureStateOf({ ...leftOver, finished: { at: new Date(T0).toISOString(), reason: 'limit' } }, T0)).toBe('complete');
  });

  it('holds a capture longer than any attempt can run, and asks again only after a pause', () => {
    // The longest attempt: a 20 s allowance, then one candidate's two fetches at 10 s each, then uploads.
    expect(CAPTURE_LEASE_MS).toBeGreaterThan(20_000 + 2 * 10_000 + 30_000);
    expect(CAPTURE_RETRY_AFTER_MS).toBeGreaterThanOrEqual(30_000);
    expect(CAPTURE_MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(CAPTURE_MAX_ATTEMPTS).toBeLessThanOrEqual(6);
  });
});

describe('a refusal another attempt cannot change is final; one it can is not', () => {
  it('passes what a host that did not answer, or time that ran out, explains', () => {
    for (const passing of ['fetch_failed', 'http_500', 'http_502', 'http_503', 'http_504', 'http_408', 'http_425', 'http_429', 'out_of_time', 'deferred', 'unanalysed', 'upload_failed', 'something_new']) {
      expect(isLastingRefusal(passing)).toBe(false);
    }
  });

  it('settles what the picture itself, or its host, has decided', () => {
    for (const lasting of ['http_404', 'http_403', 'http_410', 'page_furniture', 'blocked_url', 'unsupported_type', 'too_large', 'too_small', 'not_a_photograph', 'unreadable', 'below_print_floor', 'duplicate', 'floorplan', 'graphic', 'undecodable', 'unnameable']) {
      expect(isLastingRefusal(lasting)).toBe(true);
    }
  });
});

describe('an attempt tries what is undecided, in the listing\'s order, until the first places are taken', () => {
  const urls = candidateUrls(10);

  it('counts the places taken ahead of a candidate', () => {
    expect(placesTakenBefore([0, 2, 5], 3)).toBe(2);
    expect(placesTakenBefore([], 9)).toBe(0);
  });

  it('skips what is kept or settled, and stops where the first places are already taken', () => {
    const held = [photo(0), photo(2)];
    expect(candidatesToTry(urls, new Set([urls[1]]), held)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    const six = [0, 1, 2, 3, 4, 5].map((p) => photo(p));
    expect(candidatesToTry(urls, new Set(), six)).toEqual([]);
    const sixWithAGap = [0, 2, 3, 4, 5, 6].map((p) => photo(p));
    expect(candidatesToTry(urls, new Set(), sixWithAGap)).toEqual([1]);
  });

  it('is final only once nothing ahead of the last kept place could still displace it', () => {
    const sixWithAGap = [0, 2, 3, 4, 5, 6].map((p) => photo(p));
    expect(captureIsFinal(urls, new Set(), sixWithAGap)).toBeNull();
    expect(captureIsFinal(urls, new Set([urls[1]]), sixWithAGap)).toBe('limit');
    expect(captureIsFinal(urls.slice(0, 2), new Set(urls.slice(0, 2)), [])).toBe('exhausted');
    expect(captureIsFinal(urls, new Set(urls.slice(1)), [])).toBeNull();
  });
});

describe('what an owner asked: the photographs are not fetched in the browser\'s minute', () => {
  /*
   * Drives the capture's decisions over several attempts against a scripted
   * host, the way `listing-images` does: try `candidatesToTry` in order, keep
   * a photograph at its own place, settle lasting refusals, then let
   * `finishCaptureAttempt` decide whether anything is left.
   */
  type Script = (url: string, attempt: number) => 'photo' | 'floorplan' | 'http_503' | 'http_404' | 'fetch_failed';

  function simulate(urls: string[], script: Script, maxRequests = 10) {
    let record: CaptureRecord = newCaptureRecord({ scrapeJobId: JOB, requestedBy: AUTHOR, now: T0, source: SOURCE });
    let held: CapturedPhotograph[] = [];
    let now = T0;
    const timeline: Array<{ attempt: number; kept: number[]; state: string }> = [];
    for (let request = 0; request < maxRequests; request += 1) {
      const state = captureStateOf(record, now);
      if (state === 'complete') break;
      if (state === 'running' || state === 'waiting') { now += CAPTURE_RETRY_AFTER_MS; continue; }
      const begun = beginCaptureAttempt(record, now);
      const settledNow: string[] = [];
      const refusalsNow: string[] = [];
      const keptNow: number[] = [];
      const places = new Set(held.map((p) => p.place));
      for (const place of candidatesToTry(urls, new Set(record.settled), held)) {
        if (placesTakenBefore(places, place) >= REPORT_PHOTOGRAPH_LIMIT) break;
        const verdict = script(urls[place], begun.attempts);
        if (verdict === 'photo') {
          held = [...held, photo(place)];
          places.add(place);
          keptNow.push(place);
          settledNow.push(urls[place]);
        } else {
          refusalsNow.push(verdict);
          if (isLastingRefusal(verdict)) settledNow.push(urls[place]);
        }
      }
      record = finishCaptureAttempt(begun, { now: now + 5_000, candidates: urls, settledNow, refusalsNow, held });
      timeline.push({ attempt: begun.attempts, kept: keptNow, state: captureStateOf(record, now + 5_000) });
      now += CAPTURE_RETRY_AFTER_MS + 5_000;
    }
    return { record, held, timeline, reader: capturedPhotographsForReport(held.map((p) => ({ name: p.name }))) };
  }

  it('keeps the lead photograph on the cover when its host did not answer the first time', () => {
    const urls = candidateUrls(9);
    const { record, reader, timeline } = simulate(urls, (url, attempt) => (url === urls[0] && attempt === 1 ? 'http_503' : 'photo'));
    // The first attempt keeps six others; the capture is NOT final, because the lead is undecided.
    expect(timeline[0]).toEqual({ attempt: 1, kept: [1, 2, 3, 4, 5, 6], state: 'waiting' });
    // The next request keeps the lead, and the capture is final.
    expect(timeline[1]).toEqual({ attempt: 2, kept: [0], state: 'complete' });
    expect(record.finished?.reason).toBe('limit');
    // What a document reads: the listing's own first six, in order.
    expect(reader.map((p) => p.place)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('finishes with what it has once the host has been given every attempt', () => {
    const urls = candidateUrls(3);
    const { record, reader, timeline } = simulate(urls, (url) => (url === urls[1] ? 'fetch_failed' : 'photo'));
    expect(timeline).toHaveLength(CAPTURE_MAX_ATTEMPTS);
    expect(record.finished?.reason).toBe('attempts');
    expect(record.refused.fetch_failed).toBe(CAPTURE_MAX_ATTEMPTS);
    expect(reader.map((p) => p.place)).toEqual([0, 2]);
  });

  it('never asks again about a picture that is not a photograph, or one its host has removed', () => {
    const urls = candidateUrls(4);
    const { record, reader, timeline } = simulate(urls, (url) => (url === urls[1] ? 'floorplan' : url === urls[2] ? 'http_404' : 'photo'));
    expect(timeline).toHaveLength(1);
    expect(record.finished?.reason).toBe('exhausted');
    expect(reader.map((p) => p.place)).toEqual([0, 3]);
  });

  it('finishes at once, with nothing, where the extraction named nothing', () => {
    const begun = beginCaptureAttempt(newCaptureRecord({ scrapeJobId: JOB, requestedBy: AUTHOR, now: T0, source: SOURCE }), T0);
    const done = finishCaptureAttempt(begun, { now: T0, candidates: [], settledNow: [], refusalsNow: [], held: [] });
    expect(done.finished?.reason).toBe('no_candidates');
    expect(done.leaseUntil).toBeNull();
  });
});

/*
 * The listing's floor plans ride the same capture (the owner, 25 Sep 2026):
 * the same record, the same address check, the same attempts, in a list of
 * their own. The rule these pin is that adding a list changed nothing about
 * the one that was there: with no plans named, every answer is the
 * photographs' own.
 */
describe('a listing\'s floor plans ride the same capture, in a list of their own', () => {
  const plan = (place: number) => photo(place, { name: name(place, 1600, 1200, hex(0xf0 + place), hex(0x7a0 + place)) as string });
  const planUrls = (n: number) =>
    Array.from({ length: n }, (_, i) => `https://i2.au.reastatic.net/2000x2000-fit/${hex(0x90 + i).repeat(4)}/image.jpg`);
  const list = (candidates: string[], settled: string[] = [], held: CapturedPhotograph[] = []) =>
    ({ candidates, settled: new Set(settled), held });

  it('reads a record written before plans were read as one that asks for none, and writes the plans down', () => {
    const fresh = newCaptureRecord({ scrapeJobId: JOB, requestedBy: AUTHOR, now: T0, source: SOURCE });
    expect(fresh.plans).toEqual({ settled: [], refused: {} });
    const legacy = JSON.parse(JSON.stringify(fresh));
    delete legacy.plans;
    expect(parseCaptureRecord(legacy)?.plans).toEqual({ settled: [], refused: {} });
    const withPlans = { ...fresh, plans: { settled: ['p', 7, 'p'], refused: { photo: 1, bad: 'x' } } };
    expect(parseCaptureRecord(withPlans)?.plans).toEqual({ settled: ['p'], refused: { photo: 1 } });
  });

  it('with no plans named, every answer is exactly the photographs\' own', () => {
    const urls = candidateUrls(8);
    const cases: Array<[string[], string[], CapturedPhotograph[], number]> = [
      [[], [], [], 0],
      [urls, [], [0, 1, 2, 3, 4, 5].map((p) => photo(p)), 1],
      [urls, [], [0, 2, 3, 4, 5, 6].map((p) => photo(p)), 1],
      [urls.slice(0, 2), urls.slice(0, 2), [], 1],
      [urls, urls.slice(1), [], 2],
      [urls, urls.slice(1), [], CAPTURE_MAX_ATTEMPTS],
    ];
    for (const [candidates, settled, held, attempts] of cases) {
      const before: CaptureFinish | null = candidates.length === 0
        ? 'no_candidates'
        : captureIsFinal(candidates, new Set(settled), held) ?? (attempts >= CAPTURE_MAX_ATTEMPTS ? 'attempts' : null);
      expect(captureFinish({ photographs: list(candidates, settled, held) }, attempts)).toBe(before);
      expect(captureFinish({ photographs: list(candidates, settled, held), plans: list([]) }, attempts)).toBe(before);
    }
  });

  it('is finished only when both lists are, and says why', () => {
    const urls = candidateUrls(3);
    const plans = planUrls(3);
    const photosDone = list(urls, urls, []);
    // The photographs are settled and a plan is undecided: not finished, until the attempts are spent.
    expect(captureFinish({ photographs: photosDone, plans: list(plans) }, 1)).toBeNull();
    expect(captureFinish({ photographs: photosDone, plans: list(plans) }, CAPTURE_MAX_ATTEMPTS)).toBe('attempts');
    // Plans alone, at their own limit: the first two places taken.
    expect(captureFinish({ photographs: list([]), plans: list(plans, [], [plan(0), plan(1)]) }, 1)).toBe('limit');
    expect(REPORT_FLOOR_PLAN_LIMIT).toBe(2);
    // Either list running out makes the whole `exhausted`.
    expect(captureFinish({ photographs: photosDone, plans: list(plans, [], [plan(0), plan(1)]) }, 1)).toBe('exhausted');
    expect(captureFinish({ photographs: list([]), plans: list(plans, plans, []) }, 1)).toBe('exhausted');
    expect(captureFinish({ photographs: list([]), plans: list([]) }, 1)).toBe('no_candidates');
  });

  it('settles each list apart: one asset in both lists is refused as a photograph and still tried as a plan', () => {
    const shared = planUrls(1)[0];
    const begun = beginCaptureAttempt(newCaptureRecord({ scrapeJobId: JOB, requestedBy: AUTHOR, now: T0, source: SOURCE }), T0);
    const done = finishCaptureAttempt(begun, {
      now: T0,
      candidates: [shared],
      settledNow: [shared],
      refusalsNow: ['floorplan'],
      held: [],
      plans: { candidates: [shared], settledNow: [], refusalsNow: ['out_of_time'], held: [] },
    });
    expect(done.settled).toEqual([shared]);
    expect(done.plans).toEqual({ settled: [], refused: { out_of_time: 1 } });
    expect(done.refused).toEqual({ floorplan: 1 });
    // The plan is still owed, so the capture is not finished.
    expect(done.finished).toBeNull();
  });

  it('settles a plan whose pixels read as a photograph: that verdict does not change', () => {
    expect(isLastingRefusal('photo')).toBe(true);
  });

  it('keeps the photographs and the plans across attempts, and finishes once both are decided', () => {
    // Attempt 1: every photograph kept; the plans' host does not answer.
    // Attempt 2: the ground floor and the upper floor are kept; the third plan is never needed.
    const urls = candidateUrls(2);
    const plans = planUrls(3);
    let record: CaptureRecord = newCaptureRecord({ scrapeJobId: JOB, requestedBy: AUTHOR, now: T0, source: SOURCE });
    const first = beginCaptureAttempt(record, T0);
    record = finishCaptureAttempt(first, {
      now: T0 + 5_000,
      candidates: urls,
      settledNow: urls,
      refusalsNow: [],
      held: [photo(0), photo(1)],
      plans: { candidates: plans, settledNow: [], refusalsNow: ['http_503', 'http_503', 'http_503'], held: [] },
    });
    expect(captureStateOf(record, T0 + 5_000)).toBe('waiting');
    expect(captureStateOf(record, T0 + 5_000 + CAPTURE_RETRY_AFTER_MS)).toBe('pending');
    const second = beginCaptureAttempt(record, T0 + 5_000 + CAPTURE_RETRY_AFTER_MS);
    record = finishCaptureAttempt(second, {
      now: T0 + 10_000 + CAPTURE_RETRY_AFTER_MS,
      candidates: urls,
      settledNow: [],
      refusalsNow: [],
      held: [photo(0), photo(1)],
      plans: { candidates: plans, settledNow: plans.slice(0, 2), refusalsNow: [], held: [plan(0), plan(1)] },
    });
    expect(record.finished?.reason).toBe('exhausted');
    expect(record.plans.refused).toEqual({ http_503: 3 });
    // A reader takes the plans in the page's order, lead first, up to the plans' limit.
    expect(capturedPhotographsForReport([plan(1), plan(0)].map((p) => ({ name: p.name })), REPORT_FLOOR_PLAN_LIMIT)
      .map((p) => p.place)).toEqual([0, 1]);
  });
});

describe('the browser asks once, again only when the ask did not land, and never waits on it', () => {
  const request: PhotographCaptureRequest = { op: 'capture_report', reportId: REPORT, scrapeJobId: JOB };
  const noSleep = async () => undefined;

  it('counts what a finished extraction named, and nothing from a result that names none', () => {
    expect(namedPhotographCount({ photographs: { candidates: [{}, {}, {}] } })).toBe(3);
    // Its floor plans are kept by the same capture, so a page that names a
    // plan and no photograph still has something to ask for.
    expect(namedPhotographCount({ photographs: { candidates: [{}, {}], floorPlans: [{}] } })).toBe(3);
    expect(namedPhotographCount({ photographs: { candidates: [], floorPlans: [{}] } })).toBe(1);
    for (const none of [
      null, undefined, {}, { photographs: null }, { photographs: { candidates: 'x' } },
      { photographs: { candidates: [], floorPlans: 'x' } },
    ]) {
      expect(namedPhotographCount(none)).toBe(0);
    }
  });

  it('builds the start from the new report and the job it was made from, and nothing where there is nothing to keep', () => {
    expect(photographCaptureRequest(REPORT, { scrapeJobId: ` ${JOB} `, photographCount: 4 })).toEqual(request);
    expect(photographCaptureRequest(REPORT, { scrapeJobId: JOB, photographCount: 0 })).toBeNull();
    expect(photographCaptureRequest(REPORT, { scrapeJobId: JOB })).toBeNull();
    expect(photographCaptureRequest(REPORT, { scrapeJobId: '', photographCount: 4 })).toBeNull();
    expect(photographCaptureRequest(REPORT, null)).toBeNull();
    expect(photographCaptureRequest(null, { scrapeJobId: JOB, photographCount: 4 })).toBeNull();
  });

  it('retries a failure a second try can cure, and never a refusal', () => {
    expect(isRetryableCaptureFailure({ network: true })).toBe(true);
    expect(isRetryableCaptureFailure({ status: 503 })).toBe(true);
    expect(isRetryableCaptureFailure({ status: 429 })).toBe(true);
    for (const refusal of [400, 401, 403, 404, 409]) expect(isRetryableCaptureFailure({ status: refusal })).toBe(false);
    expect(isRetryableCaptureFailure(null)).toBe(false);
  });

  it('sends the ask again after a platform error, and stops once it lands', async () => {
    const answers: Array<CaptureTransportError | null> = [{ status: 503 }, null];
    const calls: PhotographCaptureRequest[] = [];
    const waited: number[] = [];
    const outcome = await startPhotographCapture(async (sent) => {
      calls.push(sent);
      return { error: answers[calls.length - 1] ?? null };
    }, request, { sleep: async (ms) => { waited.push(ms); } });
    expect(outcome).toEqual({ ok: true, tries: 2 });
    expect(calls).toEqual([request, request]);
    expect(waited).toEqual([CAPTURE_START_RETRY_DELAYS_MS[0]]);
  });

  it('gives up after the last delay, and does not repeat a refusal', async () => {
    let tries = 0;
    const down = await startPhotographCapture(async () => { tries += 1; return { error: { network: true, message: 'down' } }; }, request, { sleep: noSleep });
    expect(down).toEqual({ ok: false, tries: CAPTURE_START_RETRY_DELAYS_MS.length + 1, error: 'down' });
    expect(tries).toBe(CAPTURE_START_RETRY_DELAYS_MS.length + 1);

    let refusedTries = 0;
    const refused = await startPhotographCapture(async () => { refusedTries += 1; return { error: { status: 403, message: 'not_the_author' } }; }, request, { sleep: noSleep });
    expect(refused).toEqual({ ok: false, tries: 1, error: 'not_the_author' });
    expect(refusedTries).toBe(1);
  });

  it('never throws, even when the transport does', async () => {
    const outcome = await startPhotographCapture(async () => { throw new Error('boom'); }, request, { delaysMs: [], sleep: noSleep });
    expect(outcome).toEqual({ ok: false, tries: 1, error: 'boom' });
  });
});

describe('a document finishes a capture with work left over before it is drawn, and only then', () => {
  it('reads the broker\'s statement of where the capture stands, and nothing it does not recognise', () => {
    expect(readPhotographCapture({ photographCapture: { state: 'pending', reportId: ` ${REPORT} ` } })).toEqual({ state: 'pending', reportId: REPORT });
    for (const bad of [null, {}, { photographCapture: null }, { photographCapture: { state: 'maybe', reportId: REPORT } }, { photographCapture: { state: 'pending' } }]) {
      expect(readPhotographCapture(bad)).toBeNull();
    }
  });

  it('asks for the rest, and waits, only when work is left over and may be asked for', () => {
    expect(photographResumeRequest({ state: 'pending', reportId: REPORT })).toEqual({ op: 'capture_report', reportId: REPORT, wait: true });
    for (const state of ['none', 'complete', 'running', 'waiting'] as const) {
      expect(photographResumeRequest({ state, reportId: REPORT })).toBeNull();
    }
    expect(photographResumeRequest(null)).toBeNull();
  });

  it('waits less than the transport allows, and longer than the server\'s own attempt', () => {
    expect(PHOTOGRAPH_RESUME_TIMEOUT_MS).toBeLessThan(60_000);
    expect(PHOTOGRAPH_RESUME_TIMEOUT_MS).toBeGreaterThan(15_000 + 2 * 10_000);
  });
});

describe('listing-images keeps them for the report\'s author, and only what it has seen to be a photograph', () => {
  const source = readFileSync('supabase/functions/listing-images/index.ts', 'utf8');
  const section = source.slice(
    source.indexOf("/* A URL-extract report's photographs, captured from its listing page"),
    source.indexOf('/* Handler'),
  );
  const capture = section.slice(section.indexOf('async function captureReportPhotographs('));
  const attempt = section.slice(section.indexOf('async function runCaptureAttempt('), section.indexOf('async function captureReportPhotographs('));
  const branch = source.slice(
    source.indexOf("if (op === 'capture_report') {"),
    source.indexOf('/* -- User-facing resolve'),
  );

  it('exists, as a branch of its own before the user-facing resolve', () => {
    expect(capture.length).toBeGreaterThan(1_000);
    expect(attempt.length).toBeGreaterThan(1_000);
    expect(branch.length).toBeGreaterThan(200);
    expect(source.indexOf("if (op === 'capture_report') {")).toBeLessThan(source.indexOf('/* -- User-facing resolve'));
  });

  it('authenticates, then asks for the REPORT permission, then meters, before it does anything', () => {
    const auth = branch.indexOf('await verifyAuth(');
    const permission = branch.indexOf('await requireModulePermission(');
    const actorQuota = branch.indexOf('await enforceActorQuota(');
    const ipQuota = branch.indexOf('await enforceIpQuota(');
    const work = branch.indexOf('await captureReportPhotographs(');
    expect(auth).toBeGreaterThan(-1);
    expect(permission).toBeGreaterThan(auth);
    expect(branch.slice(permission, actorQuota)).toMatch(/'reports',\s*'can_view'/);
    expect(actorQuota).toBeGreaterThan(permission);
    expect(ipQuota).toBeGreaterThan(permission);
    expect(work).toBeGreaterThan(Math.max(actorQuota, ipQuota));
    // The caller is the verified session, never a field of the request.
    expect(branch).toContain('userId: auth.userId');
    expect(branch).toContain('wait: body.wait === true');
  });

  it('lets only the author start a capture, from their own finished extraction', () => {
    const start = capture.slice(capture.indexOf('if (!record) {'), capture.indexOf('} else {'));
    expect(start).toContain("if (report.generated_by !== args.userId) return { status: 403, reason: 'not_the_author' };");
    expect(capture).toContain('const requestedBy = record?.requestedBy ?? args.userId;');
    expect(capture).toContain("if (job.user_id !== requestedBy) return { status: 403, reason: 'not_your_extraction', held: held.length };");
    expect(capture).toContain("if (job.status !== 'succeeded') return { status: 409, reason: 'extraction_not_finished', held: held.length };");
  });

  it('starts only for the report\'s own address, and stops a resume once the report is re-pointed', () => {
    // The report is read with its address.
    expect(capture).toMatch(/select\('id, generated_by, parent_report_id, derived_from_report_id, property_address'\)/);
    // Start: the address the extraction read must be the report's, before any record exists.
    const read = capture.indexOf('const source = extractionPhotographSource(job.result);');
    const unknown = capture.indexOf("if (!source) return { status: 409, reason: 'address_unknown' };");
    const checked = capture.indexOf('if (!photographsAreOfReportAddress(report.property_address, source)) {');
    const refused = capture.indexOf("return { status: 409, reason: 'address_mismatch' };");
    const created = capture.indexOf('record = newCaptureRecord({ scrapeJobId, requestedBy, now, source });');
    const begun = capture.indexOf('const begun = beginCaptureAttempt(record, now);');
    const run = capture.indexOf('await runCaptureAttempt(');
    for (const at of [read, unknown, checked, refused, created, begun, run]) expect(at).toBeGreaterThan(-1);
    expect(read).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(checked);
    expect(checked).toBeLessThan(refused);
    expect(refused).toBeLessThan(created);
    expect(created).toBeLessThan(begun);
    expect(begun).toBeLessThan(run);
    // Resume: held against the record's address again, before any state is acted on.
    const resume = capture.slice(capture.indexOf('} else {'), capture.indexOf("from('property_scrape_jobs')"));
    const again = resume.indexOf('if (!photographsAreOfReportAddress(report.property_address, record.source)) {');
    expect(again).toBeGreaterThan(-1);
    expect(resume).toContain("return { status: 409, reason: 'address_changed', held: held.length };");
    expect(again).toBeLessThan(resume.indexOf("if (state === 'complete') return"));
  });

  it('lets a resume continue only what the author asked, for this report, and never ask for anything new', () => {
    const resume = capture.slice(capture.indexOf('} else {'), capture.indexOf("from('property_scrape_jobs')"));
    expect(resume).toContain("return { status: 409, reason: 'different_extraction', held: held.length };");
    expect(resume).toContain("if (record.requestedBy !== report.generated_by) return { status: 409, reason: 'record_mismatch', held: held.length };");
    expect(resume).toMatch(/if \(state === 'complete'\) return/);
    expect(resume).toMatch(/if \(state === 'running'\) return \{ status: 202/);
    // The job a resume reads is the record's, never the request's.
    expect(capture).toContain("const scrapeJobId = record?.scrapeJobId ?? String(args.scrapeJobId).trim().toLowerCase();");
    expect(capture).toContain(".eq('id', scrapeJobId)");
  });

  it('refuses a derived report, and a record it cannot read is not a record that is absent', () => {
    expect(capture).toMatch(/if \(report\.parent_report_id \|\| report\.derived_from_report_id\) return \{ status: 409, reason: 'derived_report' \};/);
    expect(capture).toContain("return { status: 503, reason: 'record_unreadable', held: held.length };");
    expect(capture).toContain("if (reportError) return { status: 503, reason: 'report_unreadable' };");
    expect(capture).toContain("if (jobError) return { status: 503, reason: 'extraction_unreadable', held: held.length };");
  });

  it('writes the attempt down before it fetches, and fetches nothing it could not write down', () => {
    const begin = capture.indexOf('const begun = beginCaptureAttempt(record, now);');
    const written = capture.indexOf('if (!(await writeCaptureRecord(supabase, folder, begun))) {');
    const refused = capture.indexOf("return { status: 503, reason: 'record_unwritable', held: held.length };");
    const run = capture.indexOf('await runCaptureAttempt(');
    expect(begin).toBeGreaterThan(-1);
    expect(written).toBeGreaterThan(begin);
    expect(refused).toBeGreaterThan(written);
    expect(run).toBeGreaterThan(refused);
    expect(capture).toMatch(/if \(!args\.wait\) \{\s*continueAfterResponse\(/);
    expect(capture).toContain("return { status: 202, state: 'accepted', held: held.length };");
    expect(section).toMatch(/runtime\.waitUntil\(work\)/);
    expect(capture).toContain('await writeCaptureRecord(supabase, folder, finished);');
  });

  it('re-checks the job\'s candidates rather than trusting them, and fetches only through the SSRF guard', () => {
    expect(capture).toContain('readPageCandidates(result.photographs?.candidates)');
    expect(capture).toContain('readPageFloorPlanCandidates(result.photographs?.floorPlans)');
    expect(attempt).toMatch(/fetchImageBytes\(\{ url: renditions\.store, origin: 'scraped' \}, \{ furniture \}\)/);
    expect(attempt).toMatch(/fetchImageBytes\(\{ url: renditions\.classify, origin: 'scraped' \}, \{ furniture \}\)/);
    // The furniture rule is lifted for a plan and for nothing else: a
    // photograph is still refused for a URL that says it is page furniture.
    expect(attempt).toContain("const furniture = args.kind === 'photo';");
    expect(source).toContain("if (options.furniture !== false && looksLikeChromeUrl(candidate.url)) return { error: 'page_furniture' };");
    expect(section).not.toMatch(/(^|[^\w.])fetch\(/m);
    expect(section).not.toContain('fetchWithTimeout(');
  });

  it('keeps a photograph only on the server\'s own verdict, at print size, once, at its own place', () => {
    expect(attempt).toContain('for (const place of candidatesToTry(args.candidates, args.settled, args.held, limit))');
    // One pass per list, each held to its own verdict and its own limit: a
    // photograph only where the pixels read as one, a plan only as a plan.
    expect(attempt).toContain("if (analysis.kind !== args.kind) { refuse(url, analysis.kind); continue; }");
    expect(attempt).toContain("const limit = args.kind === 'floorplan' ? REPORT_FLOOR_PLAN_LIMIT : REPORT_PHOTOGRAPH_LIMIT;");
    expect(capture).toMatch(/runCaptureAttempt\(supabase, \{ kind: 'photo', folder, candidates, settled, held, budget \}\)/);
    expect(attempt).toContain("if ('refusal' in judged) { refuse(url, judged.refusal); continue; }");
    expect(attempt).toMatch(/Math\.max\(size\.width, size\.height\) < MIN_PRINT_LONG_EDGE_PX/);
    expect(attempt).toContain("if (checksums.has(checksum)) { refuse(url, 'duplicate'); continue; }");
    expect(attempt).toMatch(/signatureDistance\(prior, analysis\.signature\)[\s\S]*SIGNATURE_MATCH_BITS/);
    expect(attempt).toMatch(/if \(placesTakenBefore\(places, place\) >= limit\) break;/);
    expect(attempt).toMatch(/if \(!hasBudget\(budget\)\) \{ refusals\.push\('out_of_time'\); continue; \}/);
    expect(attempt).toMatch(/captureObjectName\(\{\s*place,/);
  });

  it('files under the report and never in the marketplace\'s library', () => {
    expect(attempt).toContain('.upload(`${args.folder}/${name}`');
    expect(section).not.toContain(".from('listing_images')");
    expect(capture).toContain('const folder = captureFolder(args.reportId);');
  });

  it('files the listing\'s plans in the report\'s plans folder, after the photographs, on the same allowance', () => {
    expect(capture).toContain('const planFolder = floorPlanFolder(args.reportId);');
    const photographs = capture.indexOf("await runCaptureAttempt(supabase, { kind: 'photo'");
    const plans = capture.indexOf("kind: 'floorplan',");
    expect(photographs).toBeGreaterThan(-1);
    expect(plans).toBeGreaterThan(photographs);
    expect(capture.slice(plans, plans + 200)).toContain('folder: planFolder,');
    // One allowance for the attempt, handed to both passes.
    const own = capture.slice(0, capture.indexOf("/* A PDF-made report's photographs"));
    expect(own.length).toBeGreaterThan(1_000);
    expect(own.match(/newAnalysisBudget\(/g)).toHaveLength(1);
    expect(capture.slice(plans, plans + 300)).toContain('budget,');
    // A plans folder that cannot be listed is not an empty one: a place could be filled twice.
    expect(capture).toMatch(/if \(plans\.error\) return \{ status: 503, reason: 'storage_unreadable', held: held\.length \};/);
  });

  it('decides the whole capture over both lists, before an attempt and after one', () => {
    const decided = capture.indexOf('const final: CaptureFinish | null = captureFinish({');
    expect(decided).toBeGreaterThan(-1);
    expect(decided).toBeLessThan(capture.indexOf('const begun = beginCaptureAttempt(record, now);'));
    expect(capture.slice(decided, decided + 300)).toContain('plans: { candidates: planCandidates, settled: planSettled, held: heldPlans },');
    const finished = capture.indexOf('const finished = finishCaptureAttempt(begun, {');
    expect(capture.slice(finished, finished + 600)).toMatch(/plans: \{\s*candidates: planCandidates,/);
  });
});

describe('the broker reads a URL-extract report\'s photographs, and where their capture stands', () => {
  const broker = readFileSync('supabase/functions/get-investment-reports/index.ts', 'utf8');
  const fn = broker.slice(broker.indexOf('async function readCapturedPhotographs('), broker.indexOf('Deno.serve('));

  it('is the fallback for a report with no listing, and only for that', () => {
    expect(broker).toMatch(/if \(!listingId\) return await readCapturedPhotographs\(supabase, row, correlationId\);/);
  });

  it('reads the family\'s folder for a derived document, and names that report as the capture\'s', () => {
    expect(fn).toContain('const ownerId = row ? familyParentId(row) ?? row.id : null;');
    // A folder with no capture record may hold a brochure's (a report made from
    // a PDF), whose photographs were chosen once and leave nothing to finish.
    expect(fn).toContain("state: record ? captureStateOf(record, Date.now()) : 'complete',");
    expect(fn).toContain('reportId: ownerId.trim().toLowerCase(),');
    expect(fn).toContain('capturedPhotographsForReport(listed.data ?? [])');
  });

  it('serves nothing without a readable record, and nothing of another address', () => {
    const reader = fn.slice(fn.indexOf('async function readCaptureRecord('));
    expect(reader).toMatch(/if \(stored\.error \|\| !stored\.data\) \{[\s\S]*?return null;/);
    // Without a capture record the folder is read for a brochure's record
    // instead, and without either nothing is served. Each is held to the
    // report's address before a single photograph is chosen.
    const read = fn.indexOf('const record = await readCaptureRecord(');
    const address = fn.indexOf('if (!photographsAreOfReportAddress(row?.property_address, record.source)) {');
    const noBrochure = fn.indexOf('if (!brochure) return { photographs: [] };');
    const brochureAddress = fn.indexOf('if (!brochurePhotographsAreOfReportAddress(row?.property_address, brochure.source)) {');
    const chosen = fn.indexOf('capturedPhotographsForReport(listed.data ?? [])');
    for (const at of [read, address, noBrochure, brochureAddress, chosen]) expect(at).toBeGreaterThan(-1);
    expect(address).toBeGreaterThan(read);
    expect(noBrochure).toBeGreaterThan(address);
    expect(brochureAddress).toBeGreaterThan(noBrochure);
    expect(chosen).toBeGreaterThan(brochureAddress);
  });

  it('holds a listing report to its listing\'s address before it reads a photograph', () => {
    const listing = broker.slice(broker.indexOf('async function readListingPhotographs('), broker.indexOf('async function readCapturedPhotographs('));
    const cached = listing.indexOf(".from('listings_cache')");
    const projected = listing.indexOf('projectAirtableRecord(');
    const checked = listing.indexOf('if (!photographsAreOfReportAddress(reportAddress, { address: projected.address, suburb: projected.suburb })) {');
    const images = listing.indexOf(".from('listing_images')");
    for (const at of [cached, projected, checked, images]) expect(at).toBeGreaterThan(-1);
    expect(cached).toBeLessThan(projected);
    expect(projected).toBeLessThan(checked);
    expect(checked).toBeLessThan(images);
    // A listing the cache no longer holds cannot vouch for an address: no
    // photographs and no plans (`none` is both, empty).
    expect(listing).toContain('const none: PhotographReading = { photographs: [], floorPlans: [] };');
    expect(listing).toMatch(/if \(listing\.error \|\| !listing\.data\) \{[\s\S]*?return none;/);
    expect(broker).toContain('readListingPhotographs(supabase, listingId, row?.property_address, correlationId)');
  });

  it('signs from the private bucket for minutes, and every failure is an empty list', () => {
    expect(fn).toContain(".from('listing-images')");
    // One signer for every picture the broker serves, photographs and plans.
    const signer = broker.slice(broker.indexOf('async function signStoredPictures('), broker.indexOf('async function readReportPhotographs('));
    expect(signer).toMatch(/\.from\('listing-images'\)\s*\.createSignedUrls\([\s\S]*PHOTOGRAPH_URL_TTL_SECONDS\)/);
    expect(signer).toContain('if (signed.error) return null;');
    expect(fn).toContain('await signStoredPictures(supabase, chosen.map(');
    expect(fn).toMatch(/catch \(error\) \{[\s\S]*return \{ photographs: \[\] \};/);
  });

  it('adds the reading to the answer only where there is one', () => {
    expect(broker).toContain('...(reading?.photographCapture ? { photographCapture: reading.photographCapture } : {}),');
  });
});

describe('the extraction names them and stores them on its job, and nothing about it can cost the extraction', () => {
  const scrape = readFileSync('supabase/functions/scrape-property-listing/index.ts', 'utf8');

  it('asks the reader for the page as served, beside the markdown it already read', () => {
    expect(scrape).toContain('formats: ["markdown", "rawHtml"]');
  });

  it('names them inside a try, so a page no rule reads leaves the job exactly as it was', () => {
    const at = scrape.indexOf('photographCandidates = photographCandidatesFromPage(');
    expect(at).toBeGreaterThan(-1);
    expect(scrape.slice(Math.max(0, at - 400), at)).toMatch(/try \{\s*$/);
    expect(scrape.slice(at, at + 900)).toMatch(/\} catch \(e\) \{/);
  });

  it('stores the names on the succeeded job, where the report\'s request reads them', () => {
    expect(scrape).toMatch(
      /photographs: \{\s*candidates: result\.photographCandidates \?\? \[\],\s*floorPlans: result\.floorPlanCandidates \?\? \[\],\s*\}/,
    );
  });

  it('names the floor plans in a try of their own, so a plan no rule reads costs neither the photographs nor the job', () => {
    const at = scrape.indexOf('floorPlanCandidates = floorPlanCandidatesFromPage(');
    expect(at).toBeGreaterThan(-1);
    expect(scrape.slice(Math.max(0, at - 200), at)).toMatch(/try \{\s*$/);
    expect(scrape.slice(at, at + 300)).toMatch(/\} catch \(e\) \{/);
    // Photographs first, in their own try: the plans cannot take them down.
    expect(scrape.indexOf('photographCandidates = photographCandidatesFromPage(')).toBeLessThan(at);
  });

  it('hands the page reader the markup alone: a page\'s og:image names no property', () => {
    expect(scrape).not.toMatch(/ogImage|og:image/);
  });
});

describe('the generator asks once the report exists; the adapter finishes what is left before drawing', () => {
  const generator = readFileSync('src/components/reports/InvestmentReportGenerator.tsx', 'utf8');
  const adapter = readFileSync('src/lib/reportTemplate/adapters/investmentReportAdapter.ts', 'utf8');

  it('keeps the job id and the count from the extraction it polled', () => {
    expect(generator).toContain('scrapeJobId: startData.jobId,');
    expect(generator).toContain('photographCount: namedPhotographCount(scrapedResult),');
  });

  it('asks after the report row is created, through the retrying start, and never waits on it', () => {
    const insert = generator.indexOf("report_content: 'Generating report from extracted listing...',");
    const ask = generator.indexOf('photographCaptureRequest(pendingReport.id, urlScrapedData)');
    expect(insert).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(insert);
    expect(generator.slice(ask, ask + 500)).toMatch(/void startPhotographCapture\(\s*\(request\) => invokeSecureFunction\('listing-images', \{ \.\.\.request \}\),/);
    // Exactly one call site: only the URL flow has an extraction to keep photographs from.
    expect(generator.match(/photographCaptureRequest\(/g)).toHaveLength(1);
  });

  it('resumes only what the broker calls pending, bounded, and reads again only if the resume answered', () => {
    const fn = adapter.slice(adapter.indexOf('async function loadInvestmentReportWithPhotographs('), adapter.indexOf('async function readReportAndPhotographs('));
    expect(fn).toContain('const resume = photographResumeRequest(first.capture);');
    expect(fn).toContain('if (!resume) return first;');
    expect(fn).toContain("invokeSecureFunction('listing-images', { ...resume }, { timeoutMs: PHOTOGRAPH_RESUME_TIMEOUT_MS })");
    expect(fn).toContain('if (error) return first;');
    expect(fn).toContain('return (await readReportAndPhotographs(reportId)) ?? first;');
  });
});
