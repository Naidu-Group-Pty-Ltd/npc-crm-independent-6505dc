# "Can I speak to a human?" — why it never worked, and what it took

Angela is the entry assistant on NPC's inbound line. A caller who asked her
plainly for a person did not get one, on any call, ever. The `transfer_to_human`
tool was bound, its hook was live, the scenario behind it worked, and the whole
downstream chain had been proven by hand more than once. The only leg never
exercised was **Angela deciding to invoke it** — and when it was finally
exercised, it failed.

It failed for **two independent reasons, each sufficient on its own**, and the
second one only became visible once the first was fixed.

## Defect 1 — four places told her not to transfer

`transfer_to_human` has a 5,400-character protocol in Angela's prompt at
character 35,468: when to use it, when not to, a confirmation script, a failure
path, priority rules. It is thorough and it is correct.

Everything a model reads *before* it points the other way.

| where | what it said |
|---|---|
| **§0 Role Priority Summary** (char 171) | Five numbered duties. Transferring to a person is **not one of them**. This is the first thing in the prompt and it frames the rest. |
| **§8 When Caller Asks About Next Steps** (21,790) | Claims *"Can I speak to someone?"* as a next-steps signal and answers it with a scripted discovery-call explanation. |
| **§9 When Caller Wants a Human** (22,354) | Titled with the exact trigger. Tells her to ask *"are you looking for an initial discovery call, a strategy session, or something finance-related?"* and route to another **assistant**. Never mentions `transfer_to_human`. |
| **§15 Absolute Rules** (40,887) | ~60 bullets, none about transferring to a person. |

The one statement that resolves the conflict — *"If the caller explicitly
requests a human, this request overrides … additional qualification questions"* —
sits at character 39,257, **17,000 characters after §9**, and does not name §9.

Angela was the **only one of the fifteen NPC assistants carrying §9**, and she
is the squad's entry member. Every inbound caller met it.

**Fix:** §0 gains a sixth duty and an explicit precedence statement; §8 disowns
the phrase and points at §9; §9 is rewritten into 9.1 (asked for a person →
transfer), 9.2 (asked about a topic → route, keeping the original script
verbatim), 9.3 (genuinely ambiguous → one question, transfer offered first) and
9.4 (the three "do not promise" lines, unchanged); §15 gains three prohibitions
and one obligation.

**Nothing was removed.** The routing path, the qualifying question and every
safety rule survive word for word — §9.2 is the old §9, relocated behind the
test that decides which case it is.

## Defect 2 — the tool call waited for a turn that never comes

With Defect 1 fixed, the first live test produced this:

```
AI:   Hi there. Angela from NPC Services speaking. How can I help you today?
User: Hi there. Can I please speak to a human?
AI:   Absolutely. I'll try to get you through to someone from the team now.
```

That is the protocol's confirmation script, verbatim. Then nothing. No tool
call. `endedReason: silence-timed-out`. No leg to the mobile.

The cause is the protocol's own **Tool Invocation Rule**:

> After the spoken transfer confirmation, the assistant's next turn MUST be
> tool-only. In that next turn: call `transfer_to_human` …

In a voice loop the assistant gets another turn **only when the caller speaks**.
A caller who has just been told they are being put through has no reason to say
anything — so the tool call sits behind a turn that never arrives, and the line
goes quiet until it times out.

Four places in the prompt said it. All four now put the sentence and the tool
call in the **same turn**, and state the priority explicitly: the tool call is
the half that must never be missed.

That ordering is deliberate and was earned. The intermediate version said only
"same turn", and the model resolved it the other way — it placed the call and
skipped the sentence, transferring the caller in silence. Naming which half
matters more is what produced both.

## The ablation

Three live calls, same script (*"Hi there. Can I please speak to a human?"*),
judged on the Twilio leg to the escalation mobile rather than on the phone
sounding fine.

| version | said the sentence | called the tool | leg to the mobile |
|---|---|---|---|
| §9 fix only | yes | **no** — `silence-timed-out` | **none** |
| \+ same-turn rule | **no** | yes | yes, 13 s |
| \+ tool-call-is-the-half-that-matters | yes | yes | **yes** |

Corroborated independently by the Make context store, which recorded
`status: transfer_requested` against the third call, and by the Vapi record,
whose message roles end on a third `tool_calls` with no result — the SIP leg was
torn down by the redirect before the result could be written.

## Two rules worth keeping

**A prompt is read top to bottom, and the nearest instruction wins.** A correct
protocol 13,000 characters below a wrong section is not a correction; it is a
second opinion the model has already stopped asking for. Where two passages
address one situation, the earlier one must defer explicitly, by name.

**An instruction that depends on a turn is a promise about the caller.** "Do X
on your next turn" quietly assumes the caller will speak again. Whenever the
instruction follows something that makes speaking pointless — a transfer, a
goodbye, a hold — that assumption is false and the instruction never runs.

## Scope

Fixed in the Aurixa Systems org (`453f00c2-cb26-43f0-8da3-2eb13b578e15`), which
is where the live line answers. **All twelve NPC assistants that carry a
transfer protocol** now place the call in the same turn as the sentence:

| assistant | id | what was fixed |
|---|---|---|
| NPC Inbound Agent (Angela) | `b834610e` | defects 1 and 2 |
| NPC IFC Inbound | `ed0aa90f` | defect 2 |
| NPC Strategy Session Inbound | `f958ec93` | defect 2 |
| **NPC Opt In Follow Up Inbound (Monica)** | `fdb1ecde` | defect 2 |
| NPC Discovery Call No Show Follow Up | `9013efd8` | defect 2 |
| NPC Active Nurturing | `66d3e994` | defect 2 |
| NPC Discovery Call Follow Up Test | `6930782c` | defect 2 |
| NPC IFC Follow Up | `55685df0` | defect 2 |
| NPC IFC No Show Follow Up | `209964e0` | defect 2 |
| NPC Strategy Session (Phone) Follow Up | `f8abe39e` | defect 2 |
| NPC Strategy Session (Phone) No Show | `5aa70a8e` | defect 2 |
| NPC Quiz Follow Up | `044329e5` | defect 2 |

The first four are the inbound squad — a caller reaches them through Angela, so
the same request hit the same wall there. The other eight are outbound
follow-ups.

Every one carried a prompt byte-identical to its `snapshot/` copy beforehand,
verified by length and MD5 before anything was written.

## Two scope claims were wrong, and both were mine

**The first count matched only the long-form wording**, `the assistant's next
turn MUST be tool-only`. A lowercase variant — `next turn must be tool-only` —
appears in twelve NPC assistants, and every one of the twelve with a transfer
protocol deferred its transfer call that way. Six assistants the first sweep
reported clean were not.

**The second said all four members of the inbound squad were fixed. Three
were.** `NPC Opt In Follow Up Inbound` — Monica — is the fourth member and
still carried the defect, and *both* detectors missed her for the same reason:
her rule reads *"**Monica's** next turn must be tool-only"*, naming the
assistant where the others say "the assistant's", and her confirmation script
says "After saying this, stop speaking" rather than the phrasing the other scan
keyed on. She is reachable on the live inbound line — Angela routes a
discovery-call caller to her — so "can I speak to a human" put to Monica hit
exactly the wall this work exists to remove.

The lesson is the one this repository keeps paying for: **a detector written
around the instance you have in front of you measures that instance.** Both
sweeps were scans for a remembered string rather than for the shape of the
defect, and each found precisely what it was written from.

## Not every deferral is a defect

A deferral is only broken when the sentence before it gives the caller no
reason to speak. *"Would it help if I briefly explain what NPC Services
does?"* → *"If the caller says yes, the next turn must be tool-only"* is
**correct**: the caller answers, so the turn exists. A transfer confirmation,
and a spoken goodbye before `end_call_tool`, are the two shapes where it is
not.

**Twenty-eight deferrals remain across the twelve committed prompts and none is
transfer-related** — asserted over the files in [`aurixa-org/`](./aurixa-org) by
a case-insensitive scan that also reads fourteen lines back and eight forward
for any mention of transferring, and finds none. What is left is
`end_call_tool` and mid-flow tool steps, untouched because they were outside
what was asked and because a mid-flow step is the case where the caller usually
does speak again. `end_call` hangs up a call that is already finished; a lost
transfer loses a caller.

## Monica was tested live, and she is the one who needed it

The other eleven are asserted from the three-call ablation above: the rule text
they now carry is the text that ablation proved. Monica is on the inbound path,
so she was driven for real.

A temporary vapi-provider SIP endpoint was created bound to her assistant alone,
**deliberately with no `fallbackDestination`**, so that nothing on the call could
reach a human except the transfer itself. One call, one sentence:

```
ROLES  system, bot, user, tool_calls, tool_call_result, bot
bot    "Hi. I'm Monica from Naidu Property Consulting Services. How can I help you today?"
user   "Hi there. Can I please speak to a human?"
→      tool_calls  ·  tool_call_result
bot    "Absolutely. I'll try to get you through to someone from the team now.
        I'm sorry. I'm having trouble getting someone through right now..."
```

She said the confirmation script **and placed the call**. Before the fix this
call ends `silence-timed-out` with no `tool_calls` at all — that is the whole
defect, and it is gone.

The transfer then failed, correctly: a direct SIP probe does not run the
scenario that writes the caller's context, so the transfer scenario had no
Twilio parent call to redirect, and Monica read her own failure script. The
downstream chain is proven separately and end to end, including a live leg to
the escalation mobile. What could only be proven here is the *decision*, and the
probe was built so that nothing else could be mistaken for it.

The endpoint was deleted in the same sitting; the org's five phone records are
unchanged.

## How every change was made, and how it was checked

Every change was a `PATCH` of the whole `model` object — Vapi replaces a
top-level key wholesale, so `toolIds`, `knowledgeBase`, `provider`, `model`,
`temperature`, `maxTokens`, `promptCacheKey`, `promptCacheRetention` and
`server.url` were re-sent with it and verified unchanged on read-back, along
with the resulting prompt's length and MD5 against a locally composed target.

The prompt itself never left Vapi: the edit travelled as a Make expression that
reads the live prompt, escapes it, applies the replacement and sends it back in
the same run. A prompt carries 5–56 `{{firstName}}`-style tokens, several inside
the sentences forbidding the assistant to say a raw variable aloud, so carrying
one through a mapper as a literal would silently delete them.

The prompts as they now stand are in [`aurixa-org/`](./aurixa-org), which is the
rollback artefact. Each was rebuilt locally from its snapshot and kept only
because its MD5 equalled what Vapi returned — so the committed bytes are the
live bytes by proof rather than by transcription.
