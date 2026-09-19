# Identity capture — real-device QA before activation

**This is a gate on ACTIVATION, not on merge.** The code can ship inactive;
`didit_standalone` must not be switched on for customers until every row below
is signed off on a real device.

The reason is specific. The whole journey is `getUserMedia` in a page, and
`getUserMedia` is where mobile browsers differ most from each other and most
from a headless run. Automated QA in CI drives Chromium with a synthetic camera
— which proves the sequencing, the uploads and that nothing opens a window, and
proves nothing at all about whether an iPhone will hand the page a rear camera
in landscape.

## What has already been tested, and by what

| Surface | How | Result |
| --- | --- | --- |
| Chromium desktop 1280×900 | Playwright, `--use-fake-device-for-media-stream` | PASS |
| Chromium mobile viewport 390×844 | same, `isMobile`/`hasTouch` | PASS |
| iPhone Safari | — | **NOT TESTED** |
| Android Chrome, real device | — | **NOT TESTED** |
| iPad Safari | — | **NOT TESTED** |

The automated run covers: four document options, arrow-key selection, front →
back → selfie ordering for a licence, front → selfie for a passport, retake
reopening the camera, JPEG uploads of non-zero size to the server-named
locations, an attempt id alone on submission, the waiting state exiting when
the server settles, and zero popups / iframes / navigations / off-origin
requests / console errors.

A synthetic camera cannot tell you about permissions, orientation, HEIC, real
lens selection, backgrounding, or what happens when a call comes in. That is
what the rest of this document is for.

## Before you start

- Point the device at **staging**, with `didit_standalone` active **there** and
  a **sandbox** Didit key set. Live credits are not for QA.
- Use a real identity document you are willing to photograph, or a specimen.
  A photograph of a screen is a legitimate test — it should be REFUSED, not
  approved, and that is one of the rows below.
- Have the AML Command Centre open on another machine to read the staff-side
  result. The customer's screen deliberately never shows a score.

---

## A. iPhone / Safari (iOS 17+)

The one that matters most: it is the strictest about camera access, the only
one that can hand you a HEIC, and the platform where a page that loses its
stream on backgrounding is hardest to recover.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| A1 | Open the portal, reach Verify your identity | Four documents listed, no country picker | ☐ |
| A2 | Choose Australian passport → Continue | Brief says **two photos**, and says nothing opens a new window | ☐ |
| A3 | Begin secure verification | Permission prompt appears **once** | ☐ |
| A4 | Deny the permission | A visible explanation plus the file-upload fallback. Not a dead end, and nothing consumed | ☐ |
| A5 | Retry and allow | **Rear** camera opens for the document | ☐ |
| A6 | Rotate to landscape mid-capture | Preview stays usable; no black frame; shutter still works | ☐ |
| A7 | Take the photo | Preview shows the shot, right way up, not mirrored | ☐ |
| A8 | Retake | Camera **reopens**. This is the defect that stranded customers before | ☐ |
| A9 | Use this photo | **Front** camera opens for the selfie | ☐ |
| A10 | Send securely | "Checking your identity", camera indicator **off** | ☐ |
| A11 | Background the app for 30s, return | Waiting state or result — never a blank screen or a restarted journey | ☐ |
| A12 | Lock the phone for 2 min, return | As A11 | ☐ |
| A13 | Wait for settlement | The screen changes on its own, without a manual reload | ☐ |
| A14 | Pull-to-refresh mid-processing | Returns to the waiting state, **not** the document chooser; nothing re-uploaded | ☐ |
| A15 | Repeat with a **driver licence** | Brief says **three photos**; back step appears between front and selfie | ☐ |
| A16 | On the back step, press Back | Returns to the front step with the shot intact | ☐ |
| A17 | Choose a photo from the library instead of the camera | A HEIC is refused with the Settings → Formats instruction; a JPEG is accepted | ☐ |
| A18 | Photograph a **photo of a document on a screen** | Staff side shows a declined/referred document check. Customer sees a portal-safe message only | ☐ |
| A19 | Throughout | No Didit branding, no popup, no redirect, no new tab, no third-party page | ☐ |
| A20 | Low light | Capture still completes; if unreadable the customer is asked to retake and **no attempt is consumed** (check the staff side) | ☐ |

## B. Android / Chrome (recent)

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| B1 | A1–A3 equivalent | as above | ☐ |
| B2 | Allow the permission | Rear camera for the document, front for the selfie | ☐ |
| B3 | Multi-lens device (ultra-wide/tele) | A usable lens is chosen; the document fits in frame | ☐ |
| B4 | Rotate mid-capture | as A6 | ☐ |
| B5 | Retake on both steps | Camera reopens both times | ☐ |
| B6 | Driver licence front + back | Three steps, in order | ☐ |
| B7 | Send, then switch apps for 60s | Waiting state survives; result appears on return | ☐ |
| B8 | Chrome "Desktop site" toggle | Journey still usable | ☐ |
| B9 | Throughout | No popup, no redirect, no external page | ☐ |

## C. Desktop Chrome / Edge / Firefox / Safari

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| C1 | Full journey, passport | Two photos, completes | ☐ |
| C2 | Full journey, driver licence | Three photos, in order | ☐ |
| C3 | Webcam denied | Explanation plus file fallback | ☐ |
| C4 | No webcam at all | Explanation plus file fallback | ☐ |
| C5 | Keyboard only, no mouse | Document group navigable by arrows; every control reachable and operable | ☐ |
| C6 | Screen reader (VoiceOver / NVDA) | Stage changes announced; "Checking your identity" announced when it appears | ☐ |
| C7 | Second tab, same case, mid-processing | Shows the waiting state; does **not** offer a fresh capture | ☐ |
| C8 | Double-click Send securely | Staff side shows **one** attempt, not two | ☐ |
| C9 | Refresh during processing | Waiting state; no re-upload; no second attempt | ☐ |
| C10 | Console throughout | No errors | ☐ |
| C11 | Network tab throughout | No request to any Didit host | ☐ |

## D. The things only the staff side can confirm

Run these against the Command Centre after the journeys above.

| # | Check | Expected | Result |
| --- | --- | --- | --- |
| D1 | A successful verification | Three provider request ids recorded; thresholds in force recorded | ☐ |
| D2 | `outcome_detail` on any attempt | No base64, no portrait, no name, no address, no MRZ | ☐ |
| D3 | An unreadable capture | `capture_unusable`, **attempt not consumed** | ☐ |
| D4 | A declined document | Attempt consumed; customer sees a portal-safe message with no score | ☐ |
| D5 | Wrong document (passport photographed after choosing licence) | Referred for review, **never** auto-verified | ☐ |
| D6 | 30-day cost on AML Configuration | Non-zero after test attempts, and roughly 20c per ID call + 5c each for the two face calls | ☐ |
| D7 | Provider readiness card | With a threshold unset, names **which** one — not just "misconfigured" | ☐ |
| D8 | Storage buckets | Captures present under `{caseId}/verification/{attemptId}/`; both buckets private | ☐ |
| D9 | `aml-idv-retention` dry run | Reports `configured: false` until the policy is set, and deletes nothing | ☐ |

## E. Sign-off

Activation of `didit_standalone` for customers requires A, B, C and D complete
with no unexplained ☐, recorded here with the tester, the device, the OS
version and the date.

| Section | Tester | Device / OS | Date | Notes |
| --- | --- | --- | --- | --- |
| A — iPhone Safari | | | | |
| B — Android Chrome | | | | |
| C — Desktop | | | | |
| D — Staff side | | | | |

Until section A is signed, **iPhone Safari is untested and must be described
that way** — not as "expected to work".
