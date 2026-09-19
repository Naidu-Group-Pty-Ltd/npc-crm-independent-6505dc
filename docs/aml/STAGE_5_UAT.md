# Stage 5 — UAT

Run on staging, as the roles named. Every step says what to look for; a step
that "looks fine" but shows a different number to another panel is a failure,
because the whole point of this stage is that one case has one answer.

## Prerequisites (check these first — most UAT failures are these)

| Prerequisite | How to check | If missing |
| --- | --- | --- |
| `aml-cases` deployed | the stage names a PEP determination rather than "Nobody is enrolled" | deploy the edge functions |
| DFAT list loaded | Stage 5's **Australian sanctions source** card says *Current* | load it at `/admin/aml/verification` |
| Provider live | same card says *Automated screening: Ready* | finish the provider as live in AML › Configuration |

If the source card says **Not loaded** or **Out of date**, the automated path
is *correctly* unavailable and UAT-B below is the path to test. That is not a
bug; it is the product refusing to screen against nothing.

## A — ordinary low-risk customer, automated path

Roles: analyst, then reviewer/MLRO.

1. Activate a client and have them complete the portal: consents, identity,
   the sanctions declaration (identity and aliases), and the PEP question.
2. Open the case and go to **Stage 5**.
3. **People to assess** lists the customer with a status *per check* —
   sanctions and PEP each carry their own. Nobody is labelled "not in scope".
4. **Australian sanctions source** names the DFAT Consolidated List, shows a
   real entry count and load date, and says *Ready*.
5. Sanctions screening runs and reports **No match**, or returns a candidate.
6. The PEP row reads **Action required**. The dominant action is
   **Record PEP determination**; pressing it opens the determination dialog
   (not a scroll, not a navigation to the page you are on).
7. Record *Not a PEP* with sources and rationale.
8. Stage 5 reads **Stage complete** and offers **Continue to Funding**.
9. Press it: Stage 6 opens. Check the service gate is **unchanged** — the
   control navigates and approves nothing.

## B — automated screening unavailable, manual fallback

Roles: MLRO, and an administrator.

1. With the source card showing *Not loaded*, *Out of date* or the engine not
   ready, open a case where sanctions **is** required.
2. As MLRO the dominant action is **Complete sanctions screening manually**,
   with the provider fault named as the alternative. There is no dead end.
3. Open the manual dialog. Record a **No match** with at least one source, at
   least one searched name and a rationale. Confirm it refuses without them.
4. The sanctions row settles. **PEP remains outstanding on its own.**
5. As an administrator, confirm the provider/list fault is still visible —
   the manual route does not hide broken automation.

## C — reopened enquiry-only case (the reported case)

Roles: reviewer/MLRO.

1. Open a closed case classified *outside the perimeter — enquiry only*.
2. It reads **Case closed — journey paused** and offers only
   **Reopen case to resume AML/CTF**. No ordinary status advances.
3. Reopen it with a reason.
4. Check on the rail: **Case lifecycle** moves off Closed, and **Service gate**
   stays **Terminated**, and the passport stays revoked. Reopening restores
   the ability to work the case, never permission to serve.
5. Stage 5 now shows **Case classification requires review** at the top.
6. Either:
   - **Review case classification → designated service**: sanctions becomes
     required and the stage recomputes; or
   - leave it as an enquiry: sanctions stays *Not required*, and the reason is
     stated as a policy decision rather than a screening result.
7. Either way the PEP determination remains separately required.
8. Confirm **Journey position** reads Stage 5 and the **Next action** names the
   PEP determination — not a later stage.

## D — the three panels must agree

On any case with an outstanding required determination, check simultaneously:

- the Stage 5 card,
- **Live position → Journey position**,
- **Next action** in the right rail,
- **Attention**.

They must name the same stage and the same work. In particular *Attention* must
not say "nothing on this case is unresolved" while Stage 5 shows a required
determination outstanding.

## E — a finding still leads

1. On a case with a possible match, confirm the dominant action becomes the
   adjudication and **Continue to Funding** does not appear.
2. On a confirmed match, confirm the stage escalates and nothing offers to
   move on.

Use test fixtures. Do not use a real person's name to manufacture a match.
