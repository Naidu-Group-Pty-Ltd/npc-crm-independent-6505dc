/**
 * The template desk — the whole of the platform's involvement in partner
 * agreements.
 *
 * ONE component, rendered by both the Command Centre and the Finance Portal.
 * That is deliberate and is the point: both parties are looking at the same
 * neutral resource on the same terms, and — since the download became the
 * shipped file rather than a render — at the same bytes. Two implementations
 * would drift, and the first thing to drift would be how strongly each side is
 * told the platform is not involved.
 *
 * There is no "configure", no "issue", no "send to partner" and no status.
 * Downloading is the end of it — see `templateResource.pure.ts`.
 *
 * ## Why the contents are on the card
 *
 * A template used to be a title and one sentence, and the only way to find out
 * what was in it was to download it and open Word. These are long documents —
 * ten and fifteen sections, commercial schedules, consent forms, an execution
 * page — and which one you need depends on which way the referral runs. The
 * section list is read from the same locked content modules that
 * `agreementTemplateFiles.spec.ts` checks the shipped `.docx` against, so this
 * cannot describe a document different from the one the button hands over.
 */
import { useState } from 'react';
import { ChevronDown, Download, FileText, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  AGREEMENT_TEMPLATE_SUMMARIES,
  TEMPLATE_NEUTRALITY_NOTICE,
  TEMPLATE_RESOURCE_INTRO,
  agreementTemplateContents,
  agreementTemplateFile,
  formatTemplateFileSize,
  type AgreementTemplateKey,
} from '@/lib/agreements';

export interface AgreementTemplateResourcesProps {
  /**
   * Word is the only format, and deliberately so: an external platform can
   * ingest it, a reviewer can mark it up, and the fields are meant to be
   * completed. A PDF of a blank template is a document nobody can fill in.
   */
  onDownloadDocx: (key: AgreementTemplateKey) => Promise<void>;
}

function TemplateContents({ templateKey }: { templateKey: AgreementTemplateKey }) {
  const [open, setOpen] = useState(false);
  const entries = agreementTemplateContents(templateKey);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/40">
        <span>What&rsquo;s inside &middot; {entries.length} sections</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          {entries.map((entry) => (
            <li key={entry.badge} className="flex gap-2.5 text-xs leading-relaxed">
              <span className="mt-px w-9 shrink-0 font-mono text-[0.6875rem] uppercase text-muted-foreground">
                {entry.badge}
              </span>
              <span className="min-w-0">
                <span className="font-medium text-foreground">{entry.heading}</span>
                {entry.detail ? (
                  <span className="text-muted-foreground"> &mdash; {entry.detail}</span>
                ) : null}
                {/* The template itself says to delete these pages before it is
                    sent. Saying so here stops somebody issuing the guidance. */}
                {entry.guidance ? (
                  <span className="text-muted-foreground"> (remove before issue)</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AgreementTemplateResources({ onDownloadDocx }: AgreementTemplateResourcesProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<void>) => {
    try {
      setBusy(id);
      await action();
      toast.success('Template downloaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The template could not be downloaded.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{TEMPLATE_RESOURCE_INTRO}</p>

      {/* Stated before the downloads, not after them. A notice underneath the
          thing it qualifies is a notice most people never reach. */}
      <div className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1.5">
          {TEMPLATE_NEUTRALITY_NOTICE.map((line) => (
            <p key={line} className="text-xs leading-relaxed text-muted-foreground">{line}</p>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {AGREEMENT_TEMPLATE_SUMMARIES.map((template) => {
          const file = agreementTemplateFile(template.key);
          return (
            <Card key={template.key}>
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-serif text-base font-semibold leading-snug text-foreground">
                      {template.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {template.referralFlow}
                    </p>
                  </div>
                </div>

                <TemplateContents templateKey={template.key} />

                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => run(`${template.key}:docx`, () => onDownloadDocx(template.key))}
                  >
                    {busy === `${template.key}:docx`
                      ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Word (.docx)
                  </Button>
                  {/* What you are about to get, before you get it. */}
                  <span className="text-xs text-muted-foreground">
                    Version {file.documentVersion} &middot; {formatTemplateFileSize(file.byteLength)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default AgreementTemplateResources;
