/**
 * Do SA, WA, NT and ACT publish a planning layer — and under what licence?
 *
 * ── Two premises, and both are the class that keeps being wrong ──────────
 *
 * `planningSources.pure.ts` carries two statements about these
 * jurisdictions, and neither is a measurement this repository can show:
 *
 *     WA_LICENCE_NOTE  'WA planning scheme data (SLIP) is published for
 *                       personal, non-commercial use; commercial
 *                       republication requires written authorisation, so
 *                       nothing is fetched.'
 *
 *     SA_NT_NOTE       'No verified endpoint yet: every candidate host
 *                       refused this platform's scripted egress during
 *                       integration.'
 *
 * The second is a measurement about the DEVELOPMENT egress at some past
 * moment, and that egress is the one that answers 403 to CONNECT for
 * `data.api.abs.gov.au`, `data.gov.au` and every ABS host — three registers
 * that answer the production egress perfectly well. §8 of
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` is the precedent: four jurisdictions
 * assumed unreachable answered HTTP 200 from production, all open licence,
 * no key.
 *
 * The first is a **licence** claim, which is a different kind of thing
 * again. It may be right. It may be about the wrong service — a jurisdiction
 * can publish the same layer through a restricted portal and an open data
 * catalogue at once. Nothing in this repository has ever read what the
 * endpoint itself says about its terms.
 *
 * ── A licence is read from the publisher's own metadata, never assumed ───
 *
 * This is the rule this module exists for, and it is `licensingOf()`'s rule
 * one layer down: *absent means `unverified` — the conservative reading,
 * because assuming a right nobody has confirmed is how a licence gets
 * breached in a document that has already been emailed.*
 *
 * An ArcGIS REST service answers `?f=json` with `copyrightText`,
 * `licenseInfo` and `description`, and a WFS answers `GetCapabilities` with
 * `Fees` and `AccessConstraints`. Those are the publisher's own words about
 * its own terms, and they are what a licence reading must come from.
 *
 * So `readLicenceEvidence` REPORTS and never concludes:
 *
 *  - `open` requires the publisher to NAME an open licence. Creative Commons
 *    by name, or an explicit unrestricted statement.
 *  - `restricted` requires the publisher to say so.
 *  - **`unverified` is everything else, including silence**, and it is not
 *    permission. A layer whose terms nobody has stated may be read for a
 *    probe and may not be republished in a client's document.
 *
 * Nothing here decides to fetch anything. It decides what a reading may
 * SAY, which is the same split `forwardDemand.pure.ts` makes between a
 * reader and a policy.
 *
 * ── Three failures that must never look alike ────────────────────────────
 *
 * A candidate endpoint is a URL somebody typed, and there is no catalogue of
 * state GIS services to discover one from. That is a real weakness and the
 * mitigation is in how failure is classified, because the three ways a
 * candidate can fail send a person to three different places:
 *
 *  - `no_such_service` — DNS or 404. **Our URL is wrong**, and it says
 *    nothing whatever about the jurisdiction.
 *  - `refused` — 401/403. The publisher is there and declined us.
 *  - `unreachable` — a timeout or a 5xx. Nobody's fault, worth a retry.
 *
 * Collapsing them is how *"every candidate host refused this platform's
 * scripted egress"* came to stand for *"SA publishes no layer"*. A single
 * 404 may never stand as a jurisdiction publishing nothing, which is why
 * every jurisdiction carries MORE THAN ONE candidate and the probe prints
 * every outcome.
 *
 * Deno-compatible: one type-only import, and deliberately only that. The
 * jurisdiction union is `planningSources.pure.ts`' — re-declaring it here
 * would be the two-ends-drift fault this module's own ACT spec exists to
 * stop.
 */
import type { PlanningJurisdiction } from './planningSources.pure.ts';

export type LayerServiceKind = 'arcgis' | 'wfs';

/** One endpoint worth asking, and what asking it would establish. */
export interface LayerCandidate {
  jurisdiction: 'SA' | 'WA' | 'NT' | 'ACT';
  /** The publisher, in a reader's words. */
  publisher: string;
  /** What this service is called by its publisher. */
  service: string;
  kind: LayerServiceKind;
  /** The service ROOT. Metadata is composed from it, never hand-written. */
  root: string;
}

/**
 * The metadata request for one candidate.
 *
 * Composed rather than listed, so a candidate is a root URL and nothing
 * else — the same reason `absDataStructureUrl` takes a flow rather than a
 * string.
 */
export function layerMetadataUrl(candidate: LayerCandidate): string {
  const root = candidate.root.replace(/\/+$/, '');
  return candidate.kind === 'arcgis'
    ? `${root}?f=json`
    : `${root}?service=WFS&request=GetCapabilities`;
}

export type LicenceReading =
  /** The publisher names an open licence. */
  | { kind: 'open'; evidence: string }
  /** The publisher says the terms are restricted. */
  | { kind: 'restricted'; evidence: string }
  /** The publisher says nothing a reader could rely on. NOT permission. */
  | { kind: 'unverified'; evidence: string | null };

/**
 * An open licence, named by the publisher.
 *
 * Creative Commons by name or abbreviation, or an explicit unrestricted
 * statement. Deliberately narrow: "free" and "public" are not licences, and
 * a service that is free to call is not a service whose data may be
 * republished.
 */
export const OPEN_LICENCE_PATTERN =
  /creative\s+commons|\bCC[-\s]?BY\b|\bCC0\b|open\s+(?:government\s+)?licence|open\s+data\s+licen[cs]e|no\s+restrictions?\s+on\s+(?:use|republication)/i;

/**
 * A restriction, named by the publisher.
 *
 * `non-commercial` is the one that matters for this product, because a
 * client's report is a commercial document — which is precisely what
 * `WA_LICENCE_NOTE` asserts and what this pattern would confirm if the
 * endpoint says it.
 */
export const RESTRICTED_LICENCE_PATTERN =
  /non[-\s]?commercial|personal\s+use|written\s+(?:authorisation|authorization|permission)|not\s+(?:be\s+)?redistribut|all\s+rights\s+reserved|licen[cs]e\s+agreement\s+required/i;

/**
 * Read what a service says about its own terms.
 *
 * `restricted` wins a body that matches both, which is the conservative
 * side: a service naming Creative Commons for one layer and non-commercial
 * terms for another must not be read as open on the strength of the first.
 */
export function readLicenceEvidence(fields: ReadonlyArray<string | null | undefined>): LicenceReading {
  const said = fields.filter((f): f is string => typeof f === 'string' && f.trim() !== '');
  if (said.length === 0) return { kind: 'unverified', evidence: null };
  const joined = said.join(' · ');
  const restricted = said.find((f) => RESTRICTED_LICENCE_PATTERN.test(f));
  if (restricted) return { kind: 'restricted', evidence: restricted.slice(0, 400) };
  const open = said.find((f) => OPEN_LICENCE_PATTERN.test(f));
  if (open) return { kind: 'open', evidence: open.slice(0, 400) };
  return { kind: 'unverified', evidence: joined.slice(0, 400) };
}

/**
 * Why a candidate produced no reading. Five answers, five remedies.
 *
 * `challenged` was added by the first live run and it is the measurement that
 * justifies this whole classification. `www.ntlis.nt.gov.au` answered **403
 * with `<title>Just a moment...</title>`** — a bot-protection interstitial,
 * not the Northern Territory declining to publish. Read as `refused`, the
 * note said *"NT's planning service declined this platform's requests"*,
 * which sends an operator to write to the NT Government about a decision
 * nobody there made. The remedy is a browser-shaped client or an
 * agreed-upon path, and it is OURS.
 *
 * `bad_request` is the other half of the same lesson. WA's WFS root answered
 * **400 with `<title>ArcGIS Server Error</title>`**: the service exists and
 * our parameters were wrong. A 400 filed as `unreachable` reads as somebody
 * else's outage.
 */
export type CandidateFailure =
  /** 404/410 — the address is ours to fix. */
  | 'no_such_service'
  /** 400/405/415/501 — the request is ours to fix. */
  | 'bad_request'
  /** A bot-protection interstitial stood in front of the service. Ours. */
  | 'challenged'
  /** 401/403 from the service itself. Theirs, and a real finding. */
  | 'refused'
  /** A timeout, a DNS failure or a 5xx. Nobody's. */
  | 'unreachable';

/** Which failures are ours rather than the publisher's. */
export const OUR_FAILURES: readonly CandidateFailure[] = ['no_such_service', 'bad_request', 'challenged'];

/**
 * A bot-protection interstitial, recognised by its own page.
 *
 * Deliberately matched on the challenge page's own title and markers rather
 * than on the status code, because the same 403 is how a service genuinely
 * declines. Getting this wrong in either direction is a mistake: reading a
 * real refusal as a challenge understates a finding about the publisher, and
 * reading a challenge as a refusal invents one.
 */
export function bodyLooksChallenged(body: string): boolean {
  const head = body.slice(0, 4000);
  return /just a moment\.\.\.|cf[-_]?chl|__cf_chl|challenge-platform|checking your browser|enable javascript and cookies to continue|attention required!\s*\|\s*cloudflare/i
    .test(head);
}

/**
 * Classify a failure by what it says about WHOSE problem it is.
 *
 * A 404 is ours: a service root we typed wrong. A 400 is ours too: the
 * service answered and our parameters were wrong. A challenge page is ours,
 * whatever digit it wears. A 403 from the service itself is theirs, and a
 * real finding. A 5xx or a timeout is nobody's.
 *
 * Reporting the first four as each other is what turned a typed URL into a
 * statement about a jurisdiction.
 */
export function classifyCandidateFailure(
  status: number | null,
  networkError: boolean,
  body = '',
): CandidateFailure {
  /*
   * The challenge test comes FIRST and is asked of any answer carrying one,
   * because a challenge is served under 403, 429 and 503 alike depending on
   * the edge's mood — so the digit cannot decide it.
   */
  if (!networkError && body !== '' && bodyLooksChallenged(body)) return 'challenged';
  if (networkError) return 'unreachable';
  if (status === null) return 'unreachable';
  if (status === 404 || status === 410) return 'no_such_service';
  if (status === 400 || status === 405 || status === 415 || status === 501) return 'bad_request';
  if (status === 401 || status === 403) return 'refused';
  return 'unreachable';
}

/** What a candidate produced. */
export type CandidateOutcome =
  | { kind: 'answered'; layers: string[]; licence: LicenceReading; bytes: number }
  /**
   * A service DIRECTORY answered: the jurisdiction is reachable and has
   * published its own list of services, but a directory states no licence.
   *
   * This is its own outcome rather than an `answered` with no terms, because
   * the two send an operator to different places. *"Answered and stated no
   * licence"* is a finding about a dataset — the next move is to ask the
   * publisher. *"Its catalogue answered and lists 214 services"* is a
   * finding about US — the next move is to read one of the 214. Collapsing
   * them would file a whole integration task as a licence problem.
   */
  | { kind: 'directory'; services: string[]; folders: string[]; bytes: number }
  | { kind: 'failed'; failure: CandidateFailure; status: number | null; detail: string };

/**
 * What this platform may conclude about one jurisdiction, from every
 * candidate it asked.
 *
 * The readings are deliberately not a single boolean, because each sends a
 * different sentence to a reader and a different task to an operator.
 */
export type JurisdictionLayerReading =
  /** At least one service answered and named an open licence. */
  | { kind: 'integratable'; service: string; licence: string; layers: number }
  /** A service answered and its own terms forbid republication. */
  | { kind: 'licence_restricted'; service: string; evidence: string }
  /** A service answered and stated no terms. Not permission. */
  | { kind: 'licence_unverified'; service: string; layers: number }
  /**
   * The jurisdiction's own service catalogue answered and lists services,
   * and none of them has been read yet. Reachable, integration outstanding.
   */
  | { kind: 'catalogue_readable'; service: string; services: number; folders: number }
  /**
   * A catalogue answered with FOLDERS and no services. It has not answered
   * the question: a folder is where services live, so this reading means the
   * walk stopped one level short — which is measured, WA answering
   * `0 services across 5 folders`.
   */
  | { kind: 'catalogue_folders_only'; service: string; folders: string[] }
  /** Every candidate refused us. A finding about the publisher. */
  | { kind: 'refused_us'; asked: number }
  /**
   * A bot-protection interstitial stood in front of every candidate. OURS,
   * and emphatically not a decision the publisher made.
   */
  | { kind: 'challenged'; asked: number }
  /** Every candidate answered with our own mistake. A finding about OUR URLs. */
  | { kind: 'no_candidate_resolved'; asked: number }
  /** Nothing answered and not because of a refusal. Worth a retry. */
  | { kind: 'unreachable'; asked: number };

/**
 * Judge one jurisdiction from its candidates' outcomes.
 *
 * Order matters and is the whole point. An `open` answer outranks
 * everything, then a stated restriction (a real finding), then an answer
 * with no terms (not permission), and only then the three failures — which
 * are ranked so the one that blames US comes before the ones that blame
 * anybody else.
 */
export function assessJurisdictionLayers(
  outcomes: ReadonlyArray<{ candidate: LayerCandidate; outcome: CandidateOutcome }>,
): JurisdictionLayerReading {
  /*
   * Narrowed once, by construction, rather than asserted by a predicate: the
   * three passes below each need the `answered` fields, and a cast would let
   * a future fourth pass read a field a failure does not carry.
   */
  const answered = outcomes.flatMap((o) =>
    o.outcome.kind === 'answered'
      ? [{ candidate: o.candidate, answer: o.outcome }]
      : [],
  );
  for (const o of answered) {
    if (o.answer.licence.kind === 'open') {
      return {
        kind: 'integratable',
        service: o.candidate.service,
        licence: o.answer.licence.evidence,
        layers: o.answer.layers.length,
      };
    }
  }
  for (const o of answered) {
    if (o.answer.licence.kind === 'restricted') {
      return { kind: 'licence_restricted', service: o.candidate.service, evidence: o.answer.licence.evidence };
    }
  }
  /*
   * A CATALOGUE outranks an unstated licence, and the first live run is what
   * settled the order. The ACT's verified organisation answered with **391
   * services** while its one Territory Plan service answered a
   * `copyrightText` of `"TP"` — three characters, which reads as
   * `unverified`. Ranked the other way, the note read *"nothing from it is
   * republished here"* about a jurisdiction whose zone this product publishes
   * on every ACT report.
   *
   * The principle, not the data: **a licence read from ONE service does not
   * describe a catalogue of 391.** A stated RESTRICTION is different and
   * stays above this, because a publisher's blanket non-commercial terms are
   * a prohibition worth surfacing whatever else answered.
   */
  for (const o of outcomes) {
    if (o.outcome.kind !== 'directory') continue;
    if (o.outcome.services.length === 0) continue;
    return {
      kind: 'catalogue_readable',
      service: o.candidate.service,
      services: o.outcome.services.length,
      folders: o.outcome.folders.length,
    };
  }
  for (const o of answered) {
    return { kind: 'licence_unverified', service: o.candidate.service, layers: o.answer.layers.length };
  }
  /*
   * Folders and no services: the walk stopped one level short. Ranked below
   * every real answer and above every failure, because the host IS reachable
   * and the remedy is to ask the folders.
   */
  for (const o of outcomes) {
    if (o.outcome.kind !== 'directory') continue;
    if (o.outcome.folders.length === 0) continue;
    return { kind: 'catalogue_folders_only', service: o.candidate.service, folders: o.outcome.folders };
  }
  const failures = outcomes
    .map((o) => (o.outcome.kind === 'failed' ? o.outcome.failure : null))
    .filter((f): f is CandidateFailure => f !== null);
  if (failures.length === 0) return { kind: 'unreachable', asked: outcomes.length };
  /*
   * Ours before theirs. Where every candidate 404'd, the honest reading is
   * that this repository has no working URL for the jurisdiction — never
   * that the jurisdiction publishes nothing.
   */
  /*
   * A challenge is read before a refusal, because the two arrive under the
   * same digit and send an operator to opposite remedies — and only one of
   * them is a decision the publisher made.
   */
  if (failures.some((f) => f === 'challenged')) return { kind: 'challenged', asked: outcomes.length };
  if (failures.every((f) => OUR_FAILURES.includes(f))) {
    return { kind: 'no_candidate_resolved', asked: outcomes.length };
  }
  if (failures.some((f) => f === 'refused')) return { kind: 'refused_us', asked: outcomes.length };
  return { kind: 'unreachable', asked: outcomes.length };
}

/**
 * What a report may say about a jurisdiction whose layers are not read.
 *
 * Six readings, six sentences, and none of them is a statement about the
 * property or the area. `no_candidate_resolved` is the one that did not
 * exist before and is the reason this module was written: *"we have no
 * working endpoint"* and *"the publisher refused us"* are different
 * admissions, and only the second is about them.
 */
export function jurisdictionLayerNote(reading: JurisdictionLayerReading, jurisdiction: string): string {
  switch (reading.kind) {
    case 'integratable':
      return `${jurisdiction}'s planning layers are published by a service this platform can read `
        + `(${reading.service}, ${reading.layers} layers) under a licence its publisher names. `
        + 'Integrating them is outstanding work rather than a limitation of the source.';
    case 'licence_restricted':
      return `${jurisdiction}'s planning layers are published under terms its own service states and `
        + 'which do not permit republication in a document like this one, so nothing is retrieved. '
        + 'Nothing here says whether a control applies.';
    case 'licence_unverified':
      return `${jurisdiction}'s planning service answers and states no licence terms a reader could `
        + 'rely on, so nothing from it is republished here. An unstated licence is not permission, '
        + 'and nothing here says whether a control applies.';
    case 'catalogue_readable':
      return `${jurisdiction}'s own spatial catalogue answers this platform and lists `
        + `${reading.services} service${reading.services === 1 ? '' : 's'}`
        + `${reading.folders > 0 ? ` across ${reading.folders} folders` : ''} `
        + `(${reading.service}). No layer from it is read into this report yet, so nothing here says `
        + 'whether a control applies — that is outstanding integration work rather than a limitation '
        + 'of the source.';
    case 'catalogue_folders_only':
      return `This platform reached ${jurisdiction}'s own spatial catalogue, which answered with `
        + `${reading.folders.length} folder${reading.folders.length === 1 ? '' : 's'} and no service at its `
        + `root (${reading.service}). Reading it is outstanding work here — the folders were not asked — `
        + 'and nothing in this report says whether a control applies.';
    case 'refused_us':
      return `${jurisdiction}'s planning service declined this platform's requests, so no layer was `
        + 'read. That is a statement about the retrieval rather than about the area.';
    case 'challenged':
      return `A bot-protection challenge stood in front of ${jurisdiction}'s planning service on every `
        + 'address this platform asked, so no layer was read. That is a property of automated access '
        + `rather than a decision ${jurisdiction} made about publishing, and nothing here says whether `
        + 'a control applies.';
    case 'no_candidate_resolved':
      return `This platform holds no working endpoint for ${jurisdiction}'s planning layers — every `
        + 'address it asked resolved to nothing. That is a gap in this report, not a statement that '
        + `${jurisdiction} publishes no planning layer.`;
    case 'unreachable':
      return `${jurisdiction}'s planning layers could not be reached for this report, so nothing here `
        + 'says whether a control applies. That is a statement about the retrieval.';
  }
}

// ---------------------------------------------------------------------------
// Reading what a service answered — a DIRECTORY and a SERVICE are not alike
// ---------------------------------------------------------------------------

/**
 * An ArcGIS root answers `?f=json` two different ways and the difference
 * matters more than it looks.
 *
 * A **service directory** (`/arcgis/rest/services`) answers `{folders,
 * services}` — the jurisdiction's own list of everything it publishes. That
 * is the answer worth having, because it means one typed HOST buys the whole
 * catalogue and no layer id is ever typed: the same discipline
 * `nationalPipeline.pure.ts` pays for, where a resource id is what the
 * module OUTPUTS rather than what it is handed.
 *
 * A **service** answers `{copyrightText, layers, …}`, which is where the
 * licence lives.
 *
 * Reading the first as the second is how a reachable jurisdiction comes to
 * look like one publishing nothing: a directory carries no `layers` array, so
 * a service parser reads a perfectly good 200 as zero layers.
 */
export type ArcgisAnswer =
  /** The jurisdiction's own list of what it publishes. */
  | { kind: 'directory'; folders: string[]; services: string[] }
  /** One service, and whatever it says about its own terms. */
  | { kind: 'service'; layers: string[]; licence: LicenceReading }
  /** JSON, and an ArcGIS error inside it — a 200 that is a refusal. */
  | { kind: 'error'; message: string }
  /** Not JSON, or JSON of no shape this reader knows. */
  | { kind: 'unreadable'; reason: string };

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Read an ArcGIS `?f=json` answer.
 *
 * An ArcGIS service answers an error as HTTP **200** with `{error:{code}}`
 * inside it — the shape `PGRST205` and the ABS's truncated-but-200 taught
 * this repository to look for. So the error branch is read BEFORE the
 * shape branches, or a refusal parses as an empty directory.
 */
export function parseArcgisAnswer(text: string): ArcgisAnswer {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return {
      kind: 'unreadable',
      reason: `not JSON (${text.length} bytes, ${String(err)}): ${JSON.stringify(text.slice(0, 220))}`,
    };
  }
  if (!body || typeof body !== 'object') {
    return { kind: 'unreadable', reason: `JSON but not an object (${text.length} bytes)` };
  }
  const o = body as Record<string, unknown>;
  const err = o.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    const code = err.code === undefined ? '?' : String(err.code);
    return { kind: 'error', message: `ArcGIS error ${code}: ${asString(err.message) ?? JSON.stringify(err)}` };
  }
  if (Array.isArray(o.services) || Array.isArray(o.folders)) {
    const folders = (Array.isArray(o.folders) ? o.folders : [])
      .map((f) => asString(f))
      .filter((f): f is string => f !== null);
    const services = (Array.isArray(o.services) ? o.services : [])
      .map((s) => {
        const r = s as Record<string, unknown>;
        const name = asString(r?.name);
        const type = asString(r?.type);
        return name ? (type ? `${name} (${type})` : name) : null;
      })
      .filter((s): s is string => s !== null);
    return { kind: 'directory', folders, services };
  }
  if (Array.isArray(o.layers) || o.currentVersion !== undefined) {
    const layers = (Array.isArray(o.layers) ? o.layers : [])
      .map((l) => asString((l as Record<string, unknown>)?.name))
      .filter((l): l is string => l !== null);
    return {
      kind: 'service',
      layers,
      licence: readLicenceEvidence([
        asString(o.copyrightText),
        asString(o.licenseInfo),
        asString(o.accessInformation),
        asString(o.serviceDescription),
        asString(o.description),
      ]),
    };
  }
  return { kind: 'unreadable', reason: `no services, folders or layers key (${text.length} bytes)` };
}

/**
 * Read a WFS `GetCapabilities` answer.
 *
 * OGC puts the terms in `<Fees>` and `<AccessConstraints>`, and the
 * convention is that both carry the literal `NONE` where there are none —
 * which is a statement and not silence, so it reads as `open`. That
 * distinction is the whole reason this is parsed rather than assumed:
 * `NONE` in `AccessConstraints` is the publisher saying there are no
 * constraints, where an absent element is the publisher saying nothing.
 */
export function parseWfsCapabilities(text: string): ArcgisAnswer {
  if (!/<\s*(?:wfs:)?WFS_Capabilities|<\s*(?:ows:)?ServiceIdentification/i.test(text)) {
    return {
      kind: 'unreadable',
      reason: `no WFS_Capabilities or ServiceIdentification element (${text.length} bytes): `
        + JSON.stringify(text.slice(0, 220)),
    };
  }
  const pick = (tag: string): string | null => {
    const m = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tag}>`, 'i').exec(text);
    return m ? asString(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : null;
  };
  const names: string[] = [];
  const nameRe = /<(?:[a-z]+:)?FeatureType\b[\s\S]*?<(?:[a-z]+:)?Name[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?Name>/gi;
  for (let m = nameRe.exec(text); m !== null; m = nameRe.exec(text)) {
    const n = asString(m[1]);
    if (n) names.push(n);
  }
  const fees = pick('Fees');
  const constraints = pick('AccessConstraints');
  const explicitlyNone = (v: string | null) => v !== null && /^none$/i.test(v);
  if (explicitlyNone(fees) && explicitlyNone(constraints)) {
    return {
      kind: 'service',
      layers: names,
      licence: { kind: 'open', evidence: 'the service states Fees: NONE and AccessConstraints: NONE' },
    };
  }
  return {
    kind: 'service',
    layers: names,
    licence: readLicenceEvidence([
      constraints === null ? null : `AccessConstraints: ${constraints}`,
      fees === null ? null : `Fees: ${fees}`,
      pick('Abstract'),
      pick('Title'),
    ]),
  };
}

// ---------------------------------------------------------------------------
// The candidates — a HOST is typed, a layer id never is
// ---------------------------------------------------------------------------

/**
 * Where to ask, per jurisdiction.
 *
 * Every entry is a **service root or a service directory**, never a layer
 * id and never a query. That is the one discipline available here: there is
 * no catalogue of state GIS hosts to discover a host from, so the host is
 * typed — but an ArcGIS service directory then enumerates everything the
 * jurisdiction publishes, so what gets read is the publisher's own list
 * rather than a path somebody guessed at.
 *
 * Two consequences are deliberate. **Every jurisdiction carries more than
 * one candidate**, because a single 404 against one typed host may never
 * stand for a jurisdiction publishing nothing — the fault that made
 * `SA_NT_NOTE` a statement about SA when it was a statement about our URLs.
 * And **the ACT root is the organisation the verified zone query already
 * uses** (`buildActZoningQuery` in `planningSources.pure.ts`), so the ACT
 * entry is not a guess at all: its zone layer is read today and its
 * directory lists whatever else that organisation serves. A spec pins the
 * two spellings together, because a literal at each end is how two ends
 * drift.
 */
/*
 * ── What the first live run measured, 22 Sep 2026, from CI ───────────────
 *
 *   SA   PlanSA spatial directory    200 · 131 services · 30 folders,
 *                                    including `PlanSA` and `ePlanning`
 *   WA   SLIP public directory       200 ·   0 services ·  5 folders,
 *                                    including `SLIP_Public_Services`
 *   NT   NTLIS directory             403 · `Just a moment...` (a challenge)
 *   ACT  ACTmapi organisation        200 · 391 services
 *
 * Two candidates were removed because their failure was measured and is not
 * informative to repeat: `location.sa.gov.au/geoserver/wfs` (404) and
 * `services.slip.wa.gov.au/.../WFSServer` (400, `ArcGIS Server Error` — our
 * parameters). One was added from the publisher's OWN answer rather than
 * from a guess: WA's `SLIP_Public_Services` folder is a name Landgate
 * printed, which is why naming it here is still discovery.
 *
 * `spatial.nt.gov.au` stays although its DNS does not resolve. The rule is
 * that a candidate's failure is PRINTED rather than hidden, and NT's other
 * address is behind a challenge — so removing it would leave one candidate,
 * and one 404 may never stand for a jurisdiction publishing nothing.
 */
export const LAYER_CANDIDATES: readonly LayerCandidate[] = [
  // ── ACT ── the organisation the verified Territory Plan zone query uses.
  {
    jurisdiction: 'ACT',
    publisher: 'ACT Government (ACTmapi)',
    service: 'ACTmapi ArcGIS Online organisation service directory',
    kind: 'arcgis',
    root: 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services',
  },
  {
    jurisdiction: 'ACT',
    publisher: 'ACT Government (ACTmapi)',
    service: 'ACTmapi Territory Plan Land Use Zones FeatureServer',
    kind: 'arcgis',
    root: 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer',
  },
  // ── SA ── Location SA is the state's published spatial platform.
  {
    jurisdiction: 'SA',
    publisher: 'Government of South Australia (Location SA)',
    service: 'Location SA ArcGIS service directory',
    kind: 'arcgis',
    root: 'https://location.sa.gov.au/arcgis/rest/services',
  },
  {
    jurisdiction: 'SA',
    publisher: 'Government of South Australia (Location SA)',
    service: 'Location SA ArcGIS Server directory',
    kind: 'arcgis',
    root: 'https://location.sa.gov.au/server/rest/services',
  },
  {
    jurisdiction: 'SA',
    publisher: 'Government of South Australia (PlanSA)',
    service: 'PlanSA spatial service directory',
    kind: 'arcgis',
    root: 'https://dpti.geohub.sa.gov.au/server/rest/services',
  },
  // ── WA ── SLIP is the platform whose LICENCE `WA_LICENCE_NOTE` asserts.
  {
    jurisdiction: 'WA',
    publisher: 'Landgate (SLIP)',
    service: 'SLIP public ArcGIS service directory',
    kind: 'arcgis',
    root: 'https://services.slip.wa.gov.au/public/rest/services',
  },
  {
    // The folder name is LANDGATE'S OWN, printed by the root directory above
    // on 22 Sep 2026. Naming it here is reading the publisher's answer, not
    // typing a path — and it is where the planning services sit.
    jurisdiction: 'WA',
    publisher: 'Landgate (SLIP)',
    service: 'SLIP public services — SLIP_Public_Services folder',
    kind: 'arcgis',
    root: 'https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services',
  },
  // ── NT ── NTLIS is the territory's published land-information platform.
  {
    jurisdiction: 'NT',
    publisher: 'Northern Territory Government (NTLIS)',
    service: 'NTLIS ArcGIS service directory',
    kind: 'arcgis',
    root: 'https://www.ntlis.nt.gov.au/arcgis/rest/services',
  },
  {
    jurisdiction: 'NT',
    publisher: 'Northern Territory Government',
    service: 'NT spatial ArcGIS service directory',
    kind: 'arcgis',
    root: 'https://spatial.nt.gov.au/arcgis/rest/services',
  },
];

/**
 * A folder inside a service directory, as a candidate of its own.
 *
 * ArcGIS nests: `/rest/services` may list folders and no services, and the
 * services are one level down. Measured on the first live run, WA answered
 * **0 services across 5 folders** (`Land_Monitor`, `Landgate_Public_Imagery`,
 * `Landgate_Public_Maps`, `SLIP_Public_Services`, `Utilities`) — a catalogue
 * that is plainly reachable and had told us nothing, because the walk stopped
 * at the root. SA answered 131 services across 30 folders, two of them named
 * `PlanSA` and `ePlanning`.
 *
 * The folder NAMES come from the publisher, so this is still discovery: no
 * folder path is typed anywhere in this repository.
 */
export function folderRootFor(candidate: LayerCandidate, folder: string): LayerCandidate {
  return {
    ...candidate,
    service: `${candidate.service} › ${folder}`,
    root: `${candidate.root.replace(/\/+$/, '')}/${folder}`,
  };
}

/**
 * How many folders one directory's walk may ask.
 *
 * Generous on purpose. **An absence is only an absence if the question could
 * have found it** — the rule this programme has now paid for four times — so
 * a ceiling that truncates SA's thirty folders would produce exactly the
 * `organization_list?limit=1000` answered-with-25 fault one publisher along.
 * Where a directory holds more folders than this, the walk is PARTIAL and
 * says so rather than reporting what it happened to reach.
 */
export const FOLDER_WALK_CEILING = 48;

/**
 * Was every folder asked?
 *
 * `catalogueWalkIsComplete`'s rule, applied to a nested directory: a reading
 * assembled from part of a catalogue may not be presented as the catalogue.
 */
export function folderWalkIsComplete(folders: readonly string[]): boolean {
  return folders.length <= FOLDER_WALK_CEILING;
}

/**
 * The candidates for one jurisdiction.
 *
 * Asserted non-empty by spec for all four, because a jurisdiction with no
 * candidate would read as `unreachable` from zero requests — a verdict over
 * nothing, which is the fault `abs-projection-liveness` printed once
 * ("THE PREMISE DOES NOT HOLD" over `flows read 0`).
 */
export function candidatesFor(jurisdiction: LayerCandidate['jurisdiction']): LayerCandidate[] {
  return LAYER_CANDIDATES.filter((c) => c.jurisdiction === jurisdiction);
}

/** The four this module exists for. */
export const UNREAD_JURISDICTIONS: readonly LayerCandidate['jurisdiction'][] = ['SA', 'WA', 'NT', 'ACT'];

// ---------------------------------------------------------------------------
// The licence claims this product ALREADY republishes under
// ---------------------------------------------------------------------------

/**
 * Every licence this repository asserts for a planning layer it republishes
 * into a client's commercial PDF — and none of them had ever been read from
 * the publisher.
 *
 * That gap is the mirror image of `WA_LICENCE_NOTE`. There, a restriction is
 * asserted and nothing is fetched; here, a permission is asserted and
 * everything is. The second is the more consequential of the two, because a
 * wrong restriction costs a report a row and a wrong permission puts somebody
 * else's data in a document that has already been emailed.
 *
 * The first live run found one worth looking at immediately: the ACT
 * Territory Plan service's own `copyrightText` is the three characters
 * **`TP`**, while this repository states `CC BY 4.0` for it.
 *
 * ── What a contradiction may and may not do ──────────────────────────────
 *
 * It may **report**. It may not rewrite the constant, and nothing here
 * does — for a reason that is the whole discipline of this module read
 * backwards. `copyrightText` is one field on one service; a licence is
 * granted by the publisher's terms of use, its open-data catalogue entry or
 * its AGOL item, and a three-character attribution string is silence about
 * terms rather than a denial of them. Downgrading a real CC BY 4.0 grant on
 * the strength of it would be the same error as upgrading an unstated
 * licence to permission — the conservative direction is not "always assume
 * less", it is "never conclude from a field that does not answer the
 * question".
 *
 * So the reading is three-valued and `silent` is its own answer, separate
 * from `contradicted`.
 */
export interface LicenceClaim {
  jurisdiction: PlanningJurisdiction;
  /** What this repository asserts, and where. */
  claim: string;
  claimedIn: string;
  /** The service the claim is made ABOUT, as a root this module composes from. */
  service: string;
  kind: LayerServiceKind;
  root: string;
}

/**
 * The claims, each naming the constant it comes from.
 *
 * The roots are the service ROOTS of the queries already in production — the
 * same hosts, one path segment shorter — so this asks the publisher about the
 * very service the report's rows come from rather than about a neighbour.
 */
export const LICENCE_CLAIMS: readonly LicenceClaim[] = [
  {
    jurisdiction: 'NSW',
    claim: 'CC BY 4.0',
    claimedIn: 'planningConstraints.pure.ts — NSW_LICENCE',
    service: 'NSW Planning Portal — Principal Planning Layers',
    kind: 'arcgis',
    root: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer',
  },
  {
    jurisdiction: 'VIC',
    claim: 'CC BY 4.0',
    claimedIn: 'planningConstraints.pure.ts — VIC_OVERLAY_LICENCE',
    service: 'Vicmap Planning — plan_overlay (WFS)',
    kind: 'wfs',
    root: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
  },
  {
    jurisdiction: 'QLD',
    claim: 'CC BY 4.0',
    claimedIn: 'planningConstraints.pure.ts — QLD_LICENCE',
    service: 'Queensland StatePlanning',
    kind: 'arcgis',
    root: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer',
  },
  {
    jurisdiction: 'TAS',
    claim: 'CC BY 3.0 AU',
    claimedIn: 'planningConstraints.pure.ts — TAS_OVERLAY_LICENCE',
    service: 'theLIST — PlanningOnline',
    kind: 'arcgis',
    root: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PlanningOnline/MapServer',
  },
  {
    jurisdiction: 'ACT',
    claim: 'CC BY 4.0',
    claimedIn: 'planningSources.pure.ts — ACT_ZONING_LICENCE',
    service: 'ACTmapi — Territory Plan Land Use Zones',
    kind: 'arcgis',
    root: 'https://services1.arcgis.com/E5n4f1VY84i0xSjy/arcgis/rest/services/ACTGOV_TP_LAND_USE_ZONE/FeatureServer',
  },
];

/**
 * The metadata request for a claim.
 *
 * Its own composer rather than a `LayerCandidate` cast into shape: a claim
 * and a candidate carry different questions and coercing one into the other
 * is how a probe comes to ask the wrong service.
 */
export function licenceMetadataUrl(claim: LicenceClaim): string {
  const root = claim.root.replace(/\/+$/, '');
  return claim.kind === 'arcgis'
    ? `${root}?f=json`
    : `${root}?service=WFS&request=GetCapabilities`;
}

/** What the publisher's own metadata says about a claim this repo makes. */
export type ClaimVerdict =
  /** The publisher names a licence, and it is an open one. */
  | { kind: 'corroborated'; evidence: string }
  /** The publisher names terms that are NOT open. A real finding. */
  | { kind: 'contradicted'; evidence: string }
  /** The publisher says nothing a reader could rely on. Not a denial. */
  | { kind: 'silent'; evidence: string | null }
  /** The service could not be asked. Says nothing either way. */
  | { kind: 'unasked'; detail: string };

/**
 * Judge a claim against the publisher's own words.
 *
 * `corroborated` is deliberately weaker than it sounds: it means the
 * publisher names AN open licence, not that it names THIS one. Version
 * strings drift (`CC BY 3.0 AU` to `CC BY 4.0`), the field often carries an
 * attribution statement rather than a licence name, and asserting a match on
 * the exact string would report every jurisdiction as contradicting a claim
 * that is substantively right. What matters for a commercial report is
 * whether republication is permitted at all.
 */
export function verifyLicenceClaim(reading: LicenceReading | null, detail?: string): ClaimVerdict {
  if (!reading) return { kind: 'unasked', detail: detail ?? 'the service was not asked' };
  if (reading.kind === 'open') return { kind: 'corroborated', evidence: reading.evidence };
  if (reading.kind === 'restricted') return { kind: 'contradicted', evidence: reading.evidence };
  return { kind: 'silent', evidence: reading.evidence };
}

/**
 * What a claim verdict obliges.
 *
 * Only `contradicted` is a defect, and it is a serious one — a restriction
 * the publisher states while this product republishes. `silent` is the
 * ordinary state of an ArcGIS `copyrightText` and obliges a person to check
 * the publisher's terms of use once, not a build to go red every morning.
 */
export function claimNeedsAttention(verdict: ClaimVerdict): boolean {
  return verdict.kind === 'contradicted';
}
