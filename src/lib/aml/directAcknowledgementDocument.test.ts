import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The executed copy of a direct partner acknowledgement.
 *
 * Every portal partner's executed agreement could already be produced as a
 * PDF; a partner who acknowledged the same instrument by link had no such
 * document. Pinned here: ONE renderer builds it (a second would eventually
 * produce a second-looking document for one instrument), only an ACCEPTED
 * acknowledgement has anything to produce, the copy is write-once, and the
 * gate is an AML role rather than a portal-admin module the partner has no
 * place in.
 */

const records = readFileSync("supabase/functions/partner-agreement-records/index.ts", "utf8");
const documentModule = readFileSync(
  "supabase/functions/_shared/partnerAgreementDocument.pure.ts", "utf8");
const client = readFileSync("src/lib/aml/directAcknowledgementDocument.ts", "utf8");
const panel = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261003000000_direct_acknowledgement_artefact.sql", "utf8");

const op = records.slice(
  records.indexOf("if (operation === 'download_direct_acknowledgement')"),
  records.indexOf("if (operation === 'save_missing_copies')"));

describe("one renderer, not a second one", () => {
  it("the direct copy goes through the SAME generator as every portal copy", () => {
    expect(op).toContain("generateAgreementCopy(supabase, record, 'direct')");
    // The generator learned a source, not a second document.
    expect(records).toContain("source: 'portal' | 'direct' = 'portal'");
    // And there is exactly one call to the PDF renderer in this function.
    expect(records.match(/await renderPdf\(/g) ?? []).toHaveLength(1);
  });

  it("the execution label names the channel, never a portal the partner lacks", () => {
    expect(documentModule).toContain("direct: 'Direct Partner Acknowledgement (no portal)'");
  });

  it("the row is presented in the shape the generator already reads", () => {
    // Adapting the row is cheaper and safer than teaching the generator a
    // second schema — the storage prefix and the label both follow `portal`.
    expect(op).toContain("portal: 'direct'");
    expect(op).toContain("acceptance_id: ack.id");
    expect(op).toContain("terms_version_id: ack.terms_version_id");
  });
});

describe("only an executed agreement can be produced", () => {
  it("a sent, declined or expired acknowledgement has nothing to supply", () => {
    expect(op).toContain("ack.status !== 'accepted'");
    expect(op).toContain("NO_AGREEMENT_ON_RECORD");
  });

  it("the panel offers the download on accepted rows alone", () => {
    /* Pinned to the CONDITION and the handler, not the button's wording.
       The condition moved with the surface: the four partner lists became
       one roster, so "is this acknowledgement accepted" is now asked on the
       partner's own row rather than in a separate acknowledgements list.
       Only an accepted agreement is an executed one; there is nothing to
       produce for the rest, and that is what is asserted. */
    const roster = readFileSync("src/components/aml/PartnerRosterPanel.tsx", "utf8");
    expect(roster).toContain('row.acknowledgementState === "accepted" && row.acknowledgementId');
    expect(roster).toContain("handlers.onDownloadAgreement(row.acknowledgementId!)");
    expect(panel).toContain("downloadAcknowledgement(row)");
    expect(panel).toContain("onDownloadAgreement:");
  });
});

describe("write once, and gated on the right authority", () => {
  it("a current copy is served, never re-rendered", () => {
    expect(op).toContain("hasCurrentAgreementCopy(record.agreement_storage_path)");
  });

  it("the artefact columns are written together or not at all", () => {
    expect(migration).toContain("dpa_agreement_artefact_complete");
    expect(migration).toMatch(/num_nonnulls\(agreement_storage_path, agreement_generated_at\)/);
    // Purely additive to a live table.
    expect(migration).not.toMatch(/DROP COLUMN|ALTER COLUMN|SET NOT NULL/);
  });

  it("access is an AML role, not a portal-admin module", () => {
    // There is no portal here to hold a module permission over, and the
    // authority that sent the agreement is the one that may retrieve it.
    expect(op).toContain("has_any_aml_role");
    expect(op).not.toContain("MODULE_BY_PORTAL");
  });

  it("producing a copy is a mutation, so CSRF covers it like the others", () => {
    expect(records).toContain("|| operation === 'download_direct_acknowledgement'");
  });

  it("retrieving a legal record is audited", () => {
    expect(op).toContain("security_audit_log");
    expect(op).toContain("partner_agreement_downloaded");
  });

  it("the client reports the revision the FUNCTION is running", () => {
    // Merging is not deploying; a mismatch must be visible rather than
    // discovered in a partner's inbox.
    expect(client).toContain("document_revision");
    expect(op).toContain("document_revision: AGREEMENT_DOCUMENT_REVISION");
  });
});
