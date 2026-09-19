# Investigation — three candidate repositories

Requested 2026-07-28. Assessed against our actual constraints: self-hosted,
biometrics retained on infrastructure we control, three attempts, containerised
deployment, Australian reporting entity in commercial production.

**Result: none of the three is adoptable as an open-source biometric provider.**
Two are proprietary SDKs presented in open-source clothing; the third is a
genuinely MIT project but does something else entirely. The investigation did,
however, surface a **correction to our own recommendation** (§4) and two
findings worth keeping (§5).

---

## 1. FaceOnLive / ID-Verification-OpenKYC

<https://github.com/FaceOnLive/ID-Verification-OpenKYC> — 449 ★

**Verdict: not open source. Do not adopt.**

| Check | Finding |
|---|---|
| LICENSE file | **None.** `/blob/main/LICENSE` returns 404, and GitHub's sidebar detects no licence. |
| Repo contents | `admin`, `app`, `doc`, `idkit_cloud_function`, `README.md` — a wrapper application, not an engine |
| Engine | FaceOnLive's proprietary SDKs, distributed separately |
| Runtime | Requires a **licence key**. The SDK returns `SDK_LICENSE_KEY_ERROR`, `SDK_LICENSE_EXPIRED`, `SDK_NO_ACTIVATED`. Offline mode uses a `license.txt` locked to the machine **hardware ID** via `get_deviceid()`. |
| Commercial | "Get a Server with Full ID Verification SDKs Installed for Just $1200" |

**The absence of a LICENSE file is the decisive point.** Under copyright law,
code published with no licence is *all rights reserved* — the default is that
you may not use, copy or modify it, notwithstanding "Open" in the repository
name. Publishing on GitHub grants only the rights in GitHub's Terms of Service
(viewing and forking), not a right to deploy in a commercial product.

Beyond the licence, the hardware-ID-locked activation is a poor fit for our
deployment: containers are rebuilt and rescheduled, and an activation bound to a
machine identifier turns every redeploy into a licensing event.

This is a **commercial vendor with an open-source-shaped shopfront**. That is a
legitimate business model, but it must be evaluated as a commercial purchase —
against Equifax, FrankieOne and the other bureau options — not as open source.

## 2. vyayasan / kyc-analyst

<https://github.com/vyayasan/kyc-analyst> — 50 ★, **MIT**

**Verdict: genuinely open source, but it is not identity verification.**

This does **no document verification and no biometrics**. It is a compliance
*workflow* tool: sanctions screening (OFAC, UN, EU), PEP checks, adverse-media
search, deterministic risk scoring, and report generation — implemented as a
Claude agent with slash commands and markdown skills, running on Claude Code or
Cowork.

So it addresses our **screening** layer, not the biometric layer this
investigation was about. Two reasons it is still not adoptable:

- **Maturity.** Three commits, 50 stars, self-described as a research preview,
  with an explicit disclaimer that it is not a regulated product.
- **It conflicts with our protected baseline.** It places an LLM in the
  determination path across 17 checkpoints. Our design deliberately holds the
  opposite line: risk evaluation never moves the service gate, and the gate only
  ever changes on an explicit, reasoned, human decision recorded against an
  identified decision-maker. Adopting an agent that produces compliance
  determinations would cut across that, and it is the one part of the
  architecture that most needs to survive an AUSTRAC review.

**Worth taking from it: the free-data source list** (§5.1). Given we found
OpenSanctions' *data* is CC-BY-NC, its enumeration of genuinely free primary
sources is useful.

## 3. DoubangoTelecom / KYC-Documents-Verif-SDK

<https://github.com/DoubangoTelecom/KYC-Documents-Verif-SDK> — 68 ★

**Verdict: proprietary. Viable as a paid document-reading component, not as open source — and one deployment blocker.**

| Check | Finding |
|---|---|
| Engine | **Closed-source binaries** (`.so` / `.dll`) in `/binaries`. Only the sample applications are open. |
| Models | In a **private repository**. Access requires a mail from a corporate domain — "mails from other domains (e.g. @Gmail) will be ignored". "The terms of use do not allow you to decompile or reverse engineer the models." |
| GitHub build | Doubango states it "doesn't require a license but comes with some restrictions and **must not be used in commercial products**" |
| Commercial licence | On-premise, royalty-free, **per device**, lifetime. Server (Windows/Linux x86-64): **€699 Silver / €899 Gold** for the MRZ tier. No monthly or per-request fees. |
| **Deployment blocker** | Licences **"cannot activate on standard VMs (VMware, VirtualBox) without AWS/Azure"** |

The capability is real — 5,000+ document formats, 140+ languages, 250+
countries. And the pricing model is genuinely attractive relative to per-check
SaaS: a one-time €899 per server with unlimited processing beats per-transaction
pricing quickly at any volume.

But the per-device activation restriction is a direct conflict with how we run.
It would need to be resolved with Doubango before purchase, not after.

---

## 4. Correction to our own recommendation

Investigating these three prompted a re-check of **CompreFace**, which the
previous document recommended. That check found the trap we warned about lands
on our own recommendation:

> CompreFace is Apache-2.0 and "leverages FaceNet and InsightFace libraries",
> supporting **InsightFace-ArcFace** for its highest accuracy. InsightFace's
> code is MIT, but its **pretrained weights are non-commercial research only**,
> and its own site directs commercial users of the open-sourced packages (e.g.
> `buffalo_l`) to `recognition-oss-pack@insightface.ai` for licensing.

**So CompreFace's Apache-2.0 badge does not make its default model
commercially usable by us.** The prior document listed a weights-licence audit
as a release gate; running that audit immediately, rather than at release,
changes the recommendation.

### The broader finding

This is not a CompreFace defect — it is structural. Essentially every
high-accuracy open face-recognition model is trained on research datasets
(MS-Celeb, VGGFace2, Glint360K, WebFace) whose terms restrict commercial use.
The permissive licence sits on the *code*; the restriction sits on the
*weights*. **There is no high-accuracy, genuinely commercially-licensed,
free face recognition model.**

That leaves three honest options:

| Option | What it costs | What it preserves |
|---|---|---|
| **A. Licence the weights, keep self-hosting** — CompreFace (Apache-2.0) + a commercial InsightFace model licence | A modest commercial contract, one-off | **Everything that matters for decision 2.** The biometric still never leaves our infrastructure. This is the recommended path. |
| **B. Permissively-licensed weights only** | Free | Lower accuracy, which means more false rejections — and with a three-attempt ceiling, more customers pushed to the manual fallback |
| **C. Commercial SDK** (FaceOnLive, Doubango, or a bureau) | Per server or per check | Varies; hardware-locked activation conflicts with containers |

**Recommendation: Option A.** It keeps the self-hosting benefit that made
decision 2 defensible — the face never leaves infrastructure we control — while
putting the weights on a lawful footing. The cost is a licence negotiation, not
an architecture change, and nothing already built needs to move: `provider` is
free text and `aml.verification_checks` is deliberately vendor-agnostic.

Option B deserves a note: accuracy is not a cosmetic concern here. A weaker
model raises the false-rejection rate, and under decision 4 a customer gets
three attempts before landing in manual handling. Cheaper weights are paid for
in staff time and customer friction.

---

## 5. Worth keeping

### 5.1 Free primary sources for screening

`kyc-analyst` uses only sources that are genuinely free to use, which partly
answers the OpenSanctions CC-BY-NC problem: **OFAC SDN**, the **UN Consolidated
List**, EU lists, **ICIJ Offshore Leaks**, and Companies House. For Australia the
equivalent primary source is the **DFAT Consolidated List**.

These are free to redistribute. What a paid aggregator adds is name
normalisation, transliteration, aliasing and deduplication — which is most of
the difficulty, but not all of the value. Screening directly against the primary
lists is a legitimate starting position, provided the fuzzy-matching quality is
tested and the residual gap is documented rather than assumed away.

### 5.2 Doubango as a document-layer candidate

Keep on the commercial shortlist for MRZ and document reading, subject to
resolving the VM activation restriction. One-time per-server pricing is
structurally better than per-check for our volumes, and it is materially
stronger than the free docTR + mrz combination on document coverage.

---

## 6. Net effect on the plan

| Layer | Before this investigation | After |
|---|---|---|
| Face match | CompreFace (Apache-2.0) | CompreFace **+ commercial InsightFace weights licence** — corrected |
| Liveness | Silent-Face-Anti-Spoofing, signal only | Unchanged |
| Document / MRZ | docTR + mrz (free) | Unchanged, with **Doubango** added as a paid alternative pending the VM question |
| Sanctions / PEP | OpenSanctions + commercial data licence | Unchanged, with **direct primary-source screening** added as a lower-cost starting option |
| DVS | Commercial Gateway Service Provider | Unchanged — still no open-source path |

None of this changes the schema. `aml.verification_checks` was built
vendor-agnostic precisely so provider selection stays a commercial decision.

**The general lesson, worth carrying into any future evaluation: for biometric
components, check the licence on the model weights, not the badge on the
repository.** All three repositories here, and our own prior recommendation,
looked permissive at the top level and were not.
