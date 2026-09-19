/**
 * Mounts the REAL `ManualScreeningDialog` so Playwright can measure it.
 *
 * jsdom has no layout: it will report a class list happily while the dialog
 * is unusable on a 1366x768 screen, which is exactly the defect this exists
 * to catch. So the component is built and rendered in Chromium, and the
 * assertions are on bounding boxes rather than on strings.
 *
 * `?outcome=` picks the branch under test, because the tallest layouts are
 * the match ones.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ManualScreeningDialog } from "@/components/aml/ManualScreeningDialog";
import type { AmlPartyScreeningSubject } from "@/lib/aml/amlCasesApi";
import "@/index.css";

const SUBJECT: AmlPartyScreeningSubject = {
  id: "55555555-5555-4555-8555-555555555555",
  case_id: "11111111-1111-4111-8111-111111111111",
  party_type: "beneficial_owner",
  party_id: null,
  screened_name: "Rugesh Naidu",
  required: true,
  state: "not_required",
  last_screened_at: null,
  refresh_due_at: null,
  adjudicated_at: null,
  adjudication_note: null,
  screening_check_id: null,
  error_category: null,
  matches: [],
  pep_determination: null,
};

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <ManualScreeningDialog
      subject={SUBJECT}
      open={open}
      onOpenChange={setOpen}
      onRecorded={() => {}}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Harness /></StrictMode>,
);
