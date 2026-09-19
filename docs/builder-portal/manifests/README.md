# Extraction manifests

Each file here is one execution of `npm run builder:manifest` against a live
database: exact row counts for every builder table, the storage corpus, the
six entanglements sized by live rows, the FK boundary with its delete rules,
and the soft-delete debris Phase 4 has to reconcile before it copies anything.

They are committed because the **series** is the point. The extraction plan's
rule is to re-measure before every destructive phase — the dataset grows while
the work happens (stock-list upload testing is live), and two production
snapshots forty minutes apart have already disagreed by an order of magnitude
once. A single manifest says what was true at one instant; two say what is
moving and how fast.

```bash
# measure, and write a manifest into this directory
npm run builder:manifest -- --db-url "$PROD_DB_URL" --phase 4

# measure again later and show what moved since the last one
npm run builder:manifest -- --db-url "$PROD_DB_URL" --phase 4 --compare latest

# as a gate: fail if the SHAPE moved (new table, new boundary edge, new migration)
npm run builder:manifest -- --db-url "$PROD_DB_URL" --compare latest --fail-on-drift
```

Three things to know when reading one.

**A `null` reading is not a zero.** Every number is either a value that was
actually read or `{"measured": false, "reason": …}`. A manifest carrying any
failure exits non-zero and says it must not be used to authorise a copy or a
delete, because a count that silently failed and printed `0` is
indistinguishable from a table that is genuinely empty — and the difference is
somebody's production data.

**The boundary is read from `pg_constraint`, never from filenames.** It is what
the Phase 7 decommission migration is written from, and the delete rules are
the load-bearing part: the CASCADE edges have to have their constraints dropped
before any table is, or dropping `builder_organisations` takes the Solicitor
cutover's state with it. An edge the plan does not name is reported as
UNCLASSIFIED and fails the run — a new entanglement means the plan is stale,
and that has to be loud.

**Row growth is not drift.** `--fail-on-drift` fires on the shape moving, not
the corpus growing. Growth is what you came to measure.
