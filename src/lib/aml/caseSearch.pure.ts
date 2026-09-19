/**
 * How a customer is found — one rule, wherever they are looked for.
 *
 * The Compliance Passport register has always searched a customer by name or
 * by their case reference, which is the Passport's own number. The AUSTRAC
 * draft's customer field offered a plain drop-down instead: a list an
 * operator scrolls, in whatever order the server returned it, with no way to
 * type a name and no way to reach a customer by the reference they were
 * given. On a tenant with two hundred open cases that is not a picker, it is
 * a haystack.
 *
 * Both surfaces filter through this now. A customer found one way and not
 * the other is how an operator concludes a case does not exist.
 *
 * ── Two things it does that a substring match does not ────────────────
 * **Every word has to match, and they may match different fields.** Typing
 * "rugesh 00005" finds the customer whose name carries one and whose
 * reference carries the other — which is how somebody types when they are
 * reading a reference off one screen and a name off another.
 *
 * **A reference matches with or without its punctuation.** `AML-2026-00005`
 * is found by `aml2026`, by `00005`, and by `AML 2026 00005`, because a
 * reference is copied, re-typed and read aloud, and the hyphens are not part
 * of what anybody remembers.
 */

export interface SearchableCase {
  subject_display_name?: string | null;
  case_reference?: string | null;
}

/** Lower-cased, with every non-alphanumeric character removed. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** True when every word in `query` appears in the name or the reference. */
export function matchesCaseSearch(row: SearchableCase, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const name = (row.subject_display_name ?? "").toLowerCase();
  const reference = (row.case_reference ?? "").toLowerCase();
  const squashedReference = squash(reference);

  return words.every((word) => {
    if (name.includes(word)) return true;
    if (reference.includes(word)) return true;
    const squashedWord = squash(word);
    return squashedWord.length > 0 && squashedReference.includes(squashedWord);
  });
}

/** `cases` filtered by `query`, in the order they were given. */
export function filterCases<T extends SearchableCase>(cases: T[], query: string): T[] {
  if (!query.trim()) return cases;
  return cases.filter((c) => matchesCaseSearch(c, query));
}

/** How a customer reads in a list: the name, then the Passport reference. */
export function caseSearchLabel(row: SearchableCase): string {
  const name = (row.subject_display_name ?? "").trim() || "Unnamed customer";
  const reference = (row.case_reference ?? "").trim();
  return reference ? `${name} — ${reference}` : name;
}
