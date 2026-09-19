# Passport Orchestration — UAT checklist

Run on staging, against a real AML case. Nothing here needs a feature flag;
the Passport surface itself is gated by `aml_passport_command_view`, and
partner distribution by `aml_passport_partner_distribution`.

---

## Scenario A — missing client information

**Setup:** an AML case with an incomplete verification (at least one component
not performed) and a required document with nothing accepted against it.

1. Open **AML/CTF Compliance → Compliance Passport** and select the customer.
2. **The summary at the top names what is outstanding** and whose move each item
   is. Confirm identity verification appears as *Awaiting client*.
3. Open page **03 Verification**. Confirm the components shown match what the
   summary claimed — the summary derives from the same projection.
4. Press **Request from client** (or *Request client information* in the control
   rail).
5. The composer opens **already showing the outstanding items** — not a blank
   form. Select *Identity verification incomplete*.
6. Confirm the subject, message and destination are prepopulated, and that the
   message contains **no internal reason** — no risk band, no screening finding.
7. Edit the message if you wish. Send.
8. Confirm the toast, and that the summary now reports the request as
   *Awaiting client*.
9. Open the **case workspace → Requests**. The same request is there, with the
   same status. There is one request lifecycle, not two.
10. Sign in to the **Client Portal** as that client. Confirm an action is shown.
11. Press the CTA. Confirm it lands on the identity step — or, if the provider
    is unavailable, on manual document upload **with the explanatory line**.
    It must never open a camera the server will refuse.
12. Complete the action as the client.
13. Back in the Command Centre, confirm the request reads as responded and the
    summary moves it to *Awaiting staff review*.

## Scenario B — questionnaire amendment routing

This is the path that was broken.

1. From the composer, choose **Questionnaire update**.
2. Send it.
3. In the Client Portal, press the CTA.
4. **Confirm it opens the questionnaire at the right section** rather than the
   generic respond box. Before this stage the section was discarded by the
   server and every questionnaire request landed generically.
5. Repeat from **Submission Review → Request changes** with a section selected;
   confirm the same routing. Both paths now use one validated whitelist.

## Scenario C — Share Passport

1. On an **issued** Passport, press **Share Passport** in the control rail.
2. **Confirm the surface moves to page 09 Partner Access.** Before this stage
   the button was an anchor to an element not present on this page and nothing
   happened at all.
3. Confirm the partner readiness cards load, each showing its own legal route.
4. Confirm a partner without statutory reliance shows *Information sharing only*
   and is not described as section 37A.
5. Run Link & Share. Confirm per-partner results.

## Scenario D — issuance readiness

1. On a Passport that is **not** ready, confirm the summary says so and lists
   the blockers rather than only disabling the button.
2. Resolve the outstanding items.
3. Confirm the summary reports **Ready for issuance** and *Awaiting MLRO*.
4. Issue. Confirm the version, fingerprint and stamps come from the existing
   issuance engine, and that the summary now reads **Passport current**.

## Scenario E — the negative checks

These should all *fail to do anything interesting*. That is the point.

1. As a **non-MLRO** with write access, confirm client requests still work from
   the case workspace exactly as before — this stage did not narrow anyone's
   existing ability.
2. Confirm the Passport's restricted actions (Suspend / Revoke) remain
   MLRO-gated and reason-mandatory.
3. Confirm no client-facing message anywhere shows a risk score, screening
   finding, PEP determination or MLRO reasoning.
4. Confirm the client cannot reach another client's request.
5. Confirm a client completing an action does **not** move the service gate,
   mark verification passed, or accept a document.

## What to report

For each scenario: the case reference, what you saw, and — for anything that
differs — whether the projection or the surface was wrong. They read the same
data, so a disagreement between them is the interesting finding.
