# Which matters a solicitor may see

Every Solicitor Portal surface that shows more than one matter reads one list:
`readAccessibleMatterIds` in `supabase/functions/_shared/solicitorPortalAuth.ts`,
and its throwing wrapper `listAccessibleMatterIds`. Six call sites in five
functions use it:

- `solicitor-portal-matters`: the matter list, its stats, the flagged strip and
  the upcoming dates;
- `solicitor-portal-documents`: the document list;
- `solicitor-portal-comms`: the thread list and the notification inbox;
- `solicitor-portal-compliance`: the audit feed and the conflict search;
- `solicitor-portal-intelligence`: the pipeline board, the portfolio KPIs and
  the at-risk list.

A single matter is opened by a different pair of functions,
`resolveSolicitorMatterAccess` and then `resolveMatterPermissions`. **The list
must name exactly the matters that pair opens.** Measured on 28 Sep 2026, it
did not, and four surfaces had failed outright.

## What was wrong

**1. Two operations could not run.** A merge on 30 Jul 2026 (`cea3d88`)
deleted `assignedClientIds` and the import of `resolveClientPermissions` from
three functions, and kept the lines that used them.

- In `solicitor-portal-comms`, every notification list, summary, mark-read and
  mark-all-read threw a `ReferenceError` and answered 500.
- In `solicitor-portal-compliance`, `conflict_run` threw on every call that had
  anything to search for. The one call that succeeded was a matter with no
  parties. It searched nothing and recorded **clear**.
- In `solicitor-portal-matters`, the same names sat in a helper nothing called.

The specs that asserted those lines went on passing. They read the source
rather than running it, and no workflow ran them anyway.

**2. The portfolio was empty for every practice on per-matter grants.**
[WP-16 §2](./WP16_GATE_WIRING.md) ANDed a per-client permission matrix onto the
portfolio reads. The per-matter grants (`cutover`) are the default mode for
every practice (`cross_portal_feature_definitions`), and they need no client
assignment. So the board, the KPIs and the at-risk list returned nothing for
every solicitor they govern.

**3. The list and the single-matter check read different switches.** The
single-matter check follows the practice's own rollout mode
(`resolve_cross_portal_feature_mode(firm, 'solicitor_matter_access_v2')`). The
list read the `SOLICITOR_MATTER_ACCESS_V1` environment flag alone. A practice in
`off`, `shadow`, `dual_read` or `rollback` had its matters opened through client
assignments, while its list read per-matter grants.

**4. The legacy path checked no permission.** It listed every matter of every
assigned client. WP-16 found this and fixed it in one caller rather than in the
list, so the other four functions kept the hole.

**5. Reads were capped, and failures read as absence.** Grants and assignments
were each read in one unpaged request, which PostgREST caps at 1,000 rows. The
`.in()` filters were unchunked. Every read discarded its `error`, so a failed
read produced an empty list, and an empty list cannot be told apart from a
solicitor with no matters.

## The rules now

- **One decision, in one place.** `readAccessibleMatterIds(supabase, user,
  firm, keys)` does four things:
  - it follows the practice's mode through the same reader the single-matter
    check uses;
  - it passes every grant (`cutover`) or assignment (any other mode) through
    the permission matrix, and needs VIEW on every key it is asked for;
  - it keeps the practice boundary on the matter rows;
  - it reads in pages of 1,000 and chunks of 100.
- **The list is proved against the single-matter check, not described.**
  `_shared/solicitorPortalAuth.test.ts` generates 400 practices, with every
  mode, flag value, tri-state matrix, validity window, revoked row and another
  solicitor's row. It asserts that the list names exactly the matters the
  single-matter check opens.
- **A read that failed is not an empty list.** `readAccessibleMatterIds`
  returns `{ ok: false, error }`, and `listAccessibleMatterIds` throws, so the
  handler answers 500 rather than drawing an empty board. The conflict search
  phrases its own failure from the result.
- **Keys are ANDed.** The conflict search asks for `['matters', 'parties']`,
  because a match discloses another matter's party.

## The conflict search

The judgement lives in `_shared/conflictSearch.pure.ts`, and
`conflictSearch.pure.test.ts` runs it. Three rules:

- **Both sides are normalised by one function** (`conflictKey`). A term was
  stripped of `%_(),` and then ILIKE-matched against the raw column, so a term
  copied from a party ("ACME (Aust) Pty Ltd") could not find that party.
- **A term is data, never syntax.** Parties are read in pages and matched in
  code. No term is spliced into a filter.
- **A search over nothing is not a clearance.** Nothing to search for answers
  422 `NO_TERMS` and records nothing. If there is no other matter in scope, the
  outcome is `pending`, which a person must decide, never `clear`. The screen
  names how many matters were searched.

**The scope is deliberately not the whole practice.** Party data on a matter
this solicitor cannot open is not theirs to read, and returning it as a match
would disclose it. Whether a practice-wide check should report hits it cannot
show is a decision for the owner.

## What changed in behaviour

- A failed access read now answers **500** in all five functions, where it used
  to answer with an empty list.
- A solicitor on per-matter grants sees their portfolio.
- On a practice still on client assignments, a client whose permissions deny
  the key a surface asks for (`matters`, `messages`, `audit`,
  `critical_dates`) no longer appears on that surface.
- A conflict check with nothing to search for is refused, not cleared.

## How it is held

- `_shared/solicitorPortalAuth.test.ts`: the list equals the single-matter
  check over 400 practices. It also covers a legacy denial, the mode read, the
  paging and chunking, every failed read, and an empty key set. Ten mutations
  of the list were each caught.
- `_shared/conflictSearch.pure.test.ts`: 14 cases, eight mutations caught.
- `src/security/solicitorPortal*.security.test.ts`: the wiring in each
  function. An absence check reads the code with its comments blanked
  (`src/security/sourceCode.ts`), because the comments record the defect by
  name.
- `scripts/security/check-solicitor-intelligence-authz.mjs`: the board reads
  through the list, and the list applies the matrix on both paths. Three
  negative cases in `check-security-gate-negatives.mjs` prove it bites.
- CI runs `src/security` and `tests/solicitor-portal` now. Neither had ever run
  in a workflow.

## For the clones

The clones hold older copies of these functions, and the fixes reach them on
the next cascade. `resolveClientPermissions` and `listAssignedClientIds` stay
exported with no caller in the prime, because an older copy imports them until
the cascade replaces it. Neither is an access list. Do not build one on them.
