/**
 * The portal context strip, and the stamp record dialog.
 *
 * ## Why this is a context strip and not the design's portal switcher
 *
 * The design's top chrome switches the whole view between Command, Client,
 * Finance, Solicitor and Builder. That is a prototype affordance: in production
 * each of those portals is a **separate authentication domain** with its own
 * `__Host-` cookie and its own server-side projection. There is no session in
 * which one operator is all five, and a Command-side "view as client" that
 * rendered the client projection from Command data would be showing a
 * *simulation* of the boundary rather than the boundary — the one thing a
 * disclosure surface must never do.
 *
 * So the strip keeps what the design was actually communicating — which
 * portals hold this Passport and what each has done with it — and drops the
 * impersonation. Every row is real: it comes from the partner grants on the
 * projection, not from a fixture.
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { PassportStamp, PassportView } from "@/lib/aml/passport";
import { formatPassportDateTime } from "../format";
import { TonePill } from "./primitives";
import { StampFace } from "./StampFace";
import { derivePortalRows } from "./portalRows";


export function PassportPortalStrip({ view }: { view: PassportView }) {
  const rows = derivePortalRows(view);
  return (
    <section className="border-b border-[color:var(--passport-hairline)] px-5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="passport-kicker">Connected portals</span>
        <span className="passport-mono passport-faint text-[11px]">{rows.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <li key={r.key} className="passport-panel min-w-[200px] flex-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="passport-dim text-[13px] font-semibold">{r.label}</span>
              <TonePill tone={r.tone}>{r.state}</TonePill>
            </div>
            <div className="passport-faint mt-1 text-[11px]">{r.role}</div>
            <div className="passport-muted mt-0.5 truncate text-[11px]">{r.detail}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The record behind a stamp.
 *
 * A seal that cannot be opened is decoration. This is what makes the stamp
 * register auditable: every seal names the record it was earned from, with the
 * actor, the portal and the time that record carries — not a re-description.
 *
 * ── Why the die is `StampFace` and no longer `Wax` ────────────────────
 * Clicking an impression opened a dialog headed by a DIFFERENT seal: `Wax`,
 * a plain ring with a title in it, no grain, no ticks, no watermark, and
 * "AURIXA SYSTEMS" hard-coded as its issuer whoever had actually struck the
 * record. So the one surface whose whole job is "here is that impression,
 * and here is what it was earned from" showed a specimen that did not match
 * the impression the reader had just clicked.
 *
 * It draws the real die now, upright — the register is tilted because a page
 * of hand-pressed impressions is not a grid, and a single specimen is not a
 * register.
 */
export function StampRecordDialog({
  stamp,
  issuerOrg,
  onClose,
}: {
  stamp: PassportStamp;
  /** The issuer, so the ink rule resolves exactly as it does on the page. */
  issuerOrg: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="passport-scope max-w-md p-0">
        <DialogTitle className="sr-only">{stamp.title} — underlying record</DialogTitle>
        <div className="flex flex-col items-center gap-4 p-6">
          <StampFace stamp={stamp} issuerOrg={issuerOrg} upright />
          <div className="w-full">
            <div className="passport-kicker mb-2">Underlying record</div>
            <dl className="space-y-0">
              {[
                ["Recorded", formatPassportDateTime(stamp.at)],
                ["Portal", stamp.portal],
                ["Actor", stamp.actor ?? "System"],
                ["Issuer", stamp.org],
                ["Version", stamp.version != null ? `v${stamp.version}` : "—"],
                ["Source", stamp.source.kind],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="passport-rule flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
                >
                  <dt className="passport-field__k">{k}</dt>
                  <dd className="passport-dim text-[13px]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className="passport-faint text-center text-[11px] leading-relaxed">
            Stamps are earned from system records and cannot be applied by hand. This one was
            derived from the record above.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
