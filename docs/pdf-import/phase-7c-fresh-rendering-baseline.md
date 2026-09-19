# PDF Import Phase 7C — Fresh Rendering Baseline

## Objective

Capture the current improved PDF-to-template rendering quality as the new working baseline.

This phase validates the full live rendering path:

PDF import → Docling artifacts → async finalization → template editor render → Visual QA → repair audit → manual visual decision.

## Baseline Requirements

Each baseline run should record:

- Import ID
- Template ID
- Source filename
- Imported page count
- Template page count
- Engine version
- Finalization status
- Page context availability
- Visual QA score
- Repair status
- Repair final score
- Repair audit path
- Repair audit object existence
- Manual visual quality decision

## Baseline Categories

Minimum set:

1. Current improved multi-page report
2. Simple one-page PDF
3. Design-heavy one-page PDF
4. Table-heavy PDF/page
5. Image-heavy PDF/page

## Pass Conditions

A baseline passes when:

- Import completes.
- Template page count matches import page count.
- Template editor opens successfully.
- Rendered template visually resembles the source.
- Visual QA runs.
- Repair audit persists when repair is run.
- Repair audit object exists in storage.
- Any known visual issues are documented.

## Fail Conditions

A baseline fails when:

- Import fails.
- Async finalization fails.
- Template does not open.
- Template page count does not match import page count.
- Visual QA cannot run despite available artifacts.
- Repair audit save/reload fails.
- Rendering quality regresses materially from current observed quality.

## Phase 7C Output

Phase 7C is complete when at least one fresh current-engine PDF run is recorded with:

- SQL evidence
- manual visual notes
- baseline decision

