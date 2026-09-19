/**
 * What is stopping this Passport — the answer, at the top of the record.
 *
 * §15's question is "WHAT PREVENTS THIS PASSPORT FROM BEING ISSUED?", and
 * before this the surface answered it only by disabling a button. A disabled
 * control with a tooltip is not an answer; it is the absence of one.
 *
 * Everything here is derived from the projection by `outstandingItems.pure`.
 * There is no stored readiness, no second progress number, and no mutation:
 * the actions route to the surfaces that already own the work.
 */
import { useMemo } from "react";
import type { PassportView } from "@/lib/aml/passport";
import {
  deriveOutstandingItems, outstandingHeadline, summariseOutstanding,
  type ActionOwner,
} from "@/lib/aml/passport/outstandingItems.pure";
import { PassportCard, SectionTitle, TonePill } from "./primitives";

const OWNER_TONE: Record<ActionOwner, "ok" | "info" | "warn" | "bad" | "na"> = {
  client: "warn",
  staff: "info",
  mlro: "warn",
  none: "na",
};

const OWNER_LABEL: Record<ActionOwner, string> = {
  client: "Awaiting client",
  staff: "Awaiting staff review",
  mlro: "Awaiting MLRO",
  none: "—",
};

export function ComplianceActionSummary({
  view, onRequestClientInformation, onOpenPage, onOpenCase,
}: {
  view: PassportView;
  onRequestClientInformation: () => void;
  onOpenPage: (pageId: string) => void;
  /** Absent when the surface has no route to offer. */
  onOpenCase?: () => void;
}) {
  const items = useMemo(() => deriveOutstandingItems(view), [view]);
  const summary = useMemo(() => summariseOutstanding(items), [items]);
  const headline = outstandingHeadline(view, summary);

  const state = view.header?.state?.code ?? null;
  const issued = String(state) === "current" || String(state) === "issued_current";

  return (
    <PassportCard className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionTitle>{issued ? "Passport status" : "Before this Passport can be issued"}</SectionTitle>
          <div className="passport-dim text-sm font-semibold">{headline.title}</div>
          <p className="passport-faint mt-1 max-w-[62ch] text-[11px] leading-relaxed">
            {headline.detail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.awaitingClient > 0 && (
            <button
              type="button"
              className="passport-action passport-action--primary w-auto"
              onClick={onRequestClientInformation}
            >
              Request from client
            </button>
          )}
          {onOpenCase && (
            <button type="button" className="passport-action w-auto" onClick={onOpenCase}>
              Open compliance case
            </button>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {items.map((i) => (
            <li
              key={i.key}
              className="passport-rule flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="passport-dim text-[12.5px]">{i.title}</span>
                <span className="passport-faint ml-2 text-[11px]">{i.detail}</span>
              </span>
              <span className="flex items-center gap-2">
                <TonePill tone={OWNER_TONE[i.owner]} className="text-[10.5px]">
                  {OWNER_LABEL[i.owner]}
                </TonePill>
                {i.page && (
                  <button
                    type="button"
                    className="passport-action w-auto text-[11px]"
                    onClick={() => onOpenPage(i.page!)}
                  >
                    View
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PassportCard>
  );
}
