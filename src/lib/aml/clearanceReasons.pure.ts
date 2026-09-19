/**
 * The words for a clearance blocker, and where it is fixed.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * "Record decision → Clear" answered 409 with a headline — *Cannot clear
 * AML case with unresolved mandatory holds* — while the reasons array the
 * server sent beside it was discarded by the client. The operator stood
 * on a page showing a LOW rating, no holds and no open conditions, being
 * refused for blockers nothing on the screen named. A refusal must name
 * its reasons, and each reason must name the place it is resolved.
 *
 * ── Contract with the server ──────────────────────────────────────────
 * `aml-risk`'s `clearanceBlockReasons` is the one implementation of what
 * blocks clearance; its `clearance_readiness` op exposes the same list
 * this module describes. The codes here are pinned against the server's
 * source by a test — a new server code fails the pin, and until it is
 * described it still RENDERS, as its raw words with no route, because an
 * unknown blocker shown crudely beats an unknown blocker hidden.
 */

export interface ClearanceReasonView {
  /** Plain words for the operator. */
  label: string;
  /** The workspace section where this is resolved, or null when the fix
   *  lives on the risk section itself. */
  section: string | null;
  /** Short imperative naming the fix. */
  action: string;
}

const words = (s: string) => s.replace(/_/g, " ");

/** `3_open_conditions` → { n: 3, code: "open_conditions" }; no prefix → n null. */
function splitCount(code: string): { n: number | null; rest: string } {
  const m = /^(\d+)_(.+)$/.exec(code);
  return m ? { n: Number(m[1]), rest: m[2] } : { n: null, rest: code };
}

export function describeClearanceReason(code: string): ClearanceReasonView {
  const { n, rest } = splitCount(code);
  const count = (singular: string, plural: string) =>
    n === null ? plural : `${n} ${n === 1 ? singular : plural}`;

  switch (rest) {
    case "no_assessment":
      return { label: "No risk assessment has been computed", section: null, action: "Evaluate the case" };
    case "open_conditions":
      return {
        label: `${count("open condition", "open conditions")} on the case`,
        section: null, action: "Resolve or close the conditions",
      };
    case "blocking_holds":
      return {
        label: `${count("block-severity hold", "block-severity holds")} on the latest assessment`,
        section: null, action: "Resolve the holds and re-evaluate",
      };
    case "pep_edd_outstanding":
      return {
        label: "Enhanced due diligence for the PEP is not complete",
        section: "screening", action: "Complete the EDD before clearance",
      };
    case "pep_senior_manager_approval_outstanding":
      return {
        label: "Senior-manager approval for the PEP has not been granted",
        section: "screening", action: "Record the designated approval",
      };
    case "party_screening_incomplete":
      return {
        label: `${count("required party screening", "required party screenings")} not yet run to completion`,
        section: "screening", action: "Run the outstanding screening",
      };
    case "party_screening_unresolved":
      return {
        label: `${count("screening candidate", "screening candidates")} awaiting adjudication`,
        section: "screening", action: "Adjudicate the candidates",
      };
    case "party_screening_stale":
      return {
        label: `${count("satisfied screening", "satisfied screenings")} past the refresh date`,
        section: "screening", action: "Refresh the screening",
      };
    case "unadjudicated_screening_matches":
      return {
        label: "Screening matches are open or escalated",
        section: "screening", action: "Adjudicate the matches",
      };
    case "case_screening_missing":
      return {
        label: "No authoritative screening of the case subject",
        section: "screening", action: "Run the case-subject screening",
      };
    case "pep_determination_outstanding":
      return {
        label: "No current PEP determination for the case subject",
        section: "screening", action: "Record the PEP determination",
      };
    case "party_pep_determination_outstanding":
      return {
        label: `${count("related party", "related parties")} without a current PEP determination`,
        section: "screening", action: "Record the party determinations",
      };
    default:
      if (rest.startsWith("authoritative_")) {
        return {
          label: `Mandatory trigger: ${words(rest.slice("authoritative_".length))}`,
          section: null, action: "Resolve the trigger condition",
        };
      }
      /* A code this module does not know still renders — crudely, with no
       * route — because hiding an unknown blocker recreates the defect. */
      return { label: words(code), section: null, action: "Investigate this blocker" };
  }
}
