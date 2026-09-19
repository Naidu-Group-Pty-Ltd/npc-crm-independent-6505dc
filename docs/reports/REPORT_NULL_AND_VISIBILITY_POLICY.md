# Report Null & Visibility Policy

**A raw null must never be client-visible, and an absence must never become a
zero.** Two different failures, and the second is the dangerous one: `null` on a
page looks like a bug and gets reported; `$0` looks like a figure and gets
believed.

Implemented by `_shared/reports/contract/visibilityPolicy.pure.ts` and the
presence gate in `bindingResolver.ts`.

## 1. Three states, never two

| State | Inputs | Renders as |
| --- | --- | --- |
| **absent** | `null`, `undefined`, `''`, whitespace, `NaN`, `Infinity`, a bare technical token | nothing — value, label and row all omitted |
| **zero** | a real, measured `0` (or `false`) | `$0`, `0%`, `0` — it is a finding |
| **value** | everything else | normally |

**Never use truthiness.** `if (value)` collapses `zero` into `absent`, which is
how a property with genuinely zero holding cost loses its cash-flow line.
`presenceOf` is an explicit type-and-value test.

## 2. The formatter fix

Before RF-7.2B the resolver applied filters and *then* checked for null. Every
numeric formatter begins `Number(v)`, and `Number(null)` and `Number('')` are
both `0` — a finite number — so an unknown LVR rendered `0%` and an unknown rent
rendered `$0`.

Presence is now established **before** formatting. Proved by execution:

| Bound value | `\| percent:0` | `\| currency` | plain |
| --- | --- | --- | --- |
| key missing | `""` | `""` | `""` |
| `null` | `""` | `""` | `""` |
| `''` | `""` | `""` | `""` |
| `NaN` | `""` | `""` | `""` |
| **`0`** | **`0%`** | **`$0`** | **`0`** |
| `-5` / `-120` | `-5%` | `-$120` | `-5` |
| `80` / `650` | `80%` | `$650` | `80` |

### The one exemption, and why

Filters that exist to **answer** an absence must still see it:
`fallback`, `default`, `if`, `eq`, `neq`, `exists`, `empty`, `unless`.
Short-circuiting those would take the wrong branch silently rather than printing
nothing. Everything else is a **formatter** and must never see an absence.

This was caught by the existing suite on the first run — `{{missing |
fallback:"n/a"}}` returned `''` — which is the guard working.

## 3. Conditional rendering

| Level | Rule |
| --- | --- |
| **Field** | no client-safe value ⇒ omit the value, the label and the row |
| **Table row** | a row backed only by absent facts is removed |
| **Section** | renders only when it has ≥1 visible field **or** ≥1 material absence to explain; otherwise the heading, card, table and its page break all go |
| **Chart** | an absent point is **dropped**, never floored to zero; below the minimum density the chart is suppressed rather than drawn with invented floors |

Mapping an absent chart point to zero draws a collapse that did not happen — the
visual equivalent of printing `$0`.

## 4. Optional vs material absence

**Optional** — suppress cleanly. `Year Built: null` and `Year Built: Not
available` are both worse than no row at all.

**Material** — explain deliberately:

> **Overall Investment Grade** — Not currently available, insufficient verified
> evidence.

The sentence comes from a **semantic rule**, never a formatter fallback: a
formatter does not know whether the fact it is blanking mattered. A material
field with no statement written is suppressed rather than given a generated one.

## 5. The executive summary is strictest

High-value client-safe information only. Optional absences disappear entirely.
Only a material absence that changes the reader's understanding is stated.

## 6. Leakage detection

`leaksTechnicalToken` matches **whole tokens**, never substrings: `Sunnybank`,
`Nullarbor Road`, `Nanango` and `Annandale` are real Australian place names and
must not be flagged. Six tokens are scanned: `null`, `undefined`, `NaN`, `$NaN`,
`NaN%`, `[object Object]`.

A separate **soft** list (`none`, `n/a`, `-`, `tbc`) flags a page for review but
**never decides presence** — a zoning of "None" is real content, and deleting it
would be a worse fault than showing a dash.
