import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, FileText, Pencil, X } from "lucide-react";
import {
  DOCUMENT_NAME_MAX,
  resolveDocumentDisplayName,
} from "../../../supabase/functions/_shared/aml/documentNaming.pure";

/**
 * One document, said in a way a reviewer can act on without opening it.
 *
 * ── What was wrong, and what was not ──────────────────────────────────
 * The list rendered `d.filename` and nothing else, so three client camera
 * uploads read as `17868163460724899975067990115218.jpg` and two more like
 * it. A reviewer had to open every one to find out which was the passport.
 *
 * The category was NOT missing. Every one of those rows carries a correct
 * `requirement_id` — in production they resolve to `photo_id_primary`,
 * `proof_of_address` and `source_of_funds`. The server simply selected `*`
 * and never joined the requirement, so the answer was one column away the
 * whole time.
 *
 * ── Renaming changes what people read, and nothing else ───────────────
 * `filename` is never rewritten; it stays as the record of the bytes that
 * arrived, and is shown underneath whenever the display name differs from
 * it, so the original is visible rather than merely retained. No foreign key
 * moves, so the document's case, requirement, client and Passport bindings
 * are exactly what they were.
 */

export interface AmlDocumentRowDocument {
  id: string;
  filename: string;
  display_name?: string | null;
  status?: string | null;
  uploaded_at?: string | null;
  uploaded_by_type?: string | null;
  rejection_reason?: string | null;
  requirement?: { code?: string | null; label?: string | null; required?: boolean | null } | null;
}

export interface AmlDocumentRowProps {
  document: AmlDocumentRowDocument;
  canWrite: boolean;
  busy?: boolean;
  formatDateTime: (value: string | null | undefined) => string;
  onDownload: (id: string) => void;
  onReview: (id: string, decision: "accepted" | "rejected") => void;
  onRename: (id: string, displayName: string) => Promise<void> | void;
}

/** Who sent it. `client` and `staff` are the two the table records. */
function submittedBy(type: string | null | undefined): string {
  if (type === "client") return "Client";
  if (type === "staff") return "Command Centre";
  if (type === "system") return "System";
  return "Unknown";
}

export function AmlDocumentRow({
  document, canWrite, busy, formatDateTime, onDownload, onReview, onRename,
}: AmlDocumentRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const name = resolveDocumentDisplayName({
    filename: document.filename,
    display_name: document.display_name,
    requirement_label: document.requirement?.label ?? null,
  });
  // Shown only when it differs, so the original is visible without adding
  // noise to a row whose name already is the filename.
  const showOriginal = name !== document.filename && Boolean(document.filename);
  const status = String(document.status ?? "uploaded").replace(/_/g, " ");

  const startEdit = () => { setDraft(document.display_name ?? name); setEditing(true); };

  const save = async () => {
    setSaving(true);
    try {
      await onRename(document.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          {editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Input
                value={draft}
                maxLength={DOCUMENT_NAME_MAX}
                autoFocus
                aria-label={`Rename ${name}`}
                className="h-7 max-w-xs text-sm"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={saving} onClick={() => void save()}>
                <Check aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only">Save name</span>
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={saving} onClick={() => setEditing(false)}>
                <X aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="sr-only">Cancel rename</span>
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">{name}</span>
              {canWrite && (
                <Button
                  size="sm" variant="ghost" className="h-6 shrink-0 px-1.5"
                  onClick={startEdit}
                  aria-label={`Rename ${name}`}
                >
                  <Pencil aria-hidden="true" className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          {/* Category — read from the requirement, never inferred from a name. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {document.requirement?.label ? (
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-xs font-normal text-primary">
                {document.requirement.label}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                Not linked to a requirement
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {submittedBy(document.uploaded_by_type)} · {formatDateTime(document.uploaded_at)}
            {showOriginal ? ` · file: ${document.filename}` : ""}
            {document.rejection_reason ? ` · rejected: ${document.rejection_reason}` : ""}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className="capitalize">{status}</Badge>
        <Button size="sm" variant="ghost" onClick={() => onDownload(document.id)}>Download</Button>
        {canWrite && document.status === "uploaded" && (
          <>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onReview(document.id, "accepted")}>
              Accept
            </Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onReview(document.id, "rejected")}>
              Reject
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
