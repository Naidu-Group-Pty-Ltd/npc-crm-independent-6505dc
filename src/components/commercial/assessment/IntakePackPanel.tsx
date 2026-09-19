/**
 * Offline intake pack panel.
 *
 * Download a white-labelled workbook and interview document, fill them in with
 * a client away from the app, then drop the workbook back here to populate the
 * assessment.
 *
 * The returned data is *staged*, never applied silently: the user sees exactly
 * what was read, what could not be read, and what it would overwrite, and
 * chooses to apply it. That is the same contract as the URL/document import on
 * the property step, for the same reason — an import that quietly overwrites a
 * figure someone has already checked is worse than no import at all.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  AlertTriangle, BookOpen, CheckCircle2, Download, Eye, FileSpreadsheet, FileText, Info,
  Loader2, Paperclip, ScanLine, Upload, UserCheck, UserPlus, X,
} from 'lucide-react';
import { PackDocumentViewer } from './PackDocumentViewer';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import {
  parseIntakeFile, extractFromDocument, isExtractableDocument, type ParsedPack,
} from '@/lib/ciAssessment/intakePack';
import type {
  PackDocumentKind, PackSourceDocument,
} from '@/lib/ciAssessment/intakePack/sourceDocuments';

/**
 * The four documents are inlined as base64, so they are worth about 240KB.
 * Loading that module lazily keeps it out of the assessment workspace chunk and
 * off the wire for everyone who never opens the intake pack step.
 */
const loadSourceDocuments = () => import('@/lib/ciAssessment/intakePack/sourceDocuments');
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

/** Extensions we will parse. Anything else is kept as a supporting document. */
const PACK_EXTENSIONS = ['.xlsx', '.xlsm', '.xls'];
const PACK_MIME_HINTS = ['spreadsheetml', 'ms-excel', 'excel'];
const MAX_PACK_BYTES = 15 * 1024 * 1024;
const MAX_SUPPORTING_BYTES = 25 * 1024 * 1024;

/**
 * The two documents, each offered two ways.
 *
 * The blank template is the file you fill in; the example is the same document
 * completed, and it is deliberately not downloadable — a filled-in copy of a
 * form is exactly the sort of thing that gets mistaken for the form itself and
 * sent to a client.
 */
const PACK_DOCUMENT_CARDS: ReadonlyArray<{
  kind: PackDocumentKind;
  title: string;
  icon: typeof FileSpreadsheet;
  description: string;
  exampleHint: string;
}> = [
  {
    kind: 'workbook',
    title: 'Workbook (Excel)',
    icon: FileSpreadsheet,
    description: 'The one that comes back in. Every answer maps straight into the assessment, with '
      + 'a sheet per section and room to list multiple entities, properties, liabilities and '
      + 'tenancies. Its Summary sheet closes the funding and shows an indicative coverage ratio '
      + 'while you are still with the client.',
    exampleHint: 'The example opens here with every sheet filled in, so you can see what belongs '
      + 'in each column before you start.',
  },
  {
    kind: 'guide',
    title: 'Interview guide (Word)',
    icon: FileText,
    description: 'A printable question script for sitting with a client — numbered sections with '
      + 'tick boxes, room for notes, a document checklist and a declaration to sign. Editable, but '
      + 'not read back in; use the workbook for that.',
    exampleHint: 'The example opens here as a completed interview, showing the level of detail an '
      + 'answer needs.',
  },
];

interface SupportingFile {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Kept so the file can be read for details after it has been listed. */
  file: File;
  extractable: boolean;
  /** Number of fields a completed extraction found, for the list badge. */
  extractedFields?: number;
}

interface Props {
  payload: AssessmentPayload;
  assessmentReference?: string;
  assessmentTitle?: string;
  /** Drives which document extraction prompt/area mapping is used. */
  segment?: 'commercial' | 'industrial';
  /** Applies the reviewed import. The caller merges and autosaves. */
  onApply: (parsed: ParsedPack) => void;
  /** Opens the Command Centre client flow. */
  onCreateClient: () => void;
  /** Set once the assessment is linked; switches the hand-off to "Open client". */
  linkedClientId?: string | null;
  /** Opens the linked client's own Commercial / Industrial file. */
  onOpenClient?: () => void;
  /**
   * Read-only assessment: the *import* is closed, the *documents* are not.
   *
   * These are two different things, and conflating them is what took the blank
   * templates away. Filling a template in and dropping it back changes the
   * assessment, so it stops when the assessment is complete; downloading the
   * blank template and reading the worked example change nothing at all, and
   * an adviser preparing the next client meeting from a finished assessment
   * still needs both. Only the drop zone and Apply honour this flag.
   */
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Detect a workbook by extension *and* MIME type: files dragged straight out of
 * an email client or a download folder frequently arrive with a mangled name
 * (`pack.xlsx (1)`, or no extension at all), and those were being demoted to
 * supporting documents instead of being parsed.
 */
function isPackFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  if (PACK_EXTENSIONS.some((extension) => lower.includes(extension))) return true;
  const type = (file.type || '').toLowerCase();
  return PACK_MIME_HINTS.some((hint) => type.includes(hint));
}

export function IntakePackPanel({
  payload, assessmentReference, assessmentTitle, segment = 'commercial',
  onApply, onCreateClient, linkedClientId, onOpenClient, disabled,
}: Props) {
  const [downloading, setDownloading] = useState<PackDocumentKind | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedPack | null>(null);
  const [packFile, setPackFile] = useState<string | null>(null);
  const [supporting, setSupporting] = useState<SupportingFile[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractStage, setExtractStage] = useState<string>('');
  const [extracted, setExtracted] = useState<{ pack: ParsedPack; fileName: string } | null>(null);
  const [viewing, setViewing] = useState<PackSourceDocument | null>(null);
  const counter = useRef(0);

  /**
   * Hand over the approved file itself.
   *
   * The bytes are not rebuilt, re-zipped or re-saved on the way out — the
   * anchor points straight at the inlined source and carries its approved file
   * name, so what lands in Downloads is the document that was signed off.
   */
  const downloadBlank = useCallback(async (kind: PackDocumentKind) => {
    setDownloading(kind);
    try {
      const { packSourceDocument } = await loadSourceDocuments();
      const source = packSourceDocument(kind, 'blank');
      const anchor = document.createElement('a');
      anchor.href = source.url;
      anchor.download = source.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      toast({
        title: `${source.fileName} downloaded`,
        description: kind === 'workbook'
          ? 'Fill it in with the client in Excel, then drop it back here to populate the assessment.'
          : 'A printable question guide for the meeting. Use the workbook for the data that comes back in.',
      });
    } catch (error) {
      toast({
        title: 'Could not start the download',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setDownloading(null);
    }
  }, []);

  /**
   * Accept a whole drop at once.
   *
   * The previous version processed files one at a time and flipped `parsing` on
   * and off inside the loop, which disabled the dropzone mid-drop and meant a
   * mixed drop (workbook + leases + rates notice) kept only whatever landed
   * last. Files are now partitioned first, every workbook is parsed, and the
   * supporting list is appended in a single state update.
   */
  const handleDrop = useCallback(async (accepted: File[], rejected: FileRejection[]) => {
    rejected.forEach((rejection) => {
      toast({
        title: `${rejection.file.name} was not accepted`,
        description: rejection.errors[0]?.message ?? 'Unsupported file.',
        variant: 'destructive',
      });
    });

    if (!accepted.length) return;

    const packs = accepted.filter(isPackFile);
    const others = accepted.filter((file) => !isPackFile(file));

    // ---- Supporting documents (batched, deduped on name + size) -----------
    const tooLarge: string[] = [];
    const keep = others.filter((file) => {
      if (file.size > MAX_SUPPORTING_BYTES) {
        tooLarge.push(file.name);
        return false;
      }
      return true;
    });
    if (tooLarge.length) {
      toast({
        title: `${tooLarge.length} file(s) were too large`,
        description: `${tooLarge.join(', ')} — the limit is ${formatBytes(MAX_SUPPORTING_BYTES)} each.`,
        variant: 'destructive',
      });
    }
    if (keep.length) {
      setSupporting((current) => {
        const seen = new Set(current.map((entry) => `${entry.name}:${entry.size}`));
        const additions: SupportingFile[] = [];
        keep.forEach((file) => {
          const signature = `${file.name}:${file.size}`;
          if (seen.has(signature)) return;
          seen.add(signature);
          counter.current += 1;
          additions.push({
            id: `file-${counter.current}`,
            name: file.name,
            size: file.size,
            type: file.type,
            file,
            extractable: isExtractableDocument(file),
          });
        });
        return additions.length ? [...current, ...additions] : current;
      });
    }

    if (!packs.length) {
      if (keep.length) {
        toast({
          title: `${keep.length} supporting document(s) attached`,
          description: 'Use "Read details" on a contract, IM or valuation to pull the missing figures out of it.',
        });
      }
      return;
    }

    // ---- Workbooks --------------------------------------------------------
    setParsing(true);
    try {
      const readable = packs.filter((file) => {
        if (file.size <= MAX_PACK_BYTES) return true;
        toast({
          title: 'Workbook too large',
          description: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_PACK_BYTES)}.`,
          variant: 'destructive',
        });
        return false;
      });

      let applied: ParsedPack | null = null;
      let appliedName: string | null = null;
      let best = -1;

      for (const file of readable) {
        try {
          const result = parseIntakeFile(await file.arrayBuffer());
          if (!result.recognised) {
            toast({
              title: `${file.name} is not an intake pack`,
              description: 'Download a fresh pack from this panel and use that one.',
              variant: 'destructive',
            });
            continue;
          }
          // If several workbooks come back in one drop, stage the one carrying
          // the most answers rather than whichever the browser listed last.
          if (result.counts.fields > best) {
            best = result.counts.fields;
            applied = result;
            appliedName = file.name;
          }
        } catch (error) {
          toast({
            title: `Could not read ${file.name}`,
            description: error instanceof Error ? error.message : 'The file may be corrupt.',
            variant: 'destructive',
          });
        }
      }

      if (applied) {
        setParsed(applied);
        setPackFile(appliedName);
        if (readable.length > 1) {
          toast({
            title: 'Multiple workbooks dropped',
            description: `Staged ${appliedName} — it held the most answers. Drop the others separately if you need them too.`,
          });
        }
      }
    } finally {
      setParsing(false);
    }
  }, []);

  /** Read a supporting contract/IM/valuation for the fields the pack is missing. */
  const readDetails = useCallback(async (entry: SupportingFile) => {
    setExtractingId(entry.id);
    setExtractStage('Preparing the document…');
    try {
      const result = await extractFromDocument(entry.file, segment, (stage, current, total) => {
        setExtractStage(stage === 'rendering'
          ? (total ? `Rendering page ${current} of ${total}…` : 'Rendering the document…')
          : 'Reading the document…');
      });
      if (!result.pack.counts.fields) {
        toast({
          title: 'Nothing usable found',
          description: `No assessment fields could be read from ${entry.name}. Enter them manually.`,
          variant: 'destructive',
        });
        return;
      }
      setExtracted(result);
      setSupporting((current) => current.map((item) => (
        item.id === entry.id ? { ...item, extractedFields: result.pack.counts.fields } : item
      )));
    } catch (error) {
      toast({
        title: `Could not read ${entry.name}`,
        description: error instanceof Error ? error.message : 'Try a text-based PDF or an image.',
        variant: 'destructive',
      });
    } finally {
      setExtractingId(null);
      setExtractStage('');
    }
  }, [segment]);

  const applyExtracted = () => {
    if (!extracted) return;
    onApply(extracted.pack);
    toast({
      title: 'Document values applied',
      description: `${extracted.pack.counts.fields} field(s) from ${extracted.fileName} applied. Each one is flagged for confirmation.`,
    });
    setExtracted(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    disabled: disabled || parsing,
    multiple: true,
  });


  const grouped = useMemo(() => {
    if (!parsed) return [];
    const map = new Map<string, number>();
    parsed.values.forEach((value) => {
      map.set(value.section, (map.get(value.section) ?? 0) + 1);
    });
    return Array.from(map.entries());
  }, [parsed]);

  /**
   * The four figures the calculation refuses to run without.
   *
   * Reading a pack is not the same as applying it, and the gap between the two
   * is where the "218 values read" / "required fields missing" confusion came
   * from. This says plainly which of the blockers the staged pack will clear.
   */
  const requiredCoverage = useMemo(() => {
    const checks: Array<{ label: string; filled: boolean }> = [];
    const source = parsed?.payload;
    const current = payload;
    const has = (packValue: unknown, currentValue: unknown) => {
      const usable = (value: unknown) => (typeof value === 'number' ? value > 0 : String(value ?? '').trim() !== '');
      return usable(packValue) || usable(currentValue);
    };
    checks.push({ label: 'Property address', filled: has(source?.property.address, current.property.address) });
    checks.push({ label: 'Purchase price', filled: has(source?.property.purchasePrice, current.property.purchasePrice) });
    checks.push({ label: 'Current valuation', filled: has(source?.property.currentValuation, current.property.currentValuation) });
    checks.push({ label: 'Interest rate', filled: has(source?.loan.actualRatePercent, current.loan.actualRatePercent) });
    return checks;
  }, [parsed, payload]);

  const errors = parsed?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = parsed?.issues.filter((issue) => issue.severity === 'warning') ?? [];


  const apply = () => {
    if (!parsed) return;
    onApply(parsed);
    setConfirmOpen(false);
    toast({
      title: 'Assessment populated',
      description: `${parsed.counts.fields} value(s) applied. Review each step before calculating.`,
    });
  };

  return (
    <section className="ci-step-panel space-y-5" aria-label="Offline intake pack">
      <div>
        <h2 className="ci-step-heading">Offline intake pack</h2>
        <p className="ci-step-description">
          A workbook and interview guide you can take to a client meeting. Download the blank
          template, fill it in away from the app in Excel or Word, then drop the workbook back here
          to populate this assessment. Individuals, trusts and SMSFs are all catered for — the pack
          captures the owning entity for every property and debt so the group position adds up. Each
          document has a completed example you can read here first.
        </p>
      </div>

      {/* ---- Templates and examples --------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        {PACK_DOCUMENT_CARDS.map((card) => (
          <div key={card.kind} className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <card.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {card.title}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{card.description}</p>

            {/*
              Two different jobs, kept visually distinct: the filled one is
              never a download, and the blank one is never opened here — you
              fill it in Excel or Word.
            */}
            <div className="mt-3 grid gap-2">
              {/* Never gated by `disabled`: see the prop's note. Handing over
                  an approved blank template is not an edit to this
                  assessment. */}
              <Button
                size="sm"
                onClick={() => downloadBlank(card.kind)}
                disabled={downloading !== null}
              >
                {downloading === card.kind
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                Download blank template
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={async () => {
                  const { packSourceDocument } = await loadSourceDocuments();
                  setViewing(packSourceDocument(card.kind, 'example'));
                }}
              >
                <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                View completed example
              </Button>
            </div>

            <p className="mt-2 flex items-start gap-1.5 text-[0.7rem] leading-4 text-muted-foreground">
              <BookOpen className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{card.exampleHint}</span>
            </p>
          </div>
        ))}
      </div>

      {/* ---- Drop zone --------------------------------------------------- */}
      <div>
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
          Return the completed pack
        </h3>
        <div
          {...getRootProps()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            isDragActive ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50',
            (disabled || parsing) && 'cursor-not-allowed opacity-60',
          )}
          role="button"
          tabIndex={0}
          aria-label="Drop the completed workbook and supporting documents here"
        >
          <input {...getInputProps()} />
          {parsing ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">Reading the workbook…</p>
            </>
          ) : (
            <>
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">
                {isDragActive ? 'Drop the files here' : 'Drag the completed pack here, or click to browse'}
              </p>
              <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                Drop as many files as you like at once. The Excel workbook populates the assessment;
                every other file — contracts, leases, information memoranda, valuations, rates
                notices, identification — is kept as a supporting document, and PDFs or images can be
                read for the address, price and valuation.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ---- Supporting documents ---------------------------------------- */}
      {supporting.length ? (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
            Supporting documents ({supporting.length})
          </h3>
          <ul className="space-y-1.5">
            {supporting.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{file.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatBytes(file.size)}
                    {file.extractedFields ? ` · ${file.extractedFields} field(s) read` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {file.extractable ? (
                    <Button
                      size="sm" variant="outline" className="h-7 px-2 text-xs"
                      onClick={() => readDetails(file)}
                      disabled={disabled || extractingId !== null}
                    >
                      {extractingId === file.id
                        ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <ScanLine className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                      {extractingId === file.id ? (extractStage || 'Reading…') : 'Read details'}
                    </Button>
                  ) : null}
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setSupporting((current) => current.filter((entry) => entry.id !== file.id))}
                    aria-label={`Remove ${file.name}`}
                    disabled={extractingId === file.id}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            These are listed here for the meeting record. Upload them to the client&apos;s document
            vault once the assessment is linked. &quot;Read details&quot; stages what a document says
            for your review — it never writes into the assessment on its own.
          </p>
        </div>
      ) : null}

      {/* ---- Document extraction review ----------------------------------- */}
      {extracted ? (
        <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ScanLine className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {extracted.pack.counts.fields} value(s) read from a document
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{extracted.fileName}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setExtracted(null)}>Discard</Button>
              <Button size="sm" onClick={applyExtracted} disabled={disabled}>Apply to assessment</Button>
            </div>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {extracted.pack.values.map((value) => (
              <li
                key={value.path}
                className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-card px-2.5 py-1.5"
              >
                <span className="text-xs text-muted-foreground">{value.label}</span>
                <span className="truncate text-sm font-medium tabular-nums text-foreground">
                  {typeof value.value === 'number'
                    ? value.value.toLocaleString('en-AU')
                    : String(value.value)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">
            Applying fills only the fields listed above, and only where they are blank or being
            replaced deliberately. Interest rate and loan structure are never taken from a document —
            enter those on the loan step.
          </p>
        </div>
      ) : null}


      {/* ---- Parse result ------------------------------------------------ */}
      {parsed && parsed.recognised ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                Pack read: {parsed.counts.fields} value(s)
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{packFile}</p>
            </div>
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={disabled || !parsed.counts.fields}>
              Review and apply
            </Button>
          </div>

          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <p className="text-xs font-semibold text-foreground">
              Nothing is in the assessment until you apply it
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {requiredCoverage.map((check) => (
                <li key={check.label} className="flex items-center gap-1.5 text-xs">
                  {check.filled
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />}
                  <span className={check.filled ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                    {check.label}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Anything still flagged is not in the workbook either — attach the contract, valuation or
              lender term sheet above and use &quot;Read details&quot;, or enter it on the step directly.
            </p>
          </div>


          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ['Entities', parsed.counts.entities],
              ['Financial periods', parsed.counts.incomePeriods],
              ['Add-backs', parsed.counts.addbacks],
              ['Properties', parsed.counts.portfolioAssets],
              ['Liabilities', parsed.counts.liabilities],
              ['Tenancies', parsed.counts.tenancies],
            ] as const).map(([label, count]) => (
              <div key={label} className="rounded-md border border-border bg-muted/25 px-2.5 py-2">
                <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{count}</dd>
              </div>
            ))}
          </dl>

          {grouped.length ? (
            <div className="flex flex-wrap gap-1.5">
              {grouped.map(([section, count]) => (
                <Badge key={section} variant="outline" className="ci-segment-tag">
                  {section}: {count}
                </Badge>
              ))}
            </div>
          ) : null}

          {errors.length ? (
            <div className="ci-warning-row ci-warning-critical">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {errors.length} value(s) were not imported
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {errors.slice(0, 6).map((issue) => (
                    <li key={`${issue.sheet}-${issue.message}`}>{issue.sheet}: {issue.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {warnings.length ? (
            <div className="ci-warning-row ci-warning-warning">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{warnings.length} thing(s) to check</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {warnings.slice(0, 6).map((issue) => (
                    <li key={`${issue.sheet}-${issue.message}`}>{issue.sheet}: {issue.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Proceed ----------------------------------------------------- */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          {linkedClientId ? 'This assessment belongs to a client' : 'If the client wishes to proceed'}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {linkedClientId
            ? 'Everything gathered here — the assessment, its calculations and its reports — sits in the '
              + 'client’s own Commercial / Industrial file. That is where it is read from.'
            : 'The assessment stays standalone until you link it. You can create the client here or on the '
              + 'final step, where the completed assessment is linked and the portfolio is reconciled '
              + 'against what is already on file.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {linkedClientId && onOpenClient ? (
            <Button size="sm" variant="outline" onClick={onOpenClient}>
              <UserCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Open client
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onCreateClient}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Create a new client
            </Button>
          )}
        </div>
      </div>

      <PackDocumentViewer
        document={viewing}
        open={viewing !== null}
        onOpenChange={(next) => { if (!next) setViewing(null); }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply {parsed?.counts.fields ?? 0} imported value(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the matching fields in this assessment with the values from the workbook,
              including {parsed?.counts.entities ?? 0} borrowing entit
              {(parsed?.counts.entities ?? 0) === 1 ? 'y' : 'ies'},{' '}
              {parsed?.counts.portfolioAssets ?? 0} propert
              {(parsed?.counts.portfolioAssets ?? 0) === 1 ? 'y' : 'ies'} and{' '}
              {parsed?.counts.liabilities ?? 0} liabilit
              {(parsed?.counts.liabilities ?? 0) === 1 ? 'y' : 'ies'}. Every imported value is marked
              as needing confirmation, and nothing is calculated until you run it. You can review
              each step afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={apply}>Apply to assessment</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
