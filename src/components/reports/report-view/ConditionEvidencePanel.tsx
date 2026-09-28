/**
 * Condition evidence — the building half of Property Risk, recorded on the
 * report page.
 *
 * Risk scores only when its observations span two independent categories
 * (`riskModelD.pure.ts`). The planning registers answer the SITE category on
 * every generation; the BUILDING category can only be answered by a condition
 * document — a building inspection report, above all — and this is where one
 * is recorded. The method was approved on 28 Sep 2026
 * (`CONDITION_METHOD_ACTIVATION`), so an admissible record now contributes a
 * building observation the next time the Compass is generated. Nothing here
 * writes a score: the generator reads the register and decides.
 *
 * Three rules carry it:
 *
 *   * **One rule, rendered and enforced.** The form validates with
 *     `conditionRecordSubmission.pure.ts` — the module the edge operation
 *     refuses with — and shows the validator's own reading of the draft
 *     before anything is submitted.
 *   * **The document is uploaded, never pointed at.** A record that says the
 *     document is held is checked against the store by the server; a
 *     transcription alone is evidence and never an observation.
 *   * **An unapplied table is a named state.** The server answers
 *     `tableApplied: false` with the reason, and the panel offers no submit
 *     button, because a control that can only fail is worse than none.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, FileCheck2, FileUp, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import {
  ADMISSIBLE_SOURCES,
  FINDING_SEVERITIES,
  type ConditionReading,
  type ConditionSourceKind,
  type FindingSeverity,
} from '@/lib/reports/conditionRecord.pure';
import {
  CONDITION_DOCUMENT_MAX_BYTES,
  CONDITION_DOCUMENT_TYPES,
  conditionDocumentExtension,
  decideConditionSubmission,
  parseConditionSubmission,
  type ConditionSubmissionPayload,
} from '@/lib/reports/conditionRecordSubmission.pure';

const KIND_LABELS: Record<ConditionSourceKind, string> = {
  building_inspection: 'Building inspection report',
  strata_report: 'Strata report',
  building_certificate: 'Building certificate',
  vendor_statement: "Vendor's statement",
};

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  safety_hazard: 'Safety hazard',
  major_defect: 'Major defect',
  minor_defect: 'Minor defect',
  unfunded_liability: 'Unfunded liability (strata)',
};

const COVERAGE_OPTIONS = [
  ['whole_dwelling', 'The whole dwelling (interior, exterior, roof space, subfloor)'],
  ['partial_dwelling', 'Part of the dwelling'],
  ['common_property', "The scheme's common property"],
  ['specified_works', 'The works certified, and nothing else'],
  ['disclosure_only', 'What the issuer chose to disclose'],
] as const;

const CONCLUSION_OPTIONS = [
  ['not_concluded', 'The document states no conclusion'],
  ['no_defects_identified', 'The document states no major defects were identified'],
  ['defects_identified', 'The document states defects were identified'],
] as const;

const ACCEPT = Object.keys(CONDITION_DOCUMENT_TYPES).map((e) => `.${e}`).join(',');

interface StoredConditionRecord {
  id: string;
  documentKind: string;
  issuer: string;
  issuedOn: string;
  hasDocument: boolean;
  reading: ConditionReading;
}

interface FindingDraft {
  element: string;
  severity: FindingSeverity | '';
  note: string;
}

const EMPTY_FINDING: FindingDraft = { element: '', severity: '', note: '' };

interface Props {
  /** The report the record is filed against — the Compass a variant came from. */
  reportId: string;
  propertyAddress: string;
}

export function ConditionEvidencePanel({ reportId, propertyAddress }: Props) {
  const [loading, setLoading] = useState(true);
  const [tableApplied, setTableApplied] = useState(true);
  const [tableReason, setTableReason] = useState<string | null>(null);
  const [records, setRecords] = useState<StoredConditionRecord[]>([]);
  const [bestReading, setBestReading] = useState<ConditionReading | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [documentKind, setDocumentKind] = useState<ConditionSourceKind>('building_inspection');
  const [issuer, setIssuer] = useState('');
  const [issuerLicence, setIssuerLicence] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [inspectedOn, setInspectedOn] = useState('');
  const [documentReference, setDocumentReference] = useState('');
  const [documentAddress, setDocumentAddress] = useState(propertyAddress);
  const [scope, setScope] = useState('');
  const [scopeCoverage, setScopeCoverage] = useState('');
  const [exclusionsText, setExclusionsText] = useState('');
  const [conclusion, setConclusion] = useState('not_concluded');
  const [issuerVerified, setIssuerVerified] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    const { data, error } = await invokeSecureFunction('manage-investment-reports', {
      action: 'getConditionRecords',
      reportId,
    });
    setLoading(false);
    if (error || !data?.success) {
      // A failed read is not an empty register: say nothing false.
      setLoadFailed(true);
      return;
    }
    setTableApplied(data.tableApplied !== false);
    setTableReason(typeof data.reason === 'string' ? data.reason : null);
    setRecords(Array.isArray(data.records) ? data.records : []);
    setBestReading(data.bestReading ?? null);
  }, [reportId]);

  useEffect(() => { void load(); }, [load]);

  // Held means uploaded. The verification level follows the file, so the
  // form cannot claim a document it does not carry.
  const verification = file ? (issuerVerified ? 'issuer_verified' : 'document_held') : 'transcribed_only';

  const payload: ConditionSubmissionPayload = useMemo(() => ({
    documentKind,
    issuer,
    issuerLicence,
    issuedOn,
    inspectedOn,
    documentReference,
    documentPropertyAddress: documentAddress,
    scope,
    scopeCoverage: scopeCoverage || undefined,
    exclusions: exclusionsText.split('\n').map((l) => l.trim()).filter(Boolean),
    conclusion,
    verification,
    findings: findings.map((f) => ({ element: f.element, severity: f.severity, note: f.note || undefined })),
  }), [conclusion, documentAddress, documentKind, documentReference, exclusionsText,
    findings, inspectedOn, issuedOn, issuer, issuerLicence, scope, scopeCoverage, verification]);

  // The validator's live reading of the draft — the same rule the server
  // enforces, shown before the click rather than after it. A pending upload
  // stands in for the path the server will check.
  const draftDecision = useMemo(() => {
    const draft = file ? { ...payload, fileId: 'pending-upload' } : payload;
    const parsed = parseConditionSubmission(draft, { reportId });
    if ('refusal' in parsed) return { statement: parsed.refusal.statement, blocked: true, admissible: false };
    const decision = decideConditionSubmission(
      parsed.record,
      { propertyAddress, reportId },
      new Date().toISOString(),
    );
    return {
      statement: decision.reading.statement,
      blocked: !decision.storable,
      admissible: decision.reading.admissible,
    };
  }, [file, payload, propertyAddress, reportId]);

  const chooseFile = (chosen: File | null) => {
    setFileError(null);
    if (!chosen) { setFile(null); return; }
    if (!conditionDocumentExtension(chosen.name)) {
      setFileError(`Attach the document as ${Object.keys(CONDITION_DOCUMENT_TYPES).join(', ').toUpperCase()}.`);
      return;
    }
    if (chosen.size > CONDITION_DOCUMENT_MAX_BYTES) {
      setFileError(`The document must be under ${Math.round(CONDITION_DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    setFile(chosen);
  };

  const resetForm = () => {
    setFindings([]);
    setIssuer(''); setIssuerLicence(''); setIssuedOn(''); setInspectedOn('');
    setDocumentReference(''); setScope(''); setScopeCoverage('');
    setExclusionsText(''); setConclusion('not_concluded');
    setIssuerVerified(false); setFile(null); setFileError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const uploadDocument = async (chosen: File): Promise<string> => {
    const ext = conditionDocumentExtension(chosen.name);
    const { data: ticket, error } = await invokeSecureFunction('manage-investment-reports', {
      action: 'requestConditionDocumentUpload',
      reportId,
      data: { fileName: chosen.name, fileSize: chosen.size },
    });
    if (error || !ticket?.success) throw new Error(error?.message || ticket?.error || 'The upload could not be prepared.');
    const { error: uploadError } = await supabase.storage
      .from(ticket.bucket)
      .uploadToSignedUrl(ticket.path, ticket.token, chosen, {
        contentType: ticket.contentType || (ext ? CONDITION_DOCUMENT_TYPES[ext] : chosen.type),
      });
    if (uploadError) throw new Error('The document did not upload. Check the connection and try again.');
    return ticket.path as string;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const documentPath = file ? await uploadDocument(file) : undefined;
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'submitConditionRecord',
        reportId,
        data: { ...payload, documentPath },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || 'The condition record was not stored.');
      toast.success('Condition record stored.', {
        description: data.reading?.admissible
          ? 'Regenerate the Compass to score Property Risk from it.'
          : data.reading?.statement,
      });
      setDialogOpen(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The condition record was not stored.');
    } finally {
      setSubmitting(false);
    }
  };

  const openDocument = async (recordId: string) => {
    const { data, error } = await invokeSecureFunction('manage-investment-reports', {
      action: 'getConditionDocumentUrl',
      reportId,
      data: { recordId },
    });
    if (error || !data?.url) {
      toast.error(error?.message || 'The document could not be opened.');
      return;
    }
    window.open(data.url, '_blank', 'noopener,noreferrer');
  };

  const updateFinding = (i: number, patch: Partial<FindingDraft>) => {
    setFindings((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  };

  return (
    <Card className="overflow-hidden border-border/80 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-border bg-muted/40 p-2 text-muted-foreground shadow-sm">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base text-foreground">Condition evidence</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Property Risk scores once it has evidence about the site and about the building. The
              planning registers supply the site; a building inspection report supplies the
              building. Record one here and the next Compass generation reads it.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 border-t bg-muted/10 p-4 sm:p-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Reading the condition records…</p>
        ) : loadFailed ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground">
              The condition records could not be read just now. This says nothing about whether
              records exist.
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        ) : !tableApplied ? (
          <p className="text-sm text-muted-foreground">{tableReason}</p>
        ) : (
          <>
            {bestReading ? (
              <div className="space-y-1">
                <Badge variant="outline" className="text-xs">
                  {bestReading.admissible ? 'Used for Property Risk' : 'Recorded as evidence only'}
                </Badge>
                <p className="text-sm text-foreground">{bestReading.statement}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No condition document is recorded for this property, so Property Risk is not
                scored.
              </p>
            )}
            {records.length > 0 && (
              <ul className="space-y-2">
                {records.map((r) => (
                  <li key={r.id} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {KIND_LABELS[r.documentKind as ConditionSourceKind] ?? r.documentKind}
                      </span>
                      {r.hasDocument && (
                        <Button variant="link" size="sm" className="h-auto p-0 text-xs"
                          onClick={() => void openDocument(r.id)}>
                          Open document
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.issuer} · issued {r.issuedOn}
                    </p>
                    {!r.reading.admissible && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.reading.statement}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Record a condition document
            </Button>
          </>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!submitting) setDialogOpen(open); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record a condition document</DialogTitle>
            <DialogDescription>
              Attach the document and record what it says: its issuer, its dates, what it examined
              and what it found. The reading at the foot is the same rule the server applies.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-file">The document</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                  <FileUp className="mr-1.5 h-4 w-4" /> {file ? 'Replace file' : 'Attach file'}
                </Button>
                <span className="min-w-0 truncate text-sm text-muted-foreground">
                  {file ? file.name : 'PDF, JPG or PNG. Without it the record is evidence only.'}
                </span>
                <input
                  ref={fileInput}
                  id="cr-file"
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-kind">Document kind</Label>
              <Select value={documentKind} onValueChange={(v) => setDocumentKind(v as ConditionSourceKind)}>
                <SelectTrigger id="cr-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ADMISSIBLE_SOURCES.map((k) => (
                    <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-issuer">Issuer</Label>
              <Input id="cr-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)}
                placeholder="The firm or person who issued it" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-licence">Licence or registration (optional)</Label>
              <Input id="cr-licence" value={issuerLicence} onChange={(e) => setIssuerLicence(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-issued">Issued on</Label>
              <Input id="cr-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-inspected">Inspected on (where it differs)</Label>
              <Input id="cr-inspected" type="date" value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-ref">Issuer's reference (optional)</Label>
              <Input id="cr-ref" value={documentReference} onChange={(e) => setDocumentReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-address">Property, as the document identifies it</Label>
              <Input id="cr-address" value={documentAddress} onChange={(e) => setDocumentAddress(e.target.value)} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-scope">What was examined, in the issuer's own words</Label>
              <Textarea id="cr-scope" value={scope} onChange={(e) => setScope(e.target.value)} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cr-coverage">How wide that examination was</Label>
              <Select value={scopeCoverage} onValueChange={setScopeCoverage}>
                <SelectTrigger id="cr-coverage"><SelectValue placeholder="Not recorded" /></SelectTrigger>
                <SelectContent>
                  {COVERAGE_OPTIONS.map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-conclusion">The document's own conclusion</Label>
              <Select value={conclusion} onValueChange={setConclusion}>
                <SelectTrigger id="cr-conclusion"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONCLUSION_OPTIONS.map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cr-exclusions">What it did not reach (one per line, optional)</Label>
              <Textarea id="cr-exclusions" value={exclusionsText}
                onChange={(e) => setExclusionsText(e.target.value)} rows={2} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Findings, as the document records them</Label>
              {findings.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                  <Input value={f.element} placeholder="Building element" aria-label={`Finding ${i + 1} element`}
                    onChange={(e) => updateFinding(i, { element: e.target.value })} />
                  <Select value={f.severity} onValueChange={(v) => updateFinding(i, { severity: v as FindingSeverity })}>
                    <SelectTrigger className="w-full sm:w-[200px]" aria-label={`Finding ${i + 1} severity`}>
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      {FINDING_SEVERITIES.map((s) => (
                        <SelectItem key={s} value={s}>{SEVERITY_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input value={f.note} placeholder="Issuer's words (optional)" aria-label={`Finding ${i + 1} note`}
                    onChange={(e) => updateFinding(i, { note: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove finding ${i + 1}`}
                    onClick={() => setFindings((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm"
                onClick={() => setFindings((prev) => [...prev, { ...EMPTY_FINDING }])}>
                <Plus className="mr-1.5 h-4 w-4" /> Add a finding
              </Button>
            </div>

            {file && (
              <label className="flex items-start gap-2 text-sm text-foreground sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={issuerVerified}
                  onChange={(e) => setIssuerVerified(e.target.checked)}
                />
                <span>I have confirmed the issuer's licence or registration against the regulator's register.</span>
              </label>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {draftDecision.admissible ? 'Used for Property Risk' : 'What this record establishes'}
            </p>
            <p className="mt-1 text-sm text-foreground">{draftDecision.statement}</p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting || draftDecision.blocked}>
              {submitting ? (file ? 'Uploading…' : 'Storing…') : 'Store the record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
