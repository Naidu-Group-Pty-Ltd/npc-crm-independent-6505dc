/**
 * One document, said in a way a reviewer can act on without opening it.
 *
 * The list rendered `filename` alone, so three client camera uploads read as
 * `17868163460724899975067990115218.jpg` and two more like it. The category
 * was NOT missing — every one of those rows carries a correct
 * `requirement_id` — the server selected `*` and never joined it.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AmlDocumentRow, type AmlDocumentRowDocument } from "../AmlDocumentRow";

const fmt = (v: string | null | undefined) => (v ? "16 Aug 2026, 3:53 am" : "—");

/** Transcribed from aml.documents. */
const cameraUpload: AmlDocumentRowDocument = {
  id: "bf59c72c-adcf-41f7-ab19-381b901a6482",
  filename: "17868163460724899975067990115218.jpg",
  status: "uploaded",
  uploaded_at: "2026-08-15T17:53:10Z",
  uploaded_by_type: "client",
  requirement: { code: "photo_id_primary", label: "Photo ID — primary (passport or driver licence)" },
};

const renderRow = (
  document: AmlDocumentRowDocument,
  over: Partial<React.ComponentProps<typeof AmlDocumentRow>> = {},
) => {
  const props = {
    document, canWrite: true, formatDateTime: fmt,
    onDownload: vi.fn(), onReview: vi.fn(), onRename: vi.fn(),
    ...over,
  };
  render(<ul>{<AmlDocumentRow {...props} />}</ul>);
  return props;
};

describe("AmlDocumentRow", () => {
  it("names a meaningless camera upload after the requirement it was collected for", () => {
    renderRow(cameraUpload);
    expect(screen.getByText("Photo ID — primary.jpg")).toBeInTheDocument();
  });

  it("shows the category, read from the requirement", () => {
    // The whole point: a reviewer can tell a passport from a bank statement
    // without opening the file.
    renderRow(cameraUpload);
    expect(screen.getByText("Photo ID — primary (passport or driver licence)")).toBeInTheDocument();
  });

  it("says who sent it and when", () => {
    renderRow(cameraUpload);
    expect(screen.getByText(/Client · 16 Aug 2026/)).toBeInTheDocument();
  });

  it("keeps the original filename visible when the displayed name differs", () => {
    // Preserved AND shown — the audit record is not merely retained, it is
    // on screen beside the friendly name.
    renderRow(cameraUpload);
    expect(screen.getByText(/file: 17868163460724899975067990115218\.jpg/)).toBeInTheDocument();
  });

  it("does not repeat the filename when it is already the displayed name", () => {
    renderRow({ ...cameraUpload, filename: "ANZ statement.pdf", requirement: null });
    expect(screen.getByText("ANZ statement.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/file: ANZ statement\.pdf/)).not.toBeInTheDocument();
  });

  it("says plainly when a document is not linked to a requirement", () => {
    // The one production row with a null requirement_id. Silence here would
    // read as "no category", which is different from "we do not know".
    renderRow({ ...cameraUpload, requirement: null });
    expect(screen.getByText("Not linked to a requirement")).toBeInTheDocument();
  });

  it("prefers a name a human already gave it", () => {
    renderRow({ ...cameraUpload, display_name: "Passport photo page" });
    expect(screen.getByText("Passport photo page")).toBeInTheDocument();
  });

  it("renames through the caller, and never touches the filename", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderRow(cameraUpload, { onRename });

    fireEvent.click(screen.getByRole("button", { name: /Rename Photo ID/ }));
    const input = screen.getByRole("textbox", { name: /Rename Photo ID/ });
    fireEvent.change(input, { target: { value: "Passport photo page" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(cameraUpload.id, "Passport photo page"));
  });

  it("saves on Enter and abandons on Escape", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderRow(cameraUpload, { onRename });

    fireEvent.click(screen.getByRole("button", { name: /Rename Photo ID/ }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Rename Photo ID/ }), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
  });

  it("offers no rename to a reader", () => {
    // Renaming a compliance document is a write, and reviewers who may not
    // write must not be offered it.
    renderRow(cameraUpload, { canWrite: false });
    expect(screen.queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
  });

  it("offers Accept and Reject only on an unreviewed document, and only to a writer", () => {
    renderRow(cameraUpload);
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();

    render(<ul><AmlDocumentRow
      document={{ ...cameraUpload, status: "accepted" }}
      canWrite formatDateTime={fmt}
      onDownload={vi.fn()} onReview={vi.fn()} onRename={vi.fn()}
    /></ul>);
    // The accepted one adds no second Accept button.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(1);
  });
});
