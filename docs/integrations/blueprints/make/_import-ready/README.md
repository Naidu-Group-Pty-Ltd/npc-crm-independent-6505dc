# Import-ready blueprints — the six that must go through the Make UI

Six of the 40 exported scenarios cannot be created through the Make API from this
session. These files are those six, already rewritten for the **new** account, so
importing them is a file upload and nothing else.

They are *derived* files. The full-fidelity exports remain in the directories
beside this one and are still the record; nothing here replaces them.

## Why these six and not the other 34

`scenarios_create` takes the blueprint as an inline argument, which means every
byte has to be retyped by whatever is driving the API. For 34 scenarios that was
fine. For these six it is not, and for two different reasons:

| Scenario | Size | Reason |
| --- | ---: | --- |
| Aurixa Waitlist Stage 1 | 42 KB | 36.5 KB of it is one HTML email body |
| Aurixa Waitlist Stage 2 | 43 KB | same |
| Aurixa Waitlist Stage 3 | 43 KB | same |
| NPC Email 1 | 75 KB | too large to pass inline at all |
| NPC Email 1 New | 129 KB | same |
| NPC Email 2 | 134 KB | same |

The three Aurixa bodies are 710 lines of branded HTML wrapped in
`{{escapeJSON("…")}}`, where every attribute quote is doubled (`lang=""en""`).
That construction is unforgiving: a single dropped character yields either a
malformed Microsoft Graph payload or a corrupted email to an applicant, and
neither failure is visible until it reaches somebody. Retyping ~110 KB of it
by hand to save a file upload is the wrong trade. Make's own **Import Blueprint**
reads these files directly and copies them byte for byte.

## What has already been done to these files

Each file here is the export with three changes applied, and nothing else:

1. **Slimmed** — `metadata.expect`, `interface` and `restore` removed. Make
   regenerates all three from the app definition on import.
2. **Connections remapped** to the new account's ids, where the new account holds
   an equivalent connection. Airtable is wired in all three Aurixa scenarios
   (`10496787`).
3. **Webhook ids replaced** with hooks already minted in team `2731020`, so the
   imported scenario binds to a live us2 URL instead of a dead eu2 one:

   | Scenario | New hook | URL |
   | --- | ---: | --- |
   | Aurixa Waitlist Stage 1 | 2705081 | `https://hook.us2.make.com/eku2vhixkfc8uw3ua43a6apuri9x45fc` |
   | Aurixa Waitlist Stage 2 | 2705082 | `https://hook.us2.make.com/xqat3ism55qanlbhu67qqx4t31yvcy6h` |
   | Aurixa Waitlist Stage 3 | 2705083 | `https://hook.us2.make.com/gu22njaaq9smhe87feuflr4aksd7wnnp` |

   The three NPC Email scenarios are not webhook-triggered and need no hook.

`{{SECRET:...}}` placeholders are left in place deliberately — those credentials
are being rotated as part of this migration, so writing the old values into a
fresh account would plant a key that is about to be revoked.

## How to import

1. Make → **Scenarios** → **Create a new scenario** → ⋯ menu → **Import Blueprint**.
2. Upload the `.json` file.
3. Save. The scenario lands **inactive**. Leave it that way until step 4.
4. Open each module showing *Add a connection* and attach one:

   | Scenario | Modules still needing a connection |
   | --- | --- |
   | Aurixa Waitlist Stage 1, 2, 3 | the two `HTTP > Make a request` modules — they call `graph.microsoft.com` with `authenticationType: oAuth` and need an **HTTP OAuth** connection against Microsoft Graph |
   | NPC Email 1 / 1 New / 2 | **Google Restricted** (Gmail/Drive scopes) |

5. Replace every `{{SECRET:*}}` placeholder with the freshly rotated value.
6. Only then activate.

## Two things to check before activating the Aurixa three

Both were found in the source during this migration and are carried across
unchanged, because a migration that silently edits behaviour is worse than one
that reports it:

- ~~The Airtable base id in these blueprints is still `apptyShYE0yzL4IGB`.~~
  **Done 2026-08-18.** All six now point at the migrated base
  `appFNPL7iYiuQyHAO`: 6 table ids and 576 field references rewritten via
  [`_airtable-id-map.json`](./_airtable-id-map.json). Only id tokens changed —
  masking every `app…`/`tbl…`/`fld…` token makes before and after
  byte-identical, so the HTML email bodies are provably untouched. How the map
  was built and validated is in
  [`../../../make/MAKE_CUTOVER.md`](../../../make/MAKE_CUTOVER.md).
- `Aurixa Lead Capture`, the Airtable automation these feed, has a busy-wait
  loop, a `Math.random()` token gating the Stage-2 questionnaire URL, and four
  recipient addresses carrying a leading space. See
  [`../../airtable/npc-emails/automations/README.md`](../../airtable/npc-emails/automations/README.md).
