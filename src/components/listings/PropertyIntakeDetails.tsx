import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { INTAKE_FIELDS } from '@/lib/airtableIntakeFields';
import {
  Mail,
  Phone,
  Smartphone,
  Building2,
  Globe,
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Tag,
  Hash,
  Activity,
  Sparkles,
} from 'lucide-react';

interface PropertyIntakeDetailsProps {
  fields: Record<string, any>;
}

const fmtPct = (v: any) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!isFinite(n)) return null;
  const pct = n <= 1 ? n * 100 : n;
  return Math.round(pct);
};

const getSafeWebUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

const Row = ({ label, value, icon: Icon, mono }: { label: string; value: any; icon?: any; mono?: boolean }) => {
  if (value === null || value === undefined || value === '' || value === false) return null;
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return (
    <div className="flex items-start gap-2 text-sm">
      {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
      <span className="text-muted-foreground min-w-[140px] shrink-0">{label}:</span>
      <span className={mono ? 'font-mono text-xs break-all' : 'break-words'}>{display}</span>
    </div>
  );
};

const ConfBar = ({ label, value }: { label: string; value: any }) => {
  const pct = fmtPct(value);
  if (pct === null) return null;
  const tone =
    pct >= 80 ? 'bg-success' : pct >= 60 ? 'bg-primary' : pct >= 40 ? 'bg-warning' : 'bg-destructive';
  const ring =
    pct >= 80 ? 'ring-success/20' : pct >= 60 ? 'ring-primary/20' : pct >= 40 ? 'ring-warning/20' : 'ring-destructive/20';
  return (
    <div className={`rounded-lg border border-border/60 bg-card/40 p-3 ring-1 ${ring}`}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const SectionCard = ({ icon: Icon, title, tone = 'default', children }: { icon?: any; title: string; tone?: 'default' | 'destructive' | 'warning'; children: React.ReactNode }) => {
  const border = tone === 'destructive' ? 'border-destructive/30 bg-destructive/5' : tone === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-border/60 bg-card/30';
  const titleTone = tone === 'destructive' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : 'text-muted-foreground';
  return (
    <section className={`rounded-xl border ${border} p-5`}>
      <h3 className={`text-sm font-semibold uppercase tracking-wider ${titleTone} mb-3 flex items-center gap-2`}>
        {Icon && <Icon className="h-3.5 w-3.5" />} {title}
      </h3>
      {children}
    </section>
  );
};

export function PropertyIntakeDetails({ fields }: PropertyIntakeDetailsProps) {
  const f = fields || {};
  const sourceWebLink = f[INTAKE_FIELDS.sourceWebLink];
  const safeSourceWebUrl = getSafeWebUrl(sourceWebLink);

  // Only render if this looks like a Property Intake Master record.
  //
  // The column names come from the shared constant rather than being spelled out
  // here. This file was, for a long time, the only place in the codebase that had
  // them right — the main projection was reading names from a different table
  // entirely — so keeping a second hand-maintained copy is how that divergence
  // happened in the first place.
  const looksLikePIM =
    INTAKE_FIELDS.extractionConfidence in f ||
    INTAKE_FIELDS.overallQuality in f ||
    INTAKE_FIELDS.processingStage in f ||
    INTAKE_FIELDS.uniqueKey in f ||
    INTAKE_FIELDS.recordType in f;

  if (!looksLikePIM) return null;

  const fullAddress =
    f['Full Address'] ||
    [f['Street Number'], f['Street Name'], f['Street Type']].filter(Boolean).join(' ');

  return (
    <div className="space-y-4">
      {/* Classification */}
      <SectionCard icon={Tag} title="Classification">
        <div className="flex flex-wrap gap-2">
          {f['Sector'] && <Badge variant="outline">Sector: {f['Sector']}</Badge>}
          {f['Intent'] && <Badge variant="outline">Intent: {f['Intent']}</Badge>}
          {f['Category'] && <Badge variant="secondary">{f['Category']}</Badge>}
          {f['Record Type'] && <Badge variant="outline">{f['Record Type']}</Badge>}
          {f['Contract Type'] && f['Contract Type'] !== 'Unknown' && (
            <Badge variant="outline">Contract: {f['Contract Type']}</Badge>
          )}
          {f['Sale Method'] && f['Sale Method'] !== 'Unknown' && (
            <Badge variant="outline">Sale: {f['Sale Method']}</Badge>
          )}
          {f['Package Type'] && f['Package Type'] !== 'Unknown' && (
            <Badge variant="outline">Package: {f['Package Type']}</Badge>
          )}
          {f['Rent Period'] && f['Rent Period'] !== 'Unknown' && (
            <Badge variant="outline">Rent Period: {f['Rent Period']}</Badge>
          )}
          {f['GST Applicable'] && f['GST Applicable'] !== 'Unknown' && (
            <Badge variant="outline">GST: {f['GST Applicable']}</Badge>
          )}
          {f['Open Home Available'] && <Badge variant="success">Open Home</Badge>}
        </div>
      </SectionCard>

      {/* Address breakdown */}
      {(fullAddress || f['Normalized Address'] || f['Country']) && (
        <SectionCard icon={Globe} title="Address Breakdown">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Row label="Full Address" value={fullAddress} />
            <Row label="Normalized" value={f['Normalized Address']} />
            <Row label="Street Number" value={f['Street Number']} />
            <Row label="Street Name" value={f['Street Name']} />
            <Row label="Street Type" value={f['Street Type']} />
            <Row label="Country" value={f['Country']} />
          </div>
        </SectionCard>
      )}

      {/* Agent & Agency extended */}
      {(f['Agent Email'] || f['Agent Mobile'] || f['Agency Email'] || f['Agency Office Phone'] || f['Agent Role'] || f['Agent / Agency Notes']) && (
        <SectionCard icon={Building2} title="Agent & Agency (Extended)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Row label="Agent Role" value={f['Agent Role']} />
            <Row label="Agent Email" value={f['Agent Email']} icon={Mail} />
            <Row label="Agent Mobile" value={f['Agent Mobile']} icon={Smartphone} />
            <Row label="Agency Email" value={f['Agency Email']} icon={Mail} />
            <Row label="Agency Office Phone" value={f['Agency Office Phone']} icon={Phone} />
            <Row label="Sender Name" value={f['Sender Name']} />
            <Row label="Sender Email" value={f['Sender Email']} icon={Mail} />
            <Row label="Sender Domain" value={f['Sender Domain']} icon={Globe} />
          </div>
          {f['Agent / Agency Notes'] && (
            <p className="mt-3 text-sm text-muted-foreground italic border-l-2 border-primary/30 pl-3">{f['Agent / Agency Notes']}</p>
          )}
        </SectionCard>
      )}

      {/* Inspection raw */}
      {(f['Next Inspection Date'] || f['Inspection Raw Text']) && (
        <SectionCard title="Inspection (Extended)">
          <div className="space-y-1">
            <Row label="Next Inspection" value={f['Next Inspection Date'] ? new Date(f['Next Inspection Date']).toLocaleString('en-AU') : null} />
            <Row label="Raw Text" value={f['Inspection Raw Text']} />
          </div>
        </SectionCard>
      )}

      {/* Processing status */}
      <SectionCard icon={Activity} title="Processing">
        <div className="flex flex-wrap gap-2 mb-3">
          {f['Processing Stage'] && <Badge variant="outline">Stage: {f['Processing Stage']}</Badge>}
          {f['Processing Status'] && <Badge variant="outline">Status: {f['Processing Status']}</Badge>}
          {f['Record Status'] && (
            <Badge variant={f['Record Status'] === 'Needs Review' ? 'destructive' : 'secondary'}>
              {f['Record Status']}
            </Badge>
          )}
          {f['Enrichment Status'] && <Badge variant="outline">Enrichment: {f['Enrichment Status']}</Badge>}
          {f['Listing Status'] && <Badge variant="outline">Listing: {f['Listing Status']}</Badge>}
          {f['Web Scrape Status'] && <Badge variant="outline">Scrape: {f['Web Scrape Status']}</Badge>}
          {f['Source Type'] && <Badge variant="secondary">Source: {f['Source Type']}</Badge>}
        </div>
        {f['Last Modified Time'] && (
          <p className="text-xs text-muted-foreground">
            Last modified · {new Date(f['Last Modified Time']).toLocaleString('en-AU')}
          </p>
        )}
      </SectionCard>

      {/* Confidence scores */}
      {(f['Overall Data Quality Score'] || f['Extraction Confidence'] || f['Address Confidence'] || f['Price Confidence'] || f['Specs Confidence'] || f['Agent Details Confidence']) && (
        <SectionCard icon={Sparkles} title="Confidence Scores">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <ConfBar label="Overall Data Quality" value={f['Overall Data Quality Score']} />
            <ConfBar label="Extraction" value={f['Extraction Confidence']} />
            <ConfBar label="Address" value={f['Address Confidence']} />
            <ConfBar label="Price" value={f['Price Confidence']} />
            <ConfBar label="Specs" value={f['Specs Confidence']} />
            <ConfBar label="Agent Details" value={f['Agent Details Confidence']} />
          </div>
        </SectionCard>
      )}

      {/* Human review */}
      {(f['Needs Human Review'] || f['Human Review Status'] || f['Human Review Notes'] || f['Follow-up Notes']) && (
        <SectionCard icon={ClipboardCheck} title="Human Review" tone={f['Needs Human Review'] ? 'warning' : 'default'}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {f['Needs Human Review'] && <Badge variant="destructive">Needs Human Review</Badge>}
              {f['Human Review Status'] && <Badge variant="outline">{f['Human Review Status']}</Badge>}
            </div>
            {f['Human Review Notes'] && (
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Reviewer notes</span>
                <p className="text-sm mt-1">{f['Human Review Notes']}</p>
              </div>
            )}
            {f['Follow-up Notes'] && (
              <div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Follow-up</span>
                <p className="text-sm mt-1">{f['Follow-up Notes']}</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* Errors */}
      {(f['Error Type'] || f['Error Message'] || f['Last Error Module']) && (
        <SectionCard icon={AlertTriangle} title="Extraction Issues" tone="destructive">
          <div className="space-y-1">
            <Row label="Type" value={f['Error Type']} />
            <Row label="Module" value={f['Last Error Module']} />
            <Row label="Message" value={f['Error Message']} />
          </div>
        </SectionCard>
      )}

      {/* Source content */}
      {(f['Raw Source Snippet'] || f['Original Row Text'] || f['Property Description'] || f['Source Web Link']) && (
        <SectionCard icon={FileText} title="Source Content">
          {f['Property Description'] && (
            <div className="mb-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Property Description</span>
              <p className="text-sm mt-1 leading-relaxed">{f['Property Description']}</p>
            </div>
          )}
          {f['Raw Source Snippet'] && (
            <div className="mb-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Raw Source Snippet</span>
              <pre className="text-xs mt-1 p-3 rounded-lg bg-muted/60 border border-border/60 whitespace-pre-wrap break-words max-h-48 overflow-auto">{f['Raw Source Snippet']}</pre>
            </div>
          )}
          {f['Original Row Text'] && (
            <div className="mb-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Original Row</span>
              <pre className="text-xs mt-1 p-3 rounded-lg bg-muted/60 border border-border/60 whitespace-pre-wrap break-words font-mono max-h-32 overflow-auto">{f['Original Row Text']}</pre>
            </div>
          )}
          {safeSourceWebUrl ? (
            <a
              href={safeSourceWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline break-all"
            >
              <Globe className="h-3.5 w-3.5" /> {sourceWebLink}
            </a>
          ) : sourceWebLink ? (
            <p className="text-sm break-all">{String(sourceWebLink)}</p>
          ) : null}
        </SectionCard>
      )}

      {/* Identifiers */}
      {(f['Property Unique Key'] || f['Property Record Name'] || f['Address Match Key'] || f['Project Match Key']) && (
        <SectionCard icon={Hash} title="Identifiers">
          <div className="space-y-1">
            <Row label="Record Name" value={f['Property Record Name']} />
            <Row label="Unique Key" value={f['Property Unique Key']} mono />
            <Row label="Address Match" value={f['Address Match Key']} mono />
            <Row label="Project Match" value={f['Project Match Key']} mono />
          </div>
        </SectionCard>
      )}
    </div>
  );
}
