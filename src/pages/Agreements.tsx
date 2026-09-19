import { useState } from "react";
import {
  useAgencyAgreements,
  useAgreementMutations,
  AgencyAgreement,
} from "@/hooks/useAgencyAgreements";
import { CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlattenPdfMenuItem } from "@/components/common/FlattenPdfMenuItem";
import { fetchPdfBlob } from "@/lib/pdf/downloadPdf";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from '@/components/ui/search-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileSignature,
  Search,
  RefreshCw,
  MoreHorizontal,
  Eye,
  XCircle,
  Download,
  Loader2,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban,
  FileText,
  Mail,
  CalendarDays,
  FileCheck2,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useModulePermissions } from "@/hooks/useModulePermissions";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import GammaTemplateManager from "@/components/agreements/GammaTemplateManager";
import {
  PrepareForSigningModal,
  type SigningRecipient,
} from "@/components/agreements/PrepareForSigningModal";
import {
  EnvelopeStatusDialog,
  DocuSignStatusBadge,
  docuSignStatusLabel,
} from "@/components/agreements/EnvelopeStatusDialog";
import { envelopeBadgeIsRedundant } from "@/lib/agreements/statusBadges.pure";
import { supabase } from "@/integrations/supabase/client";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant:
      | "default"
      | "secondary"
      | "destructive"
      | "outline"
      | "success"
      | "warning";
    icon: React.ComponentType<any>;
    toneClassName: string;
  }
> = {
  pending_pdf: {
    label: "Processing PDF",
    variant: "warning",
    icon: Clock,
    toneClassName:
      "border-brand-400/60 bg-brand-100/85 text-brand-900 shadow-brand-900/5 dark:border-brand-200/30 dark:bg-brand-300/12 dark:text-brand-100",
  },
  generating: {
    label: "Generating",
    variant: "warning",
    icon: Loader2,
    toneClassName:
      "border-brand-400/60 bg-brand-100/85 text-brand-900 shadow-brand-900/5 dark:border-brand-200/30 dark:bg-brand-300/12 dark:text-brand-100",
  },
  generated: {
    label: "Generated · Ready",
    variant: "outline",
    icon: FileCheck2,
    // dark:text-info, never dark:text-info-foreground: --info-foreground is
    // near-black in dark mode (it is the ink for a SOLID bg-info), so on this
    // 10% tint it rendered as an unreadable dark-on-dark capsule.
    toneClassName:
      "border-info/70 bg-info/10 text-info shadow-info/5 dark:border-info/40 dark:bg-info/15 dark:text-info",
  },
  draft: {
    label: "Draft",
    variant: "outline",
    icon: FileText,
    toneClassName:
      "border-border bg-muted text-foreground shadow-foreground/5 dark:border-border/70 dark:bg-background/70 dark:text-foreground",
  },
  sent: {
    label: "Sent",
    variant: "outline",
    icon: Send,
    toneClassName:
      "border-brand-300/55 bg-brand-50/80 text-brand-800 shadow-brand-900/5 dark:border-brand-200/25 dark:bg-brand-300/10 dark:text-brand-100",
  },
  delivered: {
    label: "Delivered",
    variant: "outline",
    icon: CheckCircle2,
    toneClassName:
      "border-brand-400/65 bg-brand-100/90 text-brand-950 shadow-brand-900/5 dark:border-brand-200/35 dark:bg-brand-300/14 dark:text-brand-100",
  },
  viewed: {
    label: "Viewed",
    variant: "outline",
    icon: Eye,
    toneClassName:
      "border-brand-400/65 bg-brand-100/90 text-brand-950 shadow-brand-900/5 dark:border-brand-200/35 dark:bg-brand-300/14 dark:text-brand-100",
  },
  signed: {
    label: "Signed",
    variant: "success",
    icon: CheckCircle2,
    toneClassName:
      "border-success/60 bg-success/10 text-success shadow-success/5 dark:border-success/35 dark:bg-success/12 dark:text-success",
  },
  completed: {
    label: "Completed",
    variant: "success",
    icon: CheckCircle2,
    toneClassName:
      "border-success/60 bg-success/10 text-success shadow-success/5 dark:border-success/35 dark:bg-success/12 dark:text-success",
  },
  declined: {
    label: "Declined",
    variant: "destructive",
    icon: AlertTriangle,
    toneClassName:
      "border-destructive/70 bg-destructive/10 text-destructive shadow-destructive/5 dark:border-destructive/35 dark:bg-destructive/12 dark:text-destructive",
  },
  voided: {
    label: "Voided",
    variant: "destructive",
    icon: Ban,
    toneClassName:
      "border-destructive/70 bg-destructive/10 text-destructive shadow-destructive/5 dark:border-destructive/35 dark:bg-destructive/12 dark:text-destructive",
  },
  expired: {
    label: "Expired",
    variant: "secondary",
    icon: Clock,
    toneClassName:
      "border-destructive/70 bg-destructive/10 text-destructive shadow-destructive/5 dark:border-destructive/35 dark:bg-destructive/12 dark:text-destructive",
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: AlertTriangle,
    toneClassName:
      "border-destructive/70 bg-destructive/10 text-destructive shadow-destructive/5 dark:border-destructive/35 dark:bg-destructive/12 dark:text-destructive",
  },
};

export default function Agreements() {
  const { data: agreements = [], isLoading, isError, error, refetch } = useAgencyAgreements();
  const { checkStatus, voidAgreement, sendViaDocuSign, retryPdf } =
    useAgreementMutations();
  const [searchTerm, setSearchTerm] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [signingAgreement, setSigningAgreement] =
    useState<AgencyAgreement | null>(null);
  const [signingPdfUrl, setSigningPdfUrl] = useState<string>("");
  const [statusAgreement, setStatusAgreement] =
    useState<AgencyAgreement | null>(null);
  const searchInputId = "agreements-search-input";
  const navigate = useNavigate();
  const { canEdit: canEditAgreements } = useModulePermissions("agreements");

  /**
   * `ok` separates "the call failed" from "it answered, and there is no PDF
   * yet". Without it a caller cannot tell them apart, and the one that reports
   * a missing document would stack a second message on top of the failure this
   * function has already reported.
   */
  const fetchAgreementPreview = async (
    agreementId: string,
  ): Promise<{ ok: boolean; html: string | null; pdf_url: string | null }> => {
    const { data, error } = await invokeSecureFunction<{
      html: string;
      pdf_url?: string;
      gamma_url?: string;
    }>("manage-agency-agreements", {
      action: "preview",
      agreement_id: agreementId,
    });
    if (error || !data) {
      toast.error(
        "Failed to load agreement: " + (error?.message || "Unknown error"),
      );
      return { ok: false, html: null, pdf_url: null };
    }
    return { ok: true, html: data.html || null, pdf_url: data.pdf_url || null };
  };

  /**
   * The one way to reach an agreement's PDF, generating it on demand.
   *
   * Two separate defects put it here, and each of them made the same row offer
   * two acts that disagreed about whether the document exists.
   *
   * Prepare for Signing used to call `supabase.storage.createSignedUrl` from
   * the BROWSER, and this app's identity is a custom HttpOnly cookie, so that
   * client is anon. `agency-agreements` is a private bucket and is not in
   * `secure-storage`'s allow-list either, so the request was refused — and
   * Supabase Storage answers a refusal with the same message as a genuine
   * absence, by design, to avoid confirming that an object exists. The
   * operator therefore saw "Failed to load PDF: Object not found" on a row the
   * page had just labelled GENERATED · READY, while View Agreement on that
   * same row worked, because View goes through `manage-agency-agreements` and
   * the signed URL is minted server-side with the service role.
   *
   * The second is the deferred generation: Gamma is asynchronous, so a row can
   * be GENERATED · READY before a document exists, and `retry_pdf` exists for
   * exactly that. Download called it and Prepare for Signing did not, so the
   * 19 Sep 2026 clone audit reported "PDF not ready yet" on a row where
   * Download and View both worked.
   *
   * The preview it fetched travels back with the answer, so a caller that
   * needs the HTML as well pays for one round trip rather than two.
   */
  const resolveAgreementPdf = async (
    agreement: AgencyAgreement,
  ): Promise<{ ok: boolean; html: string | null; pdfUrl: string | null }> => {
    const { ok, html, pdf_url } = await fetchAgreementPreview(agreement.id);
    // A genuine failure has already been reported; say nothing further.
    if (!ok) return { ok: false, html: null, pdfUrl: null };
    if (pdf_url) return { ok: true, html, pdfUrl: pdf_url };
    // A stored object the preview did not sign is still a document; the
    // download path knows how to reach it and must not be sent round `retry`.
    if (agreement.pdf_storage_path) return { ok: true, html, pdfUrl: null };
    try {
      const retried = await retryPdf.mutateAsync(agreement.id);
      return { ok: true, html, pdfUrl: retried?.pdf_url || null };
    } catch {
      return { ok: true, html, pdfUrl: null };
    }
  };

  const openPrepareForSigning = async (a: AgencyAgreement) => {
    const { ok, pdfUrl: pdf_url } = await resolveAgreementPdf(a);
    if (!ok) return;
    if (!pdf_url) {
      toast.error("PDF not ready yet", {
        description:
          "The agreement document could not be produced. Try again in a moment.",
      });
      return;
    }
    const existingRecipients: SigningRecipient[] =
      Array.isArray((a as any).signing_recipients) &&
      (a as any).signing_recipients.length
        ? (a as any).signing_recipients
        : [
            {
              id: "buyer",
              name: a.buyer_names,
              email: a.buyer_email || "",
              roleLabel: "Primary Buyer",
              routingOrder: 1,
            },
            ...(a.secondary_buyer_name
              ? [
                  {
                    id: "buyer2",
                    name: a.secondary_buyer_name,
                    email:
                      (a as any).secondary_buyer_email || a.buyer_email || "",
                    roleLabel: "Secondary Buyer",
                    routingOrder: 1,
                  },
                ]
              : []),
          ];
    setSigningPdfUrl(pdf_url);
    setSigningAgreement({
      ...a,
      signing_recipients: existingRecipients,
    } as any);
  };

  const filteredAgreements = agreements.filter(
    (a) =>
      a.buyer_names.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.buyer_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.status.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const totalSent = agreements.filter((a) =>
    ["sent", "delivered", "viewed", "signed"].includes(a.status),
  ).length;
  const totalSigned = agreements.filter((a) => a.status === "signed").length;
  const pending = agreements.filter((a) =>
    ["sent", "delivered", "viewed"].includes(a.status),
  ).length;

  const handleViewAgreement = async (agreement: AgencyAgreement) => {
    setIsPreviewLoading(true);
    setPreviewTitle(`Agreement — ${agreement.buyer_names}`);
    setPreviewHtml(null);
    const { html, pdf_url } = await fetchAgreementPreview(agreement.id);
    if (pdf_url) {
      // Show PDF in iframe
      setPreviewHtml(`__PDF__${pdf_url}`);
    } else if (html) {
      setPreviewHtml(html);
    } else {
      setPreviewTitle("");
    }
    setIsPreviewLoading(false);
  };

  const handleDownloadAgreement = async (agreement: AgencyAgreement) => {
    toast.loading("Preparing download...", { id: "download-agreement" });
    // The same resolution Prepare for Signing uses, so the two acts on one
    // row can never disagree about whether the document exists.
    const { html, pdfUrl: pdf_url } = await resolveAgreementPdf(agreement);

    if (pdf_url) {
      try {
        const res = await fetch(pdf_url);
        if (!res.ok) throw new Error("Failed to fetch PDF");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Agreement_${agreement.buyer_names.replace(/\s+/g, "_")}_${format(new Date(agreement.agreement_date), "yyyy-MM-dd")}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success("PDF downloaded", { id: "download-agreement" });
      } catch {
        toast.error("Failed to download PDF", { id: "download-agreement" });
      }
      return;
    }

    if (!html) {
      toast.error(
        "Agreement PDF is still being generated. Please try again in a minute.",
        { id: "download-agreement" },
      );
      return;
    }
    // Fallback: Download as HTML file
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Agreement_${agreement.buyer_names.replace(/\s+/g, "_")}_${format(new Date(agreement.agreement_date), "yyyy-MM-dd")}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Agreement downloaded (HTML fallback)", {
      id: "download-agreement",
    });
  };

  const handleRefreshStatus = async (id: string) => {
    try {
      await checkStatus.mutateAsync(id);
      toast.success("Status refreshed");
    } catch {
      // handled by mutation
    }
  };

  const handleVoid = async (id: string) => {
    const reason = prompt("Reason for voiding this agreement:");
    if (!reason) return;
    await voidAgreement.mutateAsync({ agreementId: id, reason });
  };

  const handleViewClient = (clientId: string) => {
    navigate(`/clients?clientId=${clientId}`);
  };

  const handleSendViaDocuSign = async (agreement: AgencyAgreement) => {
    if (!confirm(`Send agreement for ${agreement.buyer_names} via DocuSign?`))
      return;
    try {
      await sendViaDocuSign.mutateAsync(agreement.id);
    } catch {
      // handled by mutation
    }
  };

  const renderStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.generated;
    const Icon = config.icon;
    return (
      <Badge
        variant={config.variant}
        className={cn(
          "max-w-full justify-start gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-bold uppercase leading-4 tracking-[0.075em] shadow-sm backdrop-blur ring-1 ring-border dark:ring-white/45 transition-all duration-200 group-hover:shadow-[0_8px_20px_hsl(43_84%_52%/0.12)] group-hover:ring-brand-300/25 dark:ring-white/10 dark:group-hover:ring-brand-200/15",
          config.toneClassName,
        )}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{config.label}</span>
      </Badge>
    );
  };


  const renderDocuSignTimelineDate = (
    label: string,
    date: string | null | undefined,
    emptyLabel: string,
    Icon: React.ComponentType<any>,
  ) => (
    <div className="flex min-w-[8.75rem] items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-2.5 py-2 shadow-[0_8px_22px_rgba(15,23,42,0.06),inset_0_1px_0_hsl(0_0%_100%/0.62)] dark:border-white/10 dark:bg-background/35 dark:shadow-sm">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.62rem] font-bold uppercase leading-3 tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "block whitespace-nowrap text-sm font-semibold leading-5",
            date ? "text-foreground" : "text-muted-foreground/70",
          )}
        >
          {date ? format(new Date(date), "dd MMM yyyy") : emptyLabel}
        </span>
      </span>
    </div>
  );

  const getDocuSignTrackingTone = (status?: string | null) => {
    const key = status?.toLowerCase();
    if (["completed", "signed"].includes(key || "")) {
      return "border-success/60 bg-success/[0.08] shadow-success/5 dark:border-success/30 dark:bg-success/[0.10]";
    }
    if (["sent", "delivered", "viewed"].includes(key || "")) {
      return "border-brand-300/70 bg-brand-500/[0.10] shadow-brand-900/5 ring-1 ring-brand-300/20 dark:border-brand-200/35 dark:bg-brand-300/[0.10] dark:ring-brand-200/10";
    }
    if (["declined", "voided", "expired", "failed"].includes(key || "")) {
      return "border-destructive/55 bg-destructive/[0.07] shadow-destructive/5 dark:border-destructive/30 dark:bg-destructive/[0.08]";
    }
    return "border-border/70 bg-card/90 shadow-foreground/5 ring-1 ring-border dark:ring-white/60 dark:bg-background/30 dark:ring-white/5";
  };

  const renderDocuSignTracking = (agreement: AgencyAgreement) => {
    const hasEnvelope = Boolean(agreement.docusign_envelope_id);

    if (!hasEnvelope || !agreement.docusign_status) {
      return (
        <div className="flex max-w-[18rem] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {renderStatusBadge(agreement.status)}
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border/80 bg-card/80 px-2.5 py-1 text-[0.68rem] font-bold uppercase tracking-[0.075em] text-muted-foreground shadow-sm dark:bg-background/35">
            <Mail className="h-3 w-3" />
            Not sent
          </span>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "max-w-[20rem] rounded-2xl border p-2.5 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:shadow-md",
          getDocuSignTrackingTone(agreement.docusign_status),
        )}
      >
        {/* The envelope badge is drawn only when it says something the
            agreement's own badge does not. The two share a vocabulary and
            agree with each other almost always once an agreement is sent, so
            the row used to read [✈ SENT] [✉ SENT] — which reads as a
            rendering fault rather than as two sources.

            The raised FileSignature mark that sat on the right has gone with
            it. It had the full affordance of a button — accent ink, a ring, a
            shadow — and did nothing at all, which is how it came to be
            reported as "some kind of blue file with pencil icon that I'm not
            sure what the function of it is". A decoration that reads as a
            control is worse than no decoration. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {renderStatusBadge(agreement.status)}
          {!envelopeBadgeIsRedundant(
            STATUS_CONFIG[agreement.status]?.label ?? agreement.status,
            docuSignStatusLabel(agreement.docusign_status),
          ) && <DocuSignStatusBadge status={agreement.docusign_status} />}
        </div>
      </div>
    );
  };

  const renderAgreementDate = (date: string) => (
    <span className="inline-flex min-w-[7.25rem] items-center justify-center rounded-xl border border-border/70 bg-card/95 px-2.5 py-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.06),inset_0_1px_0_hsl(0_0%_100%/0.65)] text-sm font-semibold text-foreground shadow-sm dark:bg-background/35">
      {format(new Date(date), "dd MMM yyyy")}
    </span>
  );

  const renderAgreementsLoading = () => (
    <div className="overflow-hidden rounded-[1.35rem] border border-border/70 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_36%),linear-gradient(180deg,hsl(var(--card)/0.96),hsl(var(--background)/0.82))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_18px_44px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.14),transparent_40%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.56))]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-300/35 bg-brand-500/10 text-brand-700 shadow-sm dark:border-brand-200/25 dark:text-brand-100">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
          <div>
            <p className="text-sm font-bold text-foreground">Loading agreements</p>
            <p className="text-xs text-muted-foreground">Preparing the DocuSign ledger and latest agreement statuses.</p>
          </div>
        </div>
        <span className="hidden rounded-full border border-brand-300/35 bg-brand-500/10 px-3 py-1 text-[0.68rem] font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-100 sm:inline-flex">Syncing</span>
      </div>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid gap-3 rounded-2xl border border-border/55 bg-card/70 p-4 dark:border-white/10 dark:bg-background/35 sm:grid-cols-[1.4fr_1fr_1.2fr_0.8fr]">
            <div className="space-y-2"><div className="h-4 w-3/4 animate-pulse rounded-full bg-muted" /><div className="h-3 w-1/2 animate-pulse rounded-full bg-muted/70" /></div>
            <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
            <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
            <div className="h-8 animate-pulse rounded-xl bg-muted/80" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderAgreementsError = () => (
    <div className="mx-4 my-5 overflow-hidden rounded-[1.35rem] border border-destructive/35 bg-[radial-gradient(circle_at_top,hsl(var(--destructive)/0.08),transparent_38%),linear-gradient(180deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88))] px-5 py-10 text-center shadow-sm dark:border-destructive/25 dark:bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.10),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.56))]">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/40 bg-destructive/10 text-destructive dark:border-destructive/25 dark:text-destructive">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="mx-auto max-w-md text-base font-semibold text-foreground">Unable to load agreements.</p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{error instanceof Error ? error.message : "Please try again. The agreement workflow has not been changed."}</p>
      <Button variant="outline" className="mt-5 rounded-xl border-destructive/35 bg-background/80 text-foreground hover:bg-destructive/10" onClick={() => refetch()}>
        <RefreshCw className="mr-2 h-4 w-4" /> Retry loading agreements
      </Button>
    </div>
  );

  return (
    <DashboardThemeFrame
      variant="page"
      className="flex flex-col space-y-7 px-3 py-4 text-foreground sm:px-6 sm:py-7 lg:px-8"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="isolate flex flex-col gap-5 overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.18),transparent_34%),radial-gradient(circle_at_14%_12%,hsl(43_84%_52%/0.18),transparent_28%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.9)_52%,hsl(var(--muted)/0.45))] py-7 shadow-[0_24px_70px_rgba(15,23,42,0.11)] shadow-primary/5 before:absolute before:inset-x-8 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-300/70 before:to-transparent dark:bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.20),transparent_36%),radial-gradient(circle_at_14%_12%,hsl(43_84%_52%/0.14),transparent_30%),linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.76)_52%,hsl(var(--muted)/0.18))] sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-4 min-[420px]:flex-row min-[420px]:items-center">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.35rem] border border-brand-300/40 bg-[linear-gradient(135deg,hsl(43_84%_52%/0.20),hsl(var(--primary)/0.14))] text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_16px_36px_hsl(43_74%_28%/0.16)] dark:border-brand-200/25 dark:bg-[linear-gradient(135deg,hsl(43_84%_52%/0.16),hsl(var(--primary)/0.16))]">
            <span className="absolute inset-2 rounded-2xl border border-border dark:border-white/30 dark:border-white/10" />
            <FileSignature className="relative h-7 w-7 drop-shadow-sm" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand-700 dark:text-brand-200">
              DocuSign workflow
            </p>
            <h1 className="text-3xl font-black tracking-[-0.06em] text-foreground sm:text-5xl">
              Agency Agreements
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Manage, prepare, send, and audit buyer agency agreements through a DocuSign-ready workflow.
            </p>
          </div>
        </div>
        <div className="w-fit max-w-full rounded-full border border-brand-300/40 bg-brand-500/10 px-4 py-2 text-xs font-semibold text-brand-800 shadow-sm shadow-brand-950/5 dark:border-brand-200/25 dark:bg-brand-300/10 dark:text-brand-100">
          {pending} awaiting signature
        </div>
      </DashboardThemeFrame>

      <section
        className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 xl:grid-cols-4"
        aria-label="Agreement KPI summary"
      >
        {[
          {
            label: "Total Agreements",
            helper: "All generated records",
            value: agreements.length,
            Icon: FileText,
            className:
              "border-primary/25 bg-[radial-gradient(circle_at_18%_0%,hsl(var(--primary)/0.18),transparent_38%),linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--background)/0.82))] dark:border-primary/30 dark:bg-[radial-gradient(circle_at_18%_0%,hsl(var(--primary)/0.20),transparent_40%),linear-gradient(145deg,hsl(var(--card)/0.82),hsl(var(--background)/0.56))]",
            iconClassName:
              "border-primary/30 bg-primary/12 text-primary shadow-primary/20",
            valueClassName: "text-primary",
            railClassName: "from-primary/75 via-brand-300/70 to-primary/15",
          },
          {
            label: "Sent",
            helper: "Delivered or in-signing",
            value: totalSent,
            Icon: Send,
            className:
              "border-brand-400/25 bg-[radial-gradient(circle_at_18%_0%,hsl(38_92%_52%/0.16),transparent_38%),linear-gradient(145deg,hsl(var(--card)/0.97),hsl(var(--background)/0.80))] dark:border-brand-300/25 dark:bg-[radial-gradient(circle_at_18%_0%,hsl(38_92%_52%/0.18),transparent_40%),linear-gradient(145deg,hsl(var(--card)/0.80),hsl(var(--background)/0.54))]",
            iconClassName:
              "border-brand-400/35 bg-brand-500/12 text-brand-700 shadow-brand-500/20 dark:text-brand-200",
            valueClassName: "text-brand-700 dark:text-brand-200",
            railClassName:
              "from-brand-500/80 via-brand-300/70 to-brand-500/10",
          },
          {
            label: "Awaiting Signature",
            helper: "Sent, delivered, or viewed",
            value: pending,
            Icon: Clock,
            className:
              "border-warning/25 bg-[radial-gradient(circle_at_18%_0%,hsl(var(--warning)/0.16),transparent_38%),linear-gradient(145deg,hsl(var(--card)/0.97),hsl(var(--background)/0.80))] dark:border-warning/25 dark:bg-[radial-gradient(circle_at_18%_0%,hsl(var(--warning)/0.18),transparent_40%),linear-gradient(145deg,hsl(var(--card)/0.80),hsl(var(--background)/0.54))]",
            iconClassName:
              "border-warning/35 bg-warning/12 text-[hsl(var(--warning))] shadow-warning/20",
            valueClassName: "text-[hsl(var(--warning))]",
            railClassName:
              "from-warning/80 via-brand-300/70 to-warning/10",
          },
          {
            label: "Signed",
            helper: totalSigned === 0 ? "None completed yet" : "Completed envelopes",
            value: totalSigned,
            Icon: CheckCircle2,
            className:
              "border-success/25 bg-[radial-gradient(circle_at_18%_0%,hsl(158_70%_42%/0.15),transparent_38%),linear-gradient(145deg,hsl(var(--card)/0.97),hsl(var(--background)/0.80))] dark:border-success/25 dark:bg-[radial-gradient(circle_at_18%_0%,hsl(158_70%_42%/0.17),transparent_40%),linear-gradient(145deg,hsl(var(--card)/0.80),hsl(var(--background)/0.54))]",
            iconClassName:
              "border-success/35 bg-success/12 text-success shadow-success/20 dark:text-success",
            valueClassName: "text-success dark:text-success",
            railClassName:
              "from-success/80 via-success/70 to-success/10",
          },
        ].map((stat) => {
          const Icon = stat.Icon;

          return (
            <DashboardThemeFrame
              key={stat.label}
              variant="premiumCard"
              tabIndex={0}
              className={cn(
                "group relative min-h-[9.5rem] overflow-hidden p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 ring-border dark:ring-white/50 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-brand-300/60 hover:shadow-[0_24px_70px_rgba(15,23,42,0.13),0_0_0_1px_hsl(43_84%_52%/0.20),0_0_34px_hsl(43_84%_52%/0.18)] focus-visible:-translate-y-1 focus-visible:border-brand-400/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:shadow-[0_24px_70px_rgba(15,23,42,0.13),0_0_0_1px_hsl(43_84%_52%/0.24),0_0_34px_hsl(43_84%_52%/0.20)] dark:ring-white/10 dark:hover:border-brand-200/35 dark:hover:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_0_1px_hsl(43_84%_52%/0.16),0_0_38px_hsl(43_84%_52%/0.14)] dark:focus-visible:border-brand-200/50 dark:focus-visible:ring-brand-300/30 dark:focus-visible:shadow-[0_24px_70px_rgba(0,0,0,0.34),0_0_0_1px_hsl(43_84%_52%/0.18),0_0_38px_hsl(43_84%_52%/0.16)] sm:p-6",
                stat.className,
              )}
            >
              <span
                className={cn(
                  "absolute inset-x-6 top-0 h-px bg-gradient-to-r",
                  stat.railClassName,
                )}
              />
              <span className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand-300/0 blur-2xl transition-colors duration-300 group-hover:bg-brand-300/18 dark:group-hover:bg-brand-200/10" />
              <div className="relative flex h-full flex-col justify-between gap-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="max-w-[11rem] text-[0.72rem] font-semibold uppercase leading-5 tracking-[0.18em] text-muted-foreground/90">
                    {stat.label}
                  </p>
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-lg transition-transform duration-300 group-hover:scale-105",
                      stat.iconClassName,
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <p
                    className={cn(
                      "text-4xl font-black leading-none tracking-[-0.06em] tabular-nums sm:text-5xl",
                      stat.value === 0 && "opacity-90",
                      stat.valueClassName,
                    )}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-2 text-xs font-semibold leading-5 text-muted-foreground">{stat.helper}</p>
                </div>
              </div>
            </DashboardThemeFrame>
          );
        })}
      </section>

      <DashboardThemeFrame
        as="section"
        variant="section"
        className="flex min-h-0 flex-col overflow-visible border-border/80 bg-[linear-gradient(180deg,hsl(var(--card)/0.99),hsl(var(--background)/0.94))] p-0 shadow-[0_26px_80px_rgba(15,23,42,0.12)] ring-1 ring-border dark:ring-white/50 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.84),rgba(2,6,23,0.72))] dark:ring-white/10"
      >
        <div className="relative flex flex-col gap-5 border-b border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(180deg,hsl(var(--muted)/0.45),hsl(var(--card)/0.55))] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_0_5px_hsl(var(--primary)/0.13),0_0_22px_hsl(var(--primary)/0.32)]" />
              <CardTitle className="text-xl font-semibold tracking-[-0.03em] text-foreground sm:text-2xl">
                All Agreements
              </CardTitle>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              A searchable agreement ledger for reviewing buyers, delivery
              status, signature milestones, and safe agreement actions.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[0.68rem] font-bold uppercase tracking-[0.12em]">
              <span className="rounded-full border border-info/45 bg-info/10 px-2.5 py-1 text-info dark:border-info/25 dark:text-info">Generated = ready to prepare</span>
              <span className="rounded-full border border-brand-300/45 bg-brand-500/10 px-2.5 py-1 text-brand-700 dark:border-brand-200/25 dark:text-brand-100">Sent/Awaiting = with buyer</span>
              <span className="rounded-full border border-success/45 bg-success/10 px-2.5 py-1 text-success dark:border-success/25 dark:text-success">Signed = completed</span>
            </div>
          </div>
          <div className="group/search relative w-full sm:min-w-80 sm:max-w-md lg:w-96">
            <label htmlFor={searchInputId} className="sr-only">Search agreements by buyer name, email, or status</label>
            <div className="pointer-events-none absolute inset-y-1.5 left-1.5 z-10 flex w-10 items-center justify-center rounded-xl border border-transparent bg-primary/8 text-primary shadow-[inset_0_1px_0_hsl(0_0%_100%/0.32)] transition-all duration-300 group-hover/search:border-brand-300/35 group-hover/search:bg-brand-400/12 group-focus-within/search:border-brand-300/55 group-focus-within/search:bg-brand-400/18 group-focus-within/search:text-brand-700 dark:bg-brand-300/10 dark:text-brand-200 dark:group-hover/search:bg-brand-200/12 dark:group-focus-within/search:bg-brand-200/16 dark:group-focus-within/search:text-brand-100">
              <Search className="h-4 w-4" aria-hidden="true" />
            </div>
            <SearchInput
              value={searchTerm}
              onValueChange={setSearchTerm}
              id={searchInputId}
              aria-label="Search agreements by buyer name, email, or status"
              placeholder={`Search ${agreements.length} agreements by name, email, status...`}
              hideIcon
              className="h-[3.25rem] rounded-[1.15rem] border-border/70 bg-background/95 py-3 pl-14 pr-4 text-[0.95rem] font-medium text-foreground shadow-[0_16px_42px_rgba(15,23,42,0.10),inset_0_1px_0_hsl(0_0%_100%/0.45)] outline-none transition-all duration-300 placeholder:text-muted-foreground/80 hover:border-brand-300/50 hover:bg-background hover:shadow-[0_18px_48px_rgba(15,23,42,0.13),0_0_0_1px_hsl(43_84%_52%/0.12),inset_0_1px_0_hsl(0_0%_100%/0.55)] focus-visible:border-brand-400/70 focus-visible:ring-2 focus-visible:ring-brand-400/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-white/10 dark:bg-background/75 dark:shadow-[0_16px_42px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] dark:placeholder:text-muted-foreground dark:hover:border-brand-200/35 dark:hover:bg-background/90 dark:hover:shadow-[0_18px_48px_rgba(0,0,0,0.34),0_0_0_1px_hsl(43_84%_52%/0.12),inset_0_1px_0_rgba(255,255,255,0.10)] dark:focus-visible:border-brand-200/60 dark:focus-visible:ring-brand-300/25"
            />
          </div>
        </div>
        <div className="min-h-0 bg-muted/18 p-3 sm:p-4">
          {isLoading ? (
            renderAgreementsLoading()
          ) : isError ? (
            renderAgreementsError()
          ) : filteredAgreements.length === 0 ? (
            <div className="mx-4 my-5 overflow-hidden rounded-[1.35rem] border border-dashed border-brand-300/45 bg-[radial-gradient(circle_at_top,hsl(43_84%_52%/0.14),transparent_38%),linear-gradient(180deg,hsl(var(--card)/0.92),hsl(var(--muted)/0.24))] px-5 py-12 text-center text-sm text-muted-foreground shadow-[inset_0_1px_0_hsl(0_0%_100%/0.35),0_18px_48px_rgba(15,23,42,0.08)] dark:border-brand-200/25 dark:bg-[radial-gradient(circle_at_top,hsl(43_84%_52%/0.10),transparent_42%),linear-gradient(180deg,rgba(15,23,42,0.78),rgba(2,6,23,0.48))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-300/40 bg-brand-400/12 text-brand-700 shadow-[0_14px_34px_hsl(43_84%_32%/0.14)] dark:border-brand-200/25 dark:bg-brand-200/10 dark:text-brand-100">
                {searchTerm ? (
                  <Search className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <FileSignature className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <p className="mx-auto max-w-md text-base font-semibold text-foreground">
                {searchTerm
                  ? "No agreements match your search."
                  : 'No agreements sent yet. Open a client and click "Send Agreement" to get started.'}
              </p>
              {searchTerm && (
                <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
                  Check the buyer name, email, or status and try again.
                </p>
              )}
            </div>
          ) : (
            <ScrollArea role="region" aria-label="Agreements table with horizontal scrolling" className="min-h-[22rem] max-h-[min(58dvh,46rem)] rounded-2xl border border-border/80 bg-card/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_18px_44px_rgba(15,23,42,0.10)] [scrollbar-color:hsl(var(--primary)/0.38)_transparent] [scrollbar-width:thin] [&_[data-radix-scroll-area-viewport]]:overscroll-contain dark:border-white/10 dark:bg-background/45 dark:shadow-black/20">
              <div className="min-w-0 overflow-x-auto overflow-y-visible overscroll-x-contain [scrollbar-color:hsl(var(--primary)/0.38)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/35 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
                <Table aria-label="Agency agreements" className="min-w-[1040px]">
                  <TableHeader className="sticky top-0 z-10 border-b border-border/70 bg-muted/90 shadow-[0_1px_0_hsl(var(--border)/0.95),0_10px_28px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:bg-background/90">
                    <TableRow className="border-border/70 hover:bg-transparent">
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Buyer
                      </TableHead>
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Email
                      </TableHead>
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Status
                      </TableHead>
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Date
                      </TableHead>
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Sent
                      </TableHead>
                      <TableHead className="h-12 text-[0.69rem] font-bold uppercase tracking-[0.18em] text-muted-foreground/90">
                        Signed
                      </TableHead>
                      <TableHead className="h-12 w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="[&_tr:last-child]:border-0">
                    {filteredAgreements.map((agreement) => (
                      <TableRow
                        key={agreement.id}
                        className="group border-border/65 bg-card/45 transition-all duration-300 hover:bg-[linear-gradient(90deg,hsl(43_84%_52%/0.18),hsl(var(--primary)/0.08)_34%,hsl(var(--card)/0.86))] hover:shadow-[inset_4px_0_0_hsl(43_84%_52%/0.9),0_14px_34px_hsl(43_84%_52%/0.10)] dark:hover:bg-[linear-gradient(90deg,hsl(43_84%_52%/0.16),hsl(var(--primary)/0.08)_36%,hsl(var(--card)/0.18))]"
                      >
                        <TableCell className="max-w-[18rem] py-4 pr-5 font-medium">
                          <button
                            className="block max-w-full rounded-lg truncate text-left text-base font-bold leading-6 text-foreground transition-all hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/55 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:text-[1.02rem] dark:hover:text-brand-100"
                            title={agreement.buyer_names}
                            onClick={() =>
                              handleViewClient(agreement.client_id)
                            }
                          >
                            {agreement.buyer_names}
                          </button>
                          {agreement.secondary_buyer_name && (
                            <span
                              className="mt-1 block max-w-full truncate text-xs font-semibold text-muted-foreground"
                              title={agreement.secondary_buyer_name}
                            >
                              & {agreement.secondary_buyer_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[17rem] py-4 pr-5 text-sm font-medium text-muted-foreground">
                          {agreement.buyer_email ? (
                            <span
                              className="block max-w-[15.5rem] truncate rounded-lg px-0.5 py-1 transition-colors group-hover:text-foreground/75"
                              title={agreement.buyer_email}
                            >
                              {agreement.buyer_email}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-lg border border-dashed border-border/60 bg-muted/30 px-2 py-1 text-muted-foreground/60">
                              No email
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-4 pr-5 align-middle">
                          {renderDocuSignTracking(agreement)}
                        </TableCell>
                        <TableCell className="py-4 pr-5 text-sm font-medium text-muted-foreground">
                          {renderAgreementDate(agreement.agreement_date)}
                        </TableCell>
                        <TableCell className="py-4 pr-5 align-middle">
                          {renderDocuSignTimelineDate(
                            "Sent",
                            agreement.docusign_sent_at,
                            "Not sent",
                            CalendarDays,
                          )}
                        </TableCell>
                        <TableCell className="py-4 pr-5 align-middle">
                          {renderDocuSignTimelineDate(
                            "Signed",
                            agreement.docusign_signed_at,
                            "Not signed",
                            FileCheck2,
                          )}
                        </TableCell>
                        <TableCell className="py-4 pl-2 pr-4 text-right align-middle">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                aria-label={`Open actions for agreement with ${agreement.buyer_names}`}
                                className="ml-auto h-10 w-10 rounded-2xl border-border/80 bg-card/95 text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300/60 hover:bg-brand-500/12 hover:text-brand-700 hover:shadow-[0_10px_24px_hsl(43_84%_52%/0.18)] focus-visible:border-brand-400/70 focus-visible:ring-2 focus-visible:ring-brand-400/45 focus-visible:ring-offset-2 data-[state=open]:border-brand-400/60 data-[state=open]:bg-brand-500/14 data-[state=open]:text-brand-700 dark:bg-background/55 dark:hover:border-brand-200/35 dark:hover:bg-brand-200/12 dark:hover:text-brand-100 dark:data-[state=open]:text-brand-100"
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              side="bottom"
                              sideOffset={10}
                              collisionPadding={{ top: 16, right: 16, bottom: 24, left: 16 }}
                              aria-label={`Actions for ${agreement.buyer_names}`}
                              className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl border-border/80 bg-popover p-2 ring-1 ring-border dark:ring-white/70 text-popover-foreground shadow-2xl shadow-sm dark:shadow-black/15 backdrop-blur supports-[backdrop-filter]:bg-popover/90 dark:border-border/70 dark:shadow-black/35"
                            >
                              <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Agreement actions
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => handleViewAgreement(agreement)}
                                className="gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                              >
                                <FileText className="h-4 w-4 text-primary" />
                                View Agreement
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleDownloadAgreement(agreement)
                                }
                                className="gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                              >
                                <Download className="h-4 w-4 text-muted-foreground" />
                                Download Agreement
                              </DropdownMenuItem>
                              <FlattenPdfMenuItem
                                className="gap-3 rounded-xl px-3 py-2.5 focus:bg-accent focus:text-accent-foreground data-[disabled]:bg-muted/30 data-[disabled]:text-muted-foreground"
                                getPdfBlob={async () => {
                                  const { pdf_url } =
                                    await fetchAgreementPreview(agreement.id);
                                  if (!pdf_url)
                                    throw new Error(
                                      "Agreement PDF not yet generated",
                                    );
                                  return fetchPdfBlob(pdf_url);
                                }}
                                filename={`Agreement_${agreement.buyer_names.replace(/\s+/g, "_")}_${format(new Date(agreement.agreement_date), "yyyy-MM-dd")}.pdf`}
                              />
                              <DropdownMenuItem
                                onClick={() =>
                                  handleViewClient(agreement.client_id)
                                }
                                className="gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                              >
                                <Eye className="h-4 w-4 text-muted-foreground" />
                                View Client
                              </DropdownMenuItem>
                              {canEditAgreements &&
                                agreement.status === "generated" && (
                                  <>
                                    <DropdownMenuSeparator className="mx-1 my-2 bg-border/70" />
                                    <DropdownMenuItem
                                      onClick={() =>
                                        openPrepareForSigning(agreement)
                                      }
                                      className="gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                                    >
                                      <FileSignature className="h-4 w-4 text-primary" />
                                      Prepare for Signing
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleSendViaDocuSign(agreement)
                                      }
                                      disabled={sendViaDocuSign.isPending}
                                      className="gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 disabled:opacity-60 dark:hover:text-brand-100 dark:focus:text-brand-100"
                                    >
                                      {sendViaDocuSign.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                      ) : (
                                        <Send className="h-4 w-4 text-primary" />
                                      )}
                                      {sendViaDocuSign.isPending
                                        ? "Sending via DocuSign..."
                                        : "Send via DocuSign (legacy anchors)"}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              {agreement.docusign_envelope_id && (
                                <>
                                  <DropdownMenuSeparator className="mx-1 my-2 bg-border/70" />
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setStatusAgreement(agreement)
                                    }
                                    className="gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                                  >
                                    <Eye className="h-4 w-4 text-muted-foreground" />
                                    Envelope Status &amp; Audit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      handleRefreshStatus(agreement.id)
                                    }
                                    className="gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-brand-500/10 hover:text-brand-700 focus:bg-brand-500/12 focus:text-brand-700 dark:hover:text-brand-100 dark:focus:text-brand-100"
                                  >
                                    <RefreshCw className="h-4 w-4 text-muted-foreground" />
                                    Refresh Status
                                  </DropdownMenuItem>
                                </>
                              )}
                              {canEditAgreements &&
                                ["sent", "delivered", "viewed"].includes(
                                  agreement.status,
                                ) && (
                                  <>
                                    <DropdownMenuSeparator className="mx-1 my-2 bg-border/70" />
                                    <DropdownMenuItem
                                      className="gap-3 rounded-xl px-3 py-2.5 text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
                                      onClick={() => handleVoid(agreement.id)}
                                    >
                                      <XCircle className="h-4 w-4" />
                                      Void Agreement
                                    </DropdownMenuItem>
                                  </>
                                )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          )}
        </div>
      </DashboardThemeFrame>

      <GammaTemplateManager />

      {/* Agreement Preview Dialog */}
      <Dialog
        open={!!previewHtml || isPreviewLoading}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewHtml(null);
            setPreviewTitle("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined} className="flex max-h-[min(90dvh,900px)] w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden rounded-2xl border-border/80 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--background)/0.96))] text-card-foreground shadow-[0_28px_90px_rgba(15,23,42,0.28)] ring-1 ring-border dark:ring-white/70 dark:border-white/10 dark:bg-[linear-gradient(180deg,hsl(var(--card)/0.98),hsl(var(--background)/0.92))] dark:ring-white/10">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
          </DialogHeader>
          {isPreviewLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/30 py-20 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-300/35 bg-brand-500/10 text-brand-700 dark:text-brand-100">
                <Loader2 className="h-7 w-7 animate-spin" />
              </span>
              <p className="text-sm font-semibold text-foreground">Loading agreement preview</p>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">Fetching the latest PDF or HTML preview without changing the saved agreement.</p>
            </div>
          ) : previewHtml ? (
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-xl border border-border/70 bg-background [scrollbar-color:hsl(var(--primary)/0.38)_transparent] [scrollbar-width:thin]">
              {previewHtml.startsWith("__PDF__") ? (
                <iframe
                  src={previewHtml.replace("__PDF__", "")}
                  className="w-full min-h-[70vh] border-0"
                  title="Agreement Preview"
                />
              ) : (
                <iframe
                  srcDoc={previewHtml}
                  className="w-full min-h-[70vh] border-0"
                  title="Agreement Preview"
                  sandbox="allow-same-origin"
                />
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {signingAgreement && (
        <PrepareForSigningModal
          open={!!signingAgreement}
          onOpenChange={(v) => {
            if (!v) setSigningAgreement(null);
          }}
          scope="agreement"
          recordId={signingAgreement.id}
          title={signingAgreement.buyer_names}
          pdfUrl={signingPdfUrl}
          initialRecipients={(signingAgreement as any).signing_recipients || []}
          initialLayout={(signingAgreement as any).signing_layout || []}
          onSent={() => setSigningAgreement(null)}
        />
      )}

      {statusAgreement && (
        <EnvelopeStatusDialog
          open={!!statusAgreement}
          onOpenChange={(v) => {
            if (!v) setStatusAgreement(null);
          }}
          scope="agreement"
          recordId={statusAgreement.id}
          title={`${statusAgreement.buyer_names} — Envelope`}
          agreement={statusAgreement}
        />
      )}
    </DashboardThemeFrame>
  );
}
