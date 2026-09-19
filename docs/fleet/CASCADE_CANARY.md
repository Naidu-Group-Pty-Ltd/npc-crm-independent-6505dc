# The cascade canary

This file is Mission Control's live-fire test instrument. Every entry below
was a deliberate prime commit whose only purpose is to traverse the whole
cascade pipeline and be measured doing it: webhook capture, event creation,
drain claim, engine delivery, one pull request per clone, clone CI, the
merge drain's green-only landing, the delivered-head sync stamp, the drift
scan's independent re-measure, and the redeploy that follows a landed merge.

Two rules make it an instrument rather than litter. **The entry is the
payload** — a drill writes its own record here, inert by construction (no
imports, no code, no CI surface, excluded on no clone), so the instrument
documents itself and the repository carries the history of every rehearsal.
And **the full drill is two pushes to main, seconds apart** — the second
must fold into the first's pending carrier, recreating the exact
folded-carrier condition under which an event's provenance and its pass's
delivery diverge, so a full drill re-proves that the fleet's sync pointers
record what was DELIVERED, never what created the event. A single-push
drill exercises every lane but the fold; prime's ordinary merge traffic
exercises the fold daily.

## Drills

### 2026-09-16 · Drill 1 — single-push, full pipeline, on the delivered-head stamp

Fired the day the folded-carrier misreading was found and fixed (Mission
Control PR #189): npc-test-76b3b3 had merged a cascade carrying
prime@7674f46's tree and been stamped with its carrier's provenance,
84 commits earlier, reading "84 commits behind" while byte-identical
outside its designed exclusions. This drill's merge is the first prime
change to cross the pipeline since that fix: expected from the ledger is
one commit event, a three-clone delivery, `delivered_sha` on every result
row naming the delivered head, and every clone's pointer stamped to it.
