/**
 * Name matching and MRZ validation — pure functions, no I/O, no Deno APIs.
 *
 * Imported by the edge functions AND unit-tested directly from vitest. Keeping
 * it dependency-free is deliberate: this is the part of the zero-cost stack
 * that replaces a commercial screening vendor's matching engine, so it has to
 * be testable in isolation rather than only observable through the database.
 *
 * Design position (docs/aml/kyc-zero-cost-solution.md §3.3): we do not have a
 * vendor's alias and transliteration corpus, so we bias towards RECALL. Over-
 * referring costs a reviewer a minute; under-matching is a compliance failure.
 */

/* ───────────────────────────── name normalisation ───────────────────────── */

/**
 * Latin-range transliteration for the accented forms that actually appear in
 * sanctions lists. Not a general Unicode romaniser — NFD stripping handles
 * most of it; this table covers the characters NFD does not decompose.
 */
const TRANSLITERATION: Record<string, string> = {
  æ: "ae", Æ: "ae", ø: "o", Ø: "o", å: "a", Å: "a",
  ß: "ss", þ: "th", Þ: "th", ð: "d", Ð: "d",
  đ: "d", Đ: "d", ł: "l", Ł: "l", ŧ: "t", ħ: "h",
  ı: "i", ő: "o", ű: "u", œ: "oe", Œ: "oe",
};

/**
 * Titles and honorifics carry no identifying signal and actively hurt matching
 * — "Mr John Smith" must match a list entry of "SMITH, John".
 */
const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "sir", "dame",
  "lord", "lady", "rev", "reverend", "hon", "honourable", "honorable",
  "sheikh", "sheik", "shaikh", "haji", "hajji", "sayyid", "sayed",
  "general", "gen", "col", "colonel", "maj", "major", "capt", "captain",
  "lt", "lieutenant", "sgt", "sergeant", "adm", "admiral", "brig", "brigadier",
  "president", "minister", "senator", "governor", "ambassador",
]);

/**
 * Entity suffixes. Stripped so "Acme Holdings Pty Ltd" matches "ACME HOLDINGS".
 */
const ENTITY_SUFFIXES = new Set([
  "pty", "ltd", "limited", "llc", "lp", "llp", "inc", "incorporated",
  "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "sa", "nv",
  "bv", "srl", "spa", "oyj", "ab", "as", "aps", "kk", "pte", "sdn", "bhd",
  "trust", "trustee", "trustees", "holdings", "group", "international",
]);

/**
 * Particles that list publishers include or omit inconsistently.
 *
 * Deliberately EXCLUDES "abd" and "abu". Those are name-forming rather than
 * connective — "Abd al-Rahman" and "Abdul Rahman" are the same person, and
 * dropping the "abd" leaves a single token ("rahman"), which the one-token
 * damping then pushes below the referral threshold. Keeping them lets the
 * fuzzy pass score abd↔abdul directly, which is what actually matches.
 */
const PARTICLES = new Set([
  "al", "el", "bin", "ibn", "bint", "van", "von", "de", "del",
  "della", "di", "da", "dos", "das", "du", "la", "le", "les", "ter", "ten",
  "op", "af", "av", "san", "santa", "st",
]);

/**
 * Reduce a name to comparable tokens.
 *
 * Steps: lowercase → transliterate → strip diacritics → drop punctuation →
 * collapse whitespace → remove honorifics, entity suffixes and particles.
 *
 * Particles are removed rather than kept because publishers are inconsistent
 * about them ("Abd al-Rahman" vs "Abdal Rahman" vs "Abdalrahman"). Dropping
 * them on BOTH sides makes the comparison symmetric, which is what matters.
 */
export function normaliseName(input: string): string[] {
  if (!input) return [];
  let s = String(input).toLowerCase();

  s = s.replace(/[æÆøØåÅßþÞðÐđĐłŁŧħıőűœŒ]/g, (c) => TRANSLITERATION[c] ?? c);
  // NFD then strip combining marks: é → e, ü → u.
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  // Hyphens and apostrophes join name parts; treat as separators, not letters.
  s = s.replace(/[''`´]/g, "").replace(/[^a-z0-9]+/g, " ");

  return s.split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t))
    .filter((t) => !ENTITY_SUFFIXES.has(t))
    .filter((t) => !PARTICLES.has(t))
    // Single letters are initials — they carry too little signal to match on
    // but would inflate a token-overlap score.
    .filter((t) => t.length > 1);
}

/** Canonical string form: sorted tokens, so word order cannot defeat a match. */
export function normalisedKey(input: string): string {
  return normaliseName(input).slice().sort().join(" ");
}

/* ─────────────────────────── similarity primitives ──────────────────────── */

/** Levenshtein distance, iterative with a single row. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** Normalised edit similarity in [0,1]. */
export function editSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

/**
 * Jaro-Winkler. Included alongside Levenshtein because it is markedly better
 * on transposed and truncated forenames, which is the dominant error mode in
 * transliterated sanctions data.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array(a.length).fill(false);
  const bMatched = new Array(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / a.length + matches / b.length +
    (matches - transpositions) / matches) / 3;

  // Winkler prefix bonus, capped at 4 characters.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/* ─────────────────────────────── name scoring ───────────────────────────── */

export interface NameScore {
  /** Overall confidence in [0,1]. */
  score: number;
  /** How the score was reached — surfaced to the reviewer, never hidden. */
  basis: "exact" | "token_subset" | "token_overlap" | "fuzzy" | "none";
  matchedTokens: string[];
}

/**
 * Score two names against each other.
 *
 * Token-based rather than whole-string, because list entries reorder names
 * ("SMITH, John Michael" vs "John Smith") and include or omit middle names
 * freely. A pure string distance handles neither.
 */
export function scoreNames(query: string, candidate: string): NameScore {
  const q = normaliseName(query);
  const c = normaliseName(candidate);
  if (q.length === 0 || c.length === 0) {
    return { score: 0, basis: "none", matchedTokens: [] };
  }

  const qSet = new Set(q);
  const cSet = new Set(c);

  if (normalisedKey(query) === normalisedKey(candidate)) {
    return { score: 1, basis: "exact", matchedTokens: [...qSet] };
  }

  const exactShared = [...qSet].filter((t) => cSet.has(t));

  // One name being a complete subset of the other is a strong signal: it is
  // the "middle name omitted" case, not a coincidence.
  const smaller = qSet.size <= cSet.size ? qSet : cSet;
  const larger = qSet.size <= cSet.size ? cSet : qSet;
  const isSubset = smaller.size > 0 && [...smaller].every((t) => larger.has(t));
  if (isSubset) {
    // Two shared tokens (given + family) is meaningful; one is not.
    const confidence = smaller.size >= 2 ? 0.94 : 0.72;
    return { score: confidence, basis: "token_subset", matchedTokens: exactShared };
  }

  // Pair every query token with its best candidate token, allowing fuzzy hits
  // so a single misspelling does not zero out the whole comparison.
  let matchedWeight = 0;
  const matchedTokens: string[] = [];
  for (const qt of qSet) {
    let best = 0;
    let bestToken = "";
    for (const ct of cSet) {
      const sim = Math.max(jaroWinkler(qt, ct), editSimilarity(qt, ct));
      if (sim > best) { best = sim; bestToken = ct; }
    }
    // 0.85 keeps "mohammed"/"muhammad" but rejects "smith"/"smyth-jones".
    if (best >= 0.85) {
      matchedWeight += best;
      matchedTokens.push(bestToken);
    }
  }

  if (matchedWeight === 0) return { score: 0, basis: "none", matchedTokens: [] };

  // Denominator is the SMALLER token count. Using the larger would punish a
  // list entry that carries four names against our two, which is common and
  // is exactly the case we must not miss.
  const denom = Math.min(qSet.size, cSet.size);
  const raw = matchedWeight / denom;

  // A single matched token is weak however well it matches — a common surname
  // alone must not reach the referral threshold on its own.
  const damped = matchedTokens.length === 1 && denom > 1 ? raw * 0.6 : raw;

  return {
    score: Math.min(1, Math.round(damped * 1000) / 1000),
    basis: exactShared.length > 0 ? "token_overlap" : "fuzzy",
    matchedTokens,
  };
}

/* ──────────────────────────── date-of-birth logic ───────────────────────── */

export type DobAgreement = "match" | "year_match" | "mismatch" | "unknown";

/**
 * Compare dates of birth tolerantly. Sanctions lists carry partial dates
 * ("1961", "1961-00-00", "circa 1961") far more often than full ones.
 */
export function compareDob(a?: string | null, b?: string | null): DobAgreement {
  if (!a || !b) return "unknown";
  const norm = (v: string) => String(v).trim().replace(/[^0-9]/g, "");
  const A = norm(a), B = norm(b);
  if (!A || !B) return "unknown";

  const yearOf = (v: string) => {
    const m = String(v).match(/(1[89]\d{2}|20\d{2})/);
    return m ? m[1] : null;
  };
  const ya = yearOf(a), yb = yearOf(b);

  if (A.length >= 8 && B.length >= 8) {
    return A.slice(0, 8) === B.slice(0, 8) ? "match" : (ya && yb && ya === yb ? "year_match" : "mismatch");
  }
  if (ya && yb) return ya === yb ? "year_match" : "mismatch";
  return "unknown";
}

/**
 * Adjust a name score using date of birth.
 *
 * A DOB mismatch DAMPENS but never zeroes: list DOBs are frequently wrong or
 * refer to a different transliteration of the same person. Zeroing on a DOB
 * mismatch is how real sanctions hits get missed.
 */
export function applyDobAdjustment(nameScore: number, agreement: DobAgreement): number {
  switch (agreement) {
    case "match": return Math.min(1, nameScore + 0.08);
    case "year_match": return Math.min(1, nameScore + 0.04);
    case "mismatch": return nameScore * 0.75;
    case "unknown": return nameScore;
  }
}

/* ────────────────────────────── screening entry ─────────────────────────── */

export interface ScreeningCandidate {
  externalId: string;
  listCode: string;
  primaryName: string;
  aliases?: string[];
  dateOfBirth?: string | null;
  entryType?: string;
  listingReference?: string | null;
  detail?: Record<string, unknown>;
}

export interface ScreeningHit {
  externalId: string;
  listCode: string;
  matchedName: string;
  score: number;
  basis: NameScore["basis"];
  dobAgreement: DobAgreement;
  matchedTokens: string[];
  listingReference?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Default referral threshold — deliberately low.
 *
 * We are trading reviewer time for recall on purpose. Raising this number
 * without measuring the false-negative cost is exactly the mistake that makes
 * a home-built screening layer worse than useless.
 */
export const DEFAULT_MATCH_THRESHOLD = 0.72;

/** Score a subject against candidates, best alias wins per entry. */
export function screenSubject(
  subject: { name: string; dateOfBirth?: string | null },
  candidates: ScreeningCandidate[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): ScreeningHit[] {
  const hits: ScreeningHit[] = [];

  for (const cand of candidates) {
    const names = [cand.primaryName, ...(cand.aliases ?? [])].filter(Boolean);
    let best: NameScore = { score: 0, basis: "none", matchedTokens: [] };
    let bestName = cand.primaryName;

    for (const n of names) {
      const s = scoreNames(subject.name, n);
      if (s.score > best.score) { best = s; bestName = n; }
    }
    if (best.score === 0) continue;

    const dob = compareDob(subject.dateOfBirth, cand.dateOfBirth);
    const adjusted = Math.round(applyDobAdjustment(best.score, dob) * 1000) / 1000;
    if (adjusted < threshold) continue;

    hits.push({
      externalId: cand.externalId,
      listCode: cand.listCode,
      matchedName: bestName,
      score: adjusted,
      basis: best.basis,
      dobAgreement: dob,
      matchedTokens: best.matchedTokens,
      listingReference: cand.listingReference ?? null,
      detail: cand.detail,
    });
  }

  return hits.sort((a, b) => b.score - a.score);
}

/* ──────────────────────────────── MRZ (ICAO 9303) ───────────────────────── */

/**
 * ICAO 9303 check-digit weighting: repeating 7-3-1 over the field.
 * A failed check digit is a strong, free forgery signal — the single
 * highest-value automated check in the zero-cost stack.
 */
const MRZ_WEIGHTS = [7, 3, 1];

function mrzCharValue(ch: string): number {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55; // A=10
  if (ch === "<") return 0;
  return -1; // invalid character
}

export function mrzCheckDigit(field: string): number | null {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const v = mrzCharValue(field[i]);
    if (v < 0) return null;
    sum += v * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}

export function verifyMrzField(field: string, expected: string): boolean {
  if (!/^[0-9]$/.test(expected)) return false;
  const computed = mrzCheckDigit(field);
  return computed !== null && computed === Number(expected);
}

export interface MrzParseResult {
  valid: boolean;
  format: "TD1" | "TD2" | "TD3" | "unknown";
  fields: {
    documentType?: string;
    issuingState?: string;
    documentNumber?: string;
    surname?: string;
    givenNames?: string;
    nationality?: string;
    dateOfBirth?: string;   // YYMMDD as printed
    sex?: string;
    dateOfExpiry?: string;  // YYMMDD as printed
  };
  checks: Array<{ field: string; passed: boolean }>;
  errors: string[];
}

function parseNameField(raw: string): { surname: string; givenNames: string } {
  const [sur = "", given = ""] = raw.split("<<");
  return {
    surname: sur.replace(/</g, " ").trim(),
    givenNames: given.replace(/</g, " ").trim(),
  };
}

/**
 * Parse and validate a TD3 (passport, 2×44) or TD2 (2×36) machine-readable
 * zone. TD1 (3×30) is recognised but only structurally validated — Australian
 * driver licences do not carry an ICAO MRZ, so TD1 is rare in our flow.
 */
export function parseMrz(input: string): MrzParseResult {
  const lines = String(input || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ""))
    .filter(Boolean);

  const errors: string[] = [];
  const checks: MrzParseResult["checks"] = [];

  if (lines.length < 2) {
    return { valid: false, format: "unknown", fields: {}, checks, errors: ["mrz_not_found"] };
  }

  const len = lines[0].length;
  const format: MrzParseResult["format"] =
    lines.length === 2 && len === 44 ? "TD3"
    : lines.length === 2 && len === 36 ? "TD2"
    : lines.length === 3 && len === 30 ? "TD1"
    : "unknown";

  if (format === "unknown") {
    return {
      valid: false, format, fields: {}, checks,
      errors: [`unrecognised_mrz_shape_${lines.length}x${len}`],
    };
  }
  if (format === "TD1") {
    return { valid: false, format, fields: {}, checks, errors: ["td1_not_supported"] };
  }

  const [l1, l2] = lines;
  const name = parseNameField(l1.slice(5));

  const documentNumber = l2.slice(0, 9);
  const docCheck = l2[9];
  const nationality = l2.slice(10, 13);
  const dateOfBirth = l2.slice(13, 19);
  const dobCheck = l2[19];
  const sex = l2[20];
  const dateOfExpiry = l2.slice(21, 27);
  const expCheck = l2[27];

  const push = (field: string, value: string, expected: string) => {
    const ok = verifyMrzField(value, expected);
    checks.push({ field, passed: ok });
    if (!ok) errors.push(`check_digit_failed_${field}`);
  };

  push("document_number", documentNumber, docCheck);
  push("date_of_birth", dateOfBirth, dobCheck);
  push("date_of_expiry", dateOfExpiry, expCheck);

  // TD3 carries a composite check digit over several fields; TD2's layout
  // differs, so only validate it where the offsets are known to be right.
  if (format === "TD3") {
    const personal = l2.slice(28, 42);
    const personalCheck = l2[42];
    // The personal-number field is optional; publishers fill it with '<' and
    // set the check digit to '<' or '0'. Only validate when it carries data.
    if (personal.replace(/</g, "").length > 0) {
      push("personal_number", personal, personalCheck);
    }
    const composite =
      l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);
    push("composite", composite, l2[43]);
  }

  return {
    valid: errors.length === 0,
    format,
    fields: {
      documentType: l1.slice(0, 2).replace(/</g, ""),
      issuingState: l1.slice(2, 5).replace(/</g, ""),
      documentNumber: documentNumber.replace(/</g, ""),
      surname: name.surname,
      givenNames: name.givenNames,
      nationality: nationality.replace(/</g, ""),
      dateOfBirth,
      sex: sex === "<" ? "" : sex,
      dateOfExpiry,
    },
    checks,
    errors,
  };
}

/** YYMMDD → ISO date. Window rule per ICAO practice for birth dates. */
export function mrzDateToIso(yymmdd: string, kind: "birth" | "expiry" = "birth"): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  // Birth dates cannot be in the future; expiry dates are always near-future.
  const currentYY = new Date().getUTCFullYear() % 100;
  const century = kind === "birth" ? (yy > currentYY ? 1900 : 2000) : 2000;
  return `${century + yy}-${mm}-${dd}`;
}
