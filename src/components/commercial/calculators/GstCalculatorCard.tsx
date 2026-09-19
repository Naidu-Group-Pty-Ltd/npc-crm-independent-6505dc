import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  calculateCommercialGst,
  calculateCommercialGstEngine,
  type GstTreatment,
} from "@/utils/commercial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCalculatorPrefill } from "@/contexts/CalculatorPrefillContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertTriangle,
  ArrowRightLeft,
  Calculator,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Landmark,
  Scale,
  ShieldCheck,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCommercialDealState } from "@/utils/commercial/commercialDealState";

const fmt = (n: number) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
      }).format(n)
    : "Pending";

const PENDING = "Pending";
type GstTreatmentInput =
  | GstTreatment
  | "unknown"
  | "out_of_scope"
  | "no_gst"
  | "custom_review";
type ConfirmationState = "yes" | "no" | "unknown";
type RefundTiming =
  | "atSettlement"
  | "oneToThreeMonths"
  | "threePlusMonths"
  | "unknown";
type GstFieldKey =
  | "price"
  | "treatment"
  | "registered"
  | "goingConcernConfirmed"
  | "itcClaimability"
  | "settlementTiming";
type SourceState =
  | "Blank"
  | "Property Profile"
  | "Scraped"
  | "Contract Extracted"
  | "AI Estimate"
  | "Manual"
  | "User Override"
  | "Solicitor Confirmed"
  | "Accountant Confirmed"
  | "Verified";
interface SourceCandidate<T> {
  value: T;
  source: SourceState;
  detail: string;
}
interface AssumptionHistoryEntry {
  field: GstFieldKey;
  previousValue: string;
  nextValue: string;
  previousSource: SourceState;
  nextSource: SourceState;
  note: string;
}
interface GstExtractionPreview {
  suggestedTreatment: GstTreatmentInput;
  purchaserRegistrationRequirement: ConfirmationState;
  goingConcernPresent: boolean;
  marginSchemePresent: boolean;
  taxableSupplyPresent: boolean;
  confidence: "Low" | "Medium" | "High";
  clauseSummary: string;
  missingInformation: string[];
  requiredConfirmations: string[];
  specialistReviewRequired: boolean;
  source: SourceState;
}
type GstWarningCategory =
  | "Purchase Price"
  | "GST Treatment"
  | "Purchaser Registration"
  | "Going Concern"
  | "ITC Claimability"
  | "Settlement Cashflow"
  | "Contract Review"
  | "Verification";
type GstWarningSeverity = "Critical" | "Required" | "Recommended";
interface GstWarning {
  category: GstWarningCategory;
  severity: GstWarningSeverity;
  message: string;
  detail: string;
  priority: number;
}

const parseNumeric = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};
const optionalNum = (v: string) => parseNumeric(v) ?? undefined;
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== "";
const firstNumber = (...xs: unknown[]) => {
  for (const x of xs) {
    const parsed = parseNumeric(x);
    if (parsed !== null) return parsed;
  }
  return undefined;
};
const firstString = (...xs: unknown[]) =>
  xs.find((x) => typeof x === "string" && x.trim() !== "") as
    | string
    | undefined;
const normalizeTreatment = (v: unknown): GstTreatmentInput | undefined => {
  const s = String(v ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["going_concern", "gst_free_going_concern"].includes(s))
    return "going_concern";
  if (["margin_scheme", "margin"].includes(s)) return "margin_scheme";
  if (
    ["plus_gst", "taxable_supply", "taxable"].includes(s)
  )
    return "plus_gst";
  if (["standard", "gst_inclusive"].includes(s)) return "standard";
  if (["input_taxed"].includes(s)) return "no_gst";
  if (["out_of_scope"].includes(s)) return "out_of_scope";
  if (["no_gst", "no_gst_applicable"].includes(s)) return "no_gst";
  if (["custom", "specialist_review", "custom_specialist_review"].includes(s))
    return "custom_review";
  return undefined;
};
const normalizeConfirmation = (v: unknown): ConfirmationState | undefined => {
  if (v === true) return "yes";
  if (v === false) return "no";
  const s = String(v ?? "").toLowerCase();
  if (["yes", "true", "confirmed", "registered", "verified"].includes(s))
    return "yes";
  if (["no", "false", "not_registered", "unconfirmed"].includes(s)) return "no";
  return undefined;
};
const detectText = (...xs: unknown[]) =>
  xs
    .filter((x) => typeof x === "string")
    .join(" ")
    .toLowerCase();
const inferTreatmentFromText = (
  text: string,
): GstTreatmentInput | undefined => {
  if (/going concern/.test(text)) return "going_concern";
  if (/margin scheme/.test(text)) return "margin_scheme";
  if (/gst inclusive/.test(text)) return "standard";
  if (/taxable supply|plus gst|\+\s*gst/.test(text)) return "plus_gst";
  if (/out of scope/.test(text)) return "out_of_scope";
  if (/no gst|input taxed/.test(text)) return "no_gst";
  return undefined;
};
const persistedTreatment = (v: GstTreatmentInput): GstTreatment | undefined => {
  if (v === "unknown" || v === "custom_review") return undefined;
  if (v === "out_of_scope" || v === "no_gst") return "input_taxed";
  return v;
};
const sourceLabel = (source: SourceState) =>
  ({
    Blank: "Blank",
    "Property Profile": "From Property",
    Scraped: "Scraped",
    "Contract Extracted": "From Contract",
    "AI Estimate": "AI Estimate",
    Manual: "Manual",
    "User Override": "Override",
    "Solicitor Confirmed": "Solicitor Confirmed",
    "Accountant Confirmed": "Accountant Confirmed",
    Verified: "Verified",
  })[source];

export function GstCalculatorCard() {
  const { prefill, property, pushBack } = useCalculatorPrefill();
  const updateGlobal = useCommercialDealState((s) => s.updateGlobal);
  const setSourceMode = useCommercialDealState((s) => s.setSourceMode);
  const rawProperty = (property ?? {}) as Record<string, unknown>;
  const [price, setPrice] = useState("");
  const [treatment, setTreatment] = useState<GstTreatmentInput>("unknown");
  const [priorCost, setPriorCost] = useState("");
  const [registered, setRegistered] = useState<ConfirmationState>("unknown");
  const [goingConcernConfirmed, setGoingConcernConfirmed] =
    useState<ConfirmationState>("unknown");
  const [itcClaimability, setItcClaimability] =
    useState<ConfirmationState>("unknown");
  const [settlementTiming, setSettlementTiming] =
    useState<RefundTiming>("unknown");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [extractionNotice, setExtractionNotice] = useState("");
  const [extractionPreview, setExtractionPreview] =
    useState<GstExtractionPreview | null>(null);
  const [previewSelections, setPreviewSelections] = useState<
    Record<GstFieldKey, boolean>
  >({
    price: false,
    treatment: true,
    registered: true,
    goingConcernConfirmed: true,
    itcClaimability: false,
    settlementTiming: false,
  });
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [sources, setSources] = useState<Record<GstFieldKey, SourceState>>({
    price: "Blank",
    treatment: "Blank",
    registered: "Blank",
    goingConcernConfirmed: "Blank",
    itcClaimability: "Blank",
    settlementTiming: "Blank",
  });
  const [history, setHistory] = useState<AssumptionHistoryEntry[]>([]);
  const [sourceConflicts, setSourceConflicts] = useState<
    Partial<Record<GstFieldKey, SourceCandidate<string>>>
  >({});

  const currentValues: Record<GstFieldKey, string> = {
    price,
    treatment,
    registered,
    goingConcernConfirmed,
    itcClaimability,
    settlementTiming,
  };
  const pushHistory = (
    field: GstFieldKey,
    previousValue: string,
    nextValue: string,
    previousSource: SourceState,
    nextSource: SourceState,
    note: string,
  ) => {
    if (previousValue === nextValue && previousSource === nextSource) return;
    setHistory((prev) =>
      [
        { field, previousValue, nextValue, previousSource, nextSource, note },
        ...prev,
      ].slice(0, 8),
    );
  };
  const applyCascadedValue = (
    field: GstFieldKey,
    candidate?: SourceCandidate<string>,
  ) => {
    if (!candidate || !hasValue(candidate.value)) return;
    const current = currentValues[field];
    const source = sources[field];
    if (source === "User Override") {
      if (String(candidate.value) !== current)
        setSourceConflicts((prev) => ({ ...prev, [field]: candidate }));
      return;
    }
    if (
      current === "" ||
      current === "unknown" ||
      source === "Blank" ||
      source !== candidate.source ||
      current !== String(candidate.value)
    ) {
      pushHistory(
        field,
        current || "Blank",
        String(candidate.value),
        source,
        candidate.source,
        candidate.detail,
      );
      if (field === "price") setPrice(String(candidate.value));
      if (field === "treatment")
        setTreatment(candidate.value as GstTreatmentInput);
      if (field === "registered")
        setRegistered(candidate.value as ConfirmationState);
      if (field === "goingConcernConfirmed")
        setGoingConcernConfirmed(candidate.value as ConfirmationState);
      if (field === "itcClaimability")
        setItcClaimability(candidate.value as ConfirmationState);
      if (field === "settlementTiming")
        setSettlementTiming(candidate.value as RefundTiming);
      setSources((prev) => ({ ...prev, [field]: candidate.source }));
      setSourceConflicts((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const useSourceValue = (
    field: GstFieldKey,
    candidate?: SourceCandidate<string>,
  ) => {
    if (!candidate) return;
    const current = currentValues[field];
    pushHistory(
      field,
      current || "Blank",
      String(candidate.value),
      sources[field],
      candidate.source,
      "User accepted newer cascaded source value.",
    );
    if (field === "price") setPrice(String(candidate.value));
    if (field === "treatment")
      setTreatment(candidate.value as GstTreatmentInput);
    if (field === "registered")
      setRegistered(candidate.value as ConfirmationState);
    if (field === "goingConcernConfirmed")
      setGoingConcernConfirmed(candidate.value as ConfirmationState);
    if (field === "itcClaimability")
      setItcClaimability(candidate.value as ConfirmationState);
    if (field === "settlementTiming")
      setSettlementTiming(candidate.value as RefundTiming);
    setSources((prev) => ({ ...prev, [field]: candidate.source }));
    setSourceConflicts((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const applyPreviewField = (
    field: GstFieldKey,
    value: string,
    source: SourceState,
  ) => {
    pushHistory(
      field,
      currentValues[field] || "Blank",
      value || "Blank",
      sources[field],
      source,
      "User accepted GST AI / extraction preview value.",
    );
    if (field === "price") setPrice(value);
    if (field === "treatment") setTreatment(value as GstTreatmentInput);
    if (field === "registered") setRegistered(value as ConfirmationState);
    if (field === "goingConcernConfirmed")
      setGoingConcernConfirmed(value as ConfirmationState);
    if (field === "itcClaimability")
      setItcClaimability(value as ConfirmationState);
    if (field === "settlementTiming")
      setSettlementTiming(value as RefundTiming);
    setSources((prev) => ({ ...prev, [field]: source }));
  };

  const markOverride = (
    field: GstFieldKey,
    nextValue: string,
    setter: (v: any) => void,
  ) => {
    const previousValue = currentValues[field] || "Blank";
    const previousSource = sources[field];
    setter(nextValue);
    setSources((prev) => ({ ...prev, [field]: "User Override" }));
    pushHistory(
      field,
      previousValue,
      nextValue || "Blank",
      previousSource,
      "User Override",
      "User edited cascaded GST value; original source preserved.",
    );
  };

  const sourceCandidates = useMemo(() => {
    const scrapedPrice = firstNumber(
      rawProperty.scraped_asking_price,
      rawProperty.asking_price,
      rawProperty.guide_price,
      rawProperty.price_guide,
      rawProperty.extractedAskingPrice,
    );
    const contractPrice = firstNumber(
      rawProperty.contract_price,
      rawProperty.extracted_contract_price,
      rawProperty.contractPurchasePrice,
      rawProperty.contract_purchase_price,
    );
    const borrowingPrice = firstNumber(
      rawProperty.borrowing_capacity_purchase_price,
      rawProperty.borrowingCapacityPurchasePrice,
    );
    const contractTreatment = normalizeTreatment(
      firstString(
        rawProperty.contract_gst_treatment,
        rawProperty.extracted_gst_treatment,
        rawProperty.extractedGstTreatment,
        rawProperty.gst_clause_treatment,
      ),
    );
    const profileTreatment = normalizeTreatment(prefill?.gstTreatment);
    const aiTreatment = normalizeTreatment(
      firstString(
        rawProperty.ai_gst_treatment,
        rawProperty.aiGstTreatment,
        rawProperty.estimated_gst_treatment,
      ),
    );
    const clientRegistered = normalizeConfirmation(
      rawProperty.client_gst_registered ??
        rawProperty.entity_gst_registered ??
        rawProperty.purchaser_entity_gst_registered,
    );
    const savedRegistered = normalizeConfirmation(
      rawProperty.purchaser_gst_registered ??
        rawProperty.gst_registered ??
        rawProperty.saved_purchaser_gst_registered,
    );
    const contractGoingConcern = normalizeConfirmation(
      rawProperty.contract_going_concern_confirmed ??
        rawProperty.going_concern_conditions_confirmed ??
        rawProperty.extracted_going_concern_confirmed,
    );
    const solicitorGoingConcern = normalizeConfirmation(
      rawProperty.solicitor_going_concern_confirmed ??
        rawProperty.solicitorConfirmedGoingConcern,
    );
    const accountantGoingConcern = normalizeConfirmation(
      rawProperty.accountant_going_concern_confirmed ??
        rawProperty.accountantConfirmedGoingConcern,
    );
    const savedItcClaimability = normalizeConfirmation(
      rawProperty.gst_claimable_as_itc ??
        rawProperty.gstClaimableAsInputTaxCredit ??
        rawProperty.itc_claimability_confirmed,
    );
    const savedSettlementTiming = firstString(
      rawProperty.settlement_gst_timing,
      rawProperty.estimated_refund_timing,
      rawProperty.gst_refund_timing,
    ) as RefundTiming | undefined;
    return {
      price: [
        prefill?.purchasePrice != null
          ? {
              value: String(prefill.purchasePrice),
              source: "Property Profile" as SourceState,
              detail: "Commercial / Industrial property profile purchase price",
            }
          : undefined,
        scrapedPrice != null
          ? {
              value: String(scrapedPrice),
              source: "Scraped" as SourceState,
              detail: "Scraped asking price / guide price",
            }
          : undefined,
        contractPrice != null
          ? {
              value: String(contractPrice),
              source: "Contract Extracted" as SourceState,
              detail: "Contract extraction purchase price",
            }
          : undefined,
        borrowingPrice != null
          ? {
              value: String(borrowingPrice),
              source: "Manual" as SourceState,
              detail: "Borrowing Capacity purchase price fallback",
            }
          : undefined,
      ].find(Boolean) as SourceCandidate<string> | undefined,
      treatment: [
        contractTreatment
          ? {
              value: contractTreatment,
              source: "Contract Extracted" as SourceState,
              detail: "Contract GST clauses",
            }
          : undefined,
        profileTreatment
          ? {
              value: profileTreatment,
              source: "Property Profile" as SourceState,
              detail: "Saved property profile GST treatment",
            }
          : undefined,
        aiTreatment
          ? {
              value: aiTreatment,
              source: "AI Estimate" as SourceState,
              detail: "AI estimate from property and contract context",
            }
          : undefined,
      ].find(Boolean) as SourceCandidate<string> | undefined,
      registered: [
        clientRegistered
          ? {
              value: clientRegistered,
              source: "Verified" as SourceState,
              detail: "Client / entity profile GST registration",
            }
          : undefined,
        savedRegistered
          ? {
              value: savedRegistered,
              source: "Property Profile" as SourceState,
              detail: "Saved purchaser structure GST registration",
            }
          : undefined,
      ].find(Boolean) as SourceCandidate<string> | undefined,
      goingConcernConfirmed: [
        contractGoingConcern
          ? {
              value: contractGoingConcern,
              source: "Contract Extracted" as SourceState,
              detail: "Contract extracted going concern conditions",
            }
          : undefined,
        solicitorGoingConcern
          ? {
              value: solicitorGoingConcern,
              source: "Solicitor Confirmed" as SourceState,
              detail: "Solicitor confirmation flag",
            }
          : undefined,
        accountantGoingConcern
          ? {
              value: accountantGoingConcern,
              source: "Accountant Confirmed" as SourceState,
              detail: "Accountant confirmation flag",
            }
          : undefined,
      ].find(Boolean) as SourceCandidate<string> | undefined,
      itcClaimability: savedItcClaimability
        ? {
            value: savedItcClaimability,
            source: "Verified" as SourceState,
            detail: "Saved ITC claimability confirmation flag",
          }
        : undefined,
      settlementTiming:
        savedSettlementTiming &&
        [
          "atSettlement",
          "oneToThreeMonths",
          "threePlusMonths",
          "unknown",
        ].includes(savedSettlementTiming)
          ? {
              value: savedSettlementTiming,
              source: "Property Profile" as SourceState,
              detail: "Saved settlement GST timing",
            }
          : undefined,
    };
  }, [prefill, property]);

  useEffect(() => {
    applyCascadedValue("price", sourceCandidates.price);
    applyCascadedValue("treatment", sourceCandidates.treatment);
    applyCascadedValue("registered", sourceCandidates.registered);
    applyCascadedValue(
      "goingConcernConfirmed",
      sourceCandidates.goingConcernConfirmed,
    );
    applyCascadedValue("itcClaimability", sourceCandidates.itcClaimability);
    applyCascadedValue("settlementTiming", sourceCandidates.settlementTiming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceCandidates]);

  const buildExtractionPreview = (): GstExtractionPreview | null => {
    const contractText = detectText(
      rawProperty.contract_text,
      rawProperty.contractText,
      rawProperty.extracted_contract_text,
      rawProperty.gst_clause,
      rawProperty.saved_gst_clause,
      rawProperty.contract_gst_clause,
    );
    const scrapeText = detectText(
      rawProperty.scraped_description,
      rawProperty.scrape_text,
      rawProperty.property_description,
      rawProperty.notes,
      rawProperty.gst_treatment,
    );
    const combinedText = `${contractText} ${scrapeText}`.trim();
    const hasContract =
      contractText.length > 0 ||
      Boolean(
        rawProperty.uploaded_contract ||
        rawProperty.contract_file ||
        rawProperty.contract_url,
      );
    const hasScrape =
      scrapeText.length > 0 || sourceCandidates.treatment?.source === "Scraped";
    const hasProfileContext = Boolean(
      prefill?.purchasePrice || prefill?.gstTreatment || prefill?.address,
    );
    if (!hasContract && !hasScrape && !hasProfileContext) return null;
    const inferred =
      inferTreatmentFromText(combinedText) ??
      (sourceCandidates.treatment?.value as GstTreatmentInput | undefined) ??
      "unknown";
    const goingConcernPresent =
      /going concern/.test(combinedText) || inferred === "going_concern";
    const marginSchemePresent =
      /margin scheme/.test(combinedText) || inferred === "margin_scheme";
    const taxableSupplyPresent =
      /taxable supply|plus gst|\+\s*gst|gst inclusive/.test(combinedText) ||
      ["standard", "plus_gst"].includes(inferred);
    const confidence: GstExtractionPreview["confidence"] =
      hasContract && inferred !== "unknown"
        ? "High"
        : (hasScrape || sourceCandidates.treatment) && inferred !== "unknown"
          ? "Medium"
          : "Low";
    const missingInformation = [
      !hasContract && "Contract of sale or extracted GST clauses",
      registered === "unknown" && "Purchaser GST registration status",
      inferred === "going_concern" &&
        !goingConcernPresent &&
        "Going concern condition wording",
    ].filter(Boolean) as string[];
    return {
      suggestedTreatment: inferred,
      purchaserRegistrationRequirement:
        registered === "unknown" ? "yes" : registered,
      goingConcernPresent,
      marginSchemePresent,
      taxableSupplyPresent,
      confidence,
      clauseSummary: combinedText
        ? combinedText.slice(0, 260)
        : "No contract clause text available; suggestion uses property profile context only.",
      missingInformation,
      requiredConfirmations: [
        "Contract GST clause reviewed",
        "Purchaser GST registration confirmed",
        "Solicitor/accountant confirmation before reliance",
      ],
      specialistReviewRequired:
        inferred === "unknown" ||
        inferred === "custom_review" ||
        marginSchemePresent,
      source: hasContract ? "Contract Extracted" : "AI Estimate",
    };
  };
  const runExtractionWorkflow = () => {
    const preview = buildExtractionPreview();
    if (!preview) {
      setExtractionPreview(null);
      setExtractionNotice(
        "More property or contract information is required before GST treatment can be estimated.",
      );
      return;
    }
    setExtractionNotice(
      "GST treatment must be confirmed by the contract, solicitor/accountant advice and purchaser GST registration status before being relied upon.",
    );
    setExtractionPreview(preview);
  };
  const applySelectedPreviewFields = () => {
    if (!extractionPreview) return;
    if (previewSelections.treatment)
      applyPreviewField(
        "treatment",
        extractionPreview.suggestedTreatment,
        extractionPreview.source,
      );
    if (previewSelections.registered)
      applyPreviewField(
        "registered",
        extractionPreview.purchaserRegistrationRequirement,
        extractionPreview.source,
      );
    if (previewSelections.goingConcernConfirmed)
      applyPreviewField(
        "goingConcernConfirmed",
        extractionPreview.goingConcernPresent ? "yes" : "unknown",
        extractionPreview.source,
      );
    setExtractionNotice(
      "GST treatment must be confirmed by the contract, solicitor/accountant advice and purchaser GST registration status before being relied upon.",
    );
  };
  const markPreviewConfirmed = (
    source: Extract<
      SourceState,
      "Solicitor Confirmed" | "Accountant Confirmed"
    >,
  ) => {
    if (!extractionPreview) return;
    applyPreviewField(
      "treatment",
      extractionPreview.suggestedTreatment,
      source,
    );
    if (extractionPreview.goingConcernPresent)
      applyPreviewField("goingConcernConfirmed", "yes", source);
    setExtractionNotice(
      "GST treatment must be confirmed by the contract, solicitor/accountant advice and purchaser GST registration status before being relied upon.",
    );
  };

  const purchasePriceValue = parseNumeric(price);
  const priorCostValue = parseNumeric(priorCost);
  const isZeroGstTreatment =
    treatment === "input_taxed" ||
    treatment === "out_of_scope" ||
    treatment === "no_gst";
  const hasPurchasePrice =
    purchasePriceValue !== null && purchasePriceValue > 0;
  const hasTreatment = treatment !== "unknown";
  const isSpecialistTreatment =
    treatment === "unknown" || treatment === "custom_review";
  const dataEntryStarted =
    hasPurchasePrice ||
    hasTreatment ||
    registered !== "unknown" ||
    goingConcernConfirmed !== "unknown" ||
    itcClaimability !== "unknown" ||
    settlementTiming !== "unknown";
  const hasRequiredInputs =
    hasPurchasePrice &&
    treatment !== "unknown" &&
    treatment !== "custom_review" &&
    (!["standard", "plus_gst"].includes(treatment) ||
      (registered !== "unknown" &&
        itcClaimability !== "unknown" &&
        settlementTiming !== "unknown")) &&
    (treatment !== "going_concern" || goingConcernConfirmed === "yes") &&
    (treatment !== "margin_scheme" || priorCostValue !== null);
  const contractReviewed =
    sources.treatment === "Contract Extracted" ||
    sources.treatment === "Solicitor Confirmed" ||
    sources.treatment === "Accountant Confirmed" ||
    sources.treatment === "Verified";
  const treatmentConfirmed = [
    "Contract Extracted",
    "Solicitor Confirmed",
    "Accountant Confirmed",
    "Verified",
  ].includes(sources.treatment);
  const professionalConfirmed =
    ["Solicitor Confirmed", "Accountant Confirmed", "Verified"].includes(
      sources.treatment,
    ) ||
    ["Solicitor Confirmed", "Accountant Confirmed", "Verified"].includes(
      sources.goingConcernConfirmed,
    );
  const internallyInconsistent =
    (treatment === "going_concern" && goingConcernConfirmed === "no") ||
    (treatment === "standard" &&
      registered === "no" &&
      itcClaimability === "yes") ||
    (treatment === "margin_scheme" && priorCostValue === null) ||
    sourceConflicts.treatment?.source === "Contract Extracted";
  const reviewTriggered =
    (dataEntryStarted && treatment === "unknown") ||
    sources.treatment === "AI Estimate" ||
    sources.treatment === "User Override" ||
    sources.price === "Manual" ||
    sources.price === "User Override" ||
    registered === "unknown" ||
    itcClaimability === "unknown" ||
    (treatment === "going_concern" && goingConcernConfirmed !== "yes") ||
    (treatment === "going_concern" && registered !== "yes") ||
    (["standard", "plus_gst"].includes(treatment) &&
      settlementTiming === "unknown") ||
    (treatment === "margin_scheme" && priorCostValue === null) ||
    !contractReviewed ||
    !professionalConfirmed ||
    internallyInconsistent;
  const formulaTreatment: GstTreatment = isZeroGstTreatment
    ? "input_taxed"
    : (treatment as GstTreatment);
  const purchaserCanClaimItc =
    registered === "yes" && itcClaimability === "yes";
  const result = useMemo(
    () =>
      hasRequiredInputs
        ? calculateCommercialGst({
            purchasePrice: purchasePriceValue,
            treatment: formulaTreatment,
            priorCost: priorCostValue ?? 0,
            purchaserRegistered: purchaserCanClaimItc,
          })
        : null,
    [
      hasRequiredInputs,
      purchasePriceValue,
      formulaTreatment,
      priorCostValue,
      purchaserCanClaimItc,
      settlementTiming,
    ],
  );
  const assessment = useMemo(
    () =>
      hasRequiredInputs
        ? calculateCommercialGstEngine({
            purchasePrice: purchasePriceValue,
            treatment:
              treatment === "going_concern"
                ? "goingConcern"
                : treatment === "standard"
                  ? "gstInclusive"
                  : treatment === "plus_gst"
                    ? "plusGst"
                  : treatment === "margin_scheme"
                    ? "marginScheme"
                    : isZeroGstTreatment
                      ? "unknown"
                      : "unknown",
            vendorGstRegistered: "unknown",
            purchaserGstRegistered: registered,
            goingConcernAgreedInWriting: goingConcernConfirmed,
            enterpriseCarriedOnUntilSettlement: goingConcernConfirmed,
            supplierProvidesAllThingsNecessary: goingConcernConfirmed,
            propertyLeasedOrOperatingEnterprise: goingConcernConfirmed,
            gstClaimableAsInputTaxCredit: purchaserCanClaimItc ? "yes" : "no",
            estimatedRefundTiming:
              settlementTiming === "unknown" ? "unknown" : settlementTiming,
          })
        : null,
    [
      hasRequiredInputs,
      purchasePriceValue,
      treatment,
      isZeroGstTreatment,
      registered,
      goingConcernConfirmed,
      purchaserCanClaimItc,
      settlementTiming,
    ],
  );
  const confirmationItemsComplete =
    Boolean(prefill) &&
    contractReviewed &&
    registered !== "unknown" &&
    treatmentConfirmed &&
    professionalConfirmed;
  const readinessStatus =
    !hasPurchasePrice || !hasTreatment
      ? dataEntryStarted && treatment === "unknown" && hasPurchasePrice
        ? "GST Treatment Review Required"
        : "Awaiting GST Inputs"
      : reviewTriggered || isSpecialistTreatment
        ? "GST Treatment Review Required"
        : confirmationItemsComplete
          ? "GST Treatment Verified"
          : hasRequiredInputs
            ? "GST Assessment Ready"
            : "Preliminary GST Estimate";
  const canExtractFromContract = Boolean(prefill);
  const gstAmountValue =
    hasRequiredInputs && assessment && result
      ? assessment.gstAmount || result.gstAmount
      : null;
  const gstClaimableValue =
    hasRequiredInputs && assessment && result
      ? assessment.gstClaimableAmount || result.gstClaimable
      : null;
  const settlementCashflowValue =
    hasRequiredInputs && assessment
      ? isZeroGstTreatment
        ? 0
        : assessment.gstSettlementCashflowRequirement
      : null;
  const economicCostValue =
    hasRequiredInputs && assessment
      ? isZeroGstTreatment
        ? 0
        : assessment.gstEconomicCost
      : null;
  const netAcquisitionCostValue =
    hasRequiredInputs && result && purchasePriceValue !== null
      ? isZeroGstTreatment
        ? result.netAcquisitionCost
        : assessment?.netAcquisitionCost || result.netAcquisitionCost
      : null;
  const timingRiskValue =
    hasRequiredInputs && assessment
      ? isZeroGstTreatment
        ? "low"
        : assessment.gstTimingRisk
      : null;
  const gstWarnings = useMemo<GstWarning[]>(() => {
    if (!dataEntryStarted) return [];
    const warnings: GstWarning[] = [];
    const add = (warning: GstWarning) => warnings.push(warning);
    if (!hasPurchasePrice)
      add({
        category: "Purchase Price",
        severity: "Required",
        priority: 10,
        message: "Purchase price is missing.",
        detail:
          "Confirm purchase price from the property profile, contract or scrape before relying on GST outputs.",
      });
    if (treatment === "unknown")
      add({
        category: "GST Treatment",
        severity: "Critical",
        priority: 5,
        message:
          "GST treatment is unknown. Confirm contract GST clause before relying on this result.",
        detail:
          "Unknown GST treatment cannot be relied on until contract clauses and professional advice confirm the position.",
      });
    if (sources.treatment === "AI Estimate")
      add({
        category: "GST Treatment",
        severity: "Required",
        priority: 15,
        message:
          "AI estimate is not verified. Obtain solicitor/accountant confirmation.",
        detail:
          "AI output is not verified advice and should remain preliminary until confirmed.",
      });
    if (sources.price === "Manual" || sources.price === "User Override")
      add({
        category: "Purchase Price",
        severity: "Required",
        priority: 20,
        message:
          "Purchase price is manual and not linked to property or contract.",
        detail:
          "Link property profile, contract extraction or scrape data to reduce reliance on a manual price.",
      });
    if (registered === "unknown")
      add({
        category: "Purchaser Registration",
        severity: "Required",
        priority: 25,
        message: "Purchaser GST registration is not confirmed.",
        detail:
          "Confirm purchaser GST registration status before relying on ITC claimability.",
      });
    if (itcClaimability === "unknown")
      add({
        category: "ITC Claimability",
        severity: "Required",
        priority: 30,
        message: "GST claimability is not confirmed.",
        detail:
          "Confirm whether the purchaser can claim GST as an input tax credit.",
      });
    if (treatment === "going_concern" && goingConcernConfirmed !== "yes")
      add({
        category: "Going Concern",
        severity: "Critical",
        priority: 12,
        message: "Going concern selected but conditions are not verified.",
        detail:
          "Confirm written agreement, enterprise continuity and all going-concern requirements.",
      });
    if (treatment === "going_concern" && registered !== "yes")
      add({
        category: "Going Concern",
        severity: "Critical",
        priority: 13,
        message:
          "Going concern selected but purchaser GST registration is not confirmed.",
        detail:
          "GST-free going concern treatment requires purchaser GST registration confirmation.",
      });
    if (
      ["standard", "plus_gst"].includes(treatment) &&
      settlementTiming === "unknown"
    )
      add({
        category: "Settlement Cashflow",
        severity: "Required",
        priority: 18,
        message:
          "Taxable supply may create GST settlement cashflow. Confirm funding and ITC timing.",
        detail:
          "Confirm whether GST is payable at settlement and when any ITC refund is expected.",
      });
    if (treatment === "margin_scheme" && priorCostValue === null)
      add({
        category: "GST Treatment",
        severity: "Critical",
        priority: 14,
        message:
          "Margin scheme selected but required margin inputs are missing.",
        detail:
          "Provide prior acquisition cost or required margin inputs before relying on margin-scheme GST.",
      });
    if (!contractReviewed)
      add({
        category: "Contract Review",
        severity: "Required",
        priority: 35,
        message: "Contract GST clause has not been reviewed.",
        detail:
          "Review the contract GST clause or extract GST wording before relying on the result.",
      });
    if (!professionalConfirmed)
      add({
        category: "Verification",
        severity: "Required",
        priority: 40,
        message: "Solicitor/accountant confirmation has not been received.",
        detail:
          "Obtain professional confirmation before treating GST outputs as verified.",
      });
    if (
      (settlementCashflowValue ?? 0) > 0 &&
      settlementTiming !== "atSettlement"
    )
      add({
        category: "Settlement Cashflow",
        severity: "Recommended",
        priority: 45,
        message:
          "GST amount is material and settlement cashflow funding should be confirmed.",
        detail:
          "Confirm available funds for GST payable at settlement and expected ITC refund timing.",
      });
    if (sourceConflicts.treatment?.source === "Contract Extracted")
      add({
        category: "GST Treatment",
        severity: "Critical",
        priority: 8,
        message:
          "Manual override differs from contract extracted treatment. Review assumption history.",
        detail:
          "A user override conflicts with the contract-extracted GST treatment.",
      });
    return warnings.sort((a, b) => a.priority - b.priority);
  }, [
    dataEntryStarted,
    hasPurchasePrice,
    treatment,
    sources.treatment,
    sources.price,
    registered,
    itcClaimability,
    goingConcernConfirmed,
    settlementTiming,
    priorCostValue,
    contractReviewed,
    professionalConfirmed,
    settlementCashflowValue,
    sourceConflicts.treatment,
  ]);
  const priorityWarnings = gstWarnings.slice(0, 3);
  const statusBadgeClass =
    readinessStatus === "GST Treatment Verified"
      ? "border-success/40 bg-success/10 text-success"
      : readinessStatus === "GST Treatment Review Required"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : readinessStatus === "Preliminary GST Estimate" ||
            sources.treatment === "AI Estimate"
          ? "border-brand-500/40 bg-brand-500/10 text-brand-100"
          : readinessStatus === "GST Assessment Ready"
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/70 bg-muted/20 text-muted-foreground";

  const checklist = [
    { label: "Purchase price confirmed", complete: hasPurchasePrice },
    { label: "Contract GST clause reviewed", complete: contractReviewed },
    { label: "GST treatment confirmed", complete: treatmentConfirmed },
    {
      label: "Purchaser GST registration confirmed",
      complete: registered !== "unknown",
    },
    {
      label: "ITC claimability confirmed",
      complete: itcClaimability !== "unknown",
    },
    {
      label: "Settlement GST timing confirmed",
      complete: settlementTiming !== "unknown" || isZeroGstTreatment,
    },
    {
      label: "Solicitor/accountant confirmation received",
      complete: professionalConfirmed,
    },
    {
      label: "Save-back completed",
      complete: Boolean(prefill) && sources.treatment === "Property Profile",
    },
  ];
  const nextAction =
    !purchasePriceValue || treatment === "unknown"
      ? "Inputs are incomplete. Confirm purchase price and GST treatment."
      : treatment === "going_concern" && goingConcernConfirmed !== "yes"
        ? "Going concern selected but not verified. Confirm contract clauses and purchaser GST registration."
        : treatment === "standard"
          ? "Taxable supply selected. Confirm whether GST is payable at settlement and whether ITC is claimable."
          : isSpecialistTreatment
            ? "GST treatment is unknown. Obtain solicitor/accountant confirmation before relying on the result."
            : readinessStatus === "GST Treatment Verified"
              ? "GST treatment is verified. Net acquisition cost can be used in reporting."
              : "Review GST assumptions and resolve any remaining confirmation items before relying on the result.";

  const sourceCounts = {
    overrides: Object.values(sources).filter(
      (source) => source === "User Override",
    ).length,
    contract: Object.values(sources).filter(
      (source) => source === "Contract Extracted",
    ).length,
    ai: Object.values(sources).filter((source) => source === "AI Estimate")
      .length,
    verified: Object.values(sources).filter((source) =>
      ["Verified", "Solicitor Confirmed", "Accountant Confirmed"].includes(
        source,
      ),
    ).length,
  };
  const hasAnySaveValue = Boolean(
    purchasePriceValue !== null || persistedTreatment(treatment),
  );
  const saveBackDisabled = !prefill || !hasAnySaveValue || saving;
  const calculatedOutputs = {
    gstAmount: gstAmountValue,
    gstClaimable: gstClaimableValue,
    gstSettlementCashflow: settlementCashflowValue,
    gstEconomicCost: economicCostValue,
    gstTimingRisk: timingRiskValue,
    netAcquisitionCost: netAcquisitionCostValue,
  };
  const saveSnapshot = {
    inputs: {
      purchasePrice: purchasePriceValue,
      treatment,
      purchaserGstRegistered: registered,
      goingConcernConfirmed,
      itcClaimability,
      settlementTiming,
      priorCost: priorCostValue,
    },
    sources,
    originalSourceValues: sourceCandidates,
    userOverrideValues: Object.fromEntries(
      Object.entries(sources)
        .filter(([, source]) => source === "User Override")
        .map(([field]) => [field, currentValues[field as GstFieldKey]]),
    ),
    contractExtractedValues: Object.fromEntries(
      Object.entries(sources)
        .filter(([, source]) => source === "Contract Extracted")
        .map(([field]) => [field, currentValues[field as GstFieldKey]]),
    ),
    aiEstimatedValues: Object.fromEntries(
      Object.entries(sources)
        .filter(([, source]) => source === "AI Estimate")
        .map(([field]) => [field, currentValues[field as GstFieldKey]]),
    ),
    outputs: calculatedOutputs,
    readinessStatus,
    checklist,
    warnings: gstWarnings,
    timestamp: new Date().toISOString(),
    userId: rawProperty.user_id,
    calculationVersion: "gst-treatment-v1",
    propertyId: prefill?.propertyId,
    scenarioId: rawProperty.scenario_id,
  };
  const saveRows = [
    [
      "Purchase Price",
      purchasePriceValue === null ? PENDING : fmt(purchasePriceValue),
    ],
    ["GST Treatment", treatment],
    ["Purchaser GST-Registered status", registered],
    ["Going Concern confirmed status", goingConcernConfirmed],
    ["GST Claimability status", itcClaimability],
    ["Settlement GST timing", settlementTiming],
    ["GST Amount", gstAmountValue === null ? PENDING : fmt(gstAmountValue)],
    [
      "GST Claimable (ITC)",
      gstClaimableValue === null ? PENDING : fmt(gstClaimableValue),
    ],
    [
      "GST Settlement Cashflow",
      settlementCashflowValue === null ? PENDING : fmt(settlementCashflowValue),
    ],
    [
      "GST Economic Cost",
      economicCostValue === null ? PENDING : fmt(economicCostValue),
    ],
    ["GST Timing Risk", timingRiskValue ?? PENDING],
    [
      "Net Acquisition Cost",
      netAcquisitionCostValue === null ? PENDING : fmt(netAcquisitionCostValue),
    ],
    ["Number of user overrides", String(sourceCounts.overrides)],
    ["Number of contract extracted values", String(sourceCounts.contract)],
    ["Number of AI-estimated values", String(sourceCounts.ai)],
    ["Number of verified values", String(sourceCounts.verified)],
  ];
  const confirmSaveBack = async () => {
    if (!prefill) return;
    setSaveNotice("");
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (purchasePriceValue !== null)
        patch.purchase_price = purchasePriceValue;
      const savedTreatment = persistedTreatment(treatment);
      if (savedTreatment) patch.gst_treatment = savedTreatment;
      const result = await pushBack(patch);
      if (!result.ok) return;
      updateGlobal("gstInputs", {
        purchasePrice: purchasePriceValue ?? undefined,
        treatment:
          treatment === "going_concern"
            ? "goingConcern"
            : treatment === "standard"
              ? "gstInclusive"
              : treatment === "plus_gst"
                ? "plusGst"
              : treatment === "margin_scheme"
                ? "marginScheme"
                : "unknown",
        purchaserGstRegistered: registered,
        gstClaimableAsInputTaxCredit: purchaserCanClaimItc ? "yes" : "no",
        estimatedRefundTiming:
          settlementTiming === "unknown" ? undefined : settlementTiming,
        otherAcquisitionCosts: undefined,
      } as any);
      updateGlobal("gstOutputs", {
        ...(calculatedOutputs as any),
        readinessStatus,
        savedAt: saveSnapshot.timestamp,
        sourceSummary: sources,
        confirmationChecklist: checklist,
      } as any);
      updateGlobal("acquisitionCosts", {
        gstTreatment: treatment,
        gstAmount: gstAmountValue ?? undefined,
        gstClaimable: purchaserCanClaimItc ? "yes" : "no",
        gstCashflowRequired: (settlementCashflowValue ?? 0) > 0 ? "yes" : "no",
        goingConcernConfirmed,
      } as any);
      updateGlobal("reportPayload", {
        gst: {
          treatment,
          settlementCashflow: settlementCashflowValue,
          economicCost: economicCostValue,
          timingRisk: timingRiskValue,
          readinessStatus,
          verificationStatus: readinessStatus,
          savedAt: saveSnapshot.timestamp,
        },
      } as any);
      updateGlobal("scenarioOverrides", { gst: saveSnapshot } as any);
      setSourceMode("gst", "savedPropertyLinked");
      setSaveNotice(
        "Purchase price and GST treatment saved to the property profile. Current GST assumptions were refreshed for Borrowing Capacity, Funds to Complete, Report Overview, Scenario comparison and Client report outputs.",
      );
      setSaveDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-card via-card/95 to-primary/5 shadow-lg shadow-primary/5">
      <CardHeader className="space-y-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Landmark className="h-5 w-5 text-primary" /> Goods & Services Tax
            treatment
          </CardTitle>
          <CardDescription>
            Australian commercial acquisition GST — separates treatment,
            settlement cashflow, credits / liabilities and economic cost without
            changing the calculation logic.
          </CardDescription>
        </div>
        <div className="rounded-xl border border-primary/20 bg-background/35 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/5 text-primary"
              >
                {prefill
                  ? "Linked property source"
                  : "Manual entry / no property linked"}
              </Badge>
              <Badge
                variant="outline"
                className="border-primary/40 text-primary"
              >
                Global Input Sync: On
              </Badge>
              <Badge variant="outline" className={statusBadgeClass}>
                {readinessStatus}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdvancedOpen(true)}
                title="Open GST assumptions and warning log."
              >
                Assumption Status
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={runExtractionWorkflow}
                title={
                  canExtractFromContract
                    ? "Estimate GST treatment from linked property or contract context."
                    : "More property or contract information may be required before GST treatment can be estimated."
                }
              >
                Estimate / extract from contract
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saveBackDisabled}
                onClick={() => setSaveDialogOpen(true)}
                title={
                  !prefill
                    ? "Select or link a property before saving GST assumptions."
                    : "Save purchase price and GST treatment back to the linked property profile."
                }
              >
                {saving ? "Saving..." : "Save Back to Property"}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {saveNotice && (
          <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
            {saveNotice}
          </div>
        )}
        {extractionNotice && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-100">
            {extractionNotice}
          </div>
        )}
        {extractionPreview && (
          <section className="rounded-xl border border-primary/20 bg-background/35 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  AI / Contract Extraction Preview
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  AI output is an estimate only and is not verified advice.
                </p>
              </div>
              <Badge
                variant={
                  extractionPreview.specialistReviewRequired
                    ? "destructive"
                    : "outline"
                }
              >
                {extractionPreview.specialistReviewRequired
                  ? "Specialist review flag"
                  : `${extractionPreview.confidence} confidence`}
              </Badge>
            </div>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
              <PreviewItem
                label="Suggested GST treatment"
                value={extractionPreview.suggestedTreatment}
              />
              <PreviewItem
                label="Purchaser registration requirement"
                value={extractionPreview.purchaserRegistrationRequirement}
              />
              <PreviewItem
                label="Going concern wording"
                value={
                  extractionPreview.goingConcernPresent
                    ? "Appears present"
                    : "Not identified"
                }
              />
              <PreviewItem
                label="Margin scheme wording"
                value={
                  extractionPreview.marginSchemePresent
                    ? "Appears present"
                    : "Not identified"
                }
              />
              <PreviewItem
                label="Taxable supply wording"
                value={
                  extractionPreview.taxableSupplyPresent
                    ? "Appears present"
                    : "Not identified"
                }
              />
              <PreviewItem
                label="Confidence level"
                value={extractionPreview.confidence}
              />
              <PreviewItem
                label="Missing information"
                value={
                  extractionPreview.missingInformation.join(", ") ||
                  "None identified"
                }
              />
              <PreviewItem
                label="Required confirmations"
                value={extractionPreview.requiredConfirmations.join(", ")}
              />
            </div>
            <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">
                Extracted clause text summary
              </div>
              <p className="mt-1">{extractionPreview.clauseSummary}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() =>
                  applyPreviewField(
                    "treatment",
                    extractionPreview.suggestedTreatment,
                    extractionPreview.source,
                  )
                }
              >
                Accept suggested treatment
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={applySelectedPreviewFields}
              >
                Accept selected fields only
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setExtractionNotice(
                    "Edit the previewed selections in the GST Inputs section before applying.",
                  )
                }
              >
                Edit before applying
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setExtractionPreview(null);
                  setExtractionNotice(
                    "GST extraction suggestion rejected; current assumptions were kept.",
                  );
                }}
              >
                Reject suggestion
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => markPreviewConfirmed("Solicitor Confirmed")}
              >
                Mark as solicitor confirmed
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => markPreviewConfirmed("Accountant Confirmed")}
              >
                Mark as accountant confirmed
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {(
                [
                  "treatment",
                  "registered",
                  "goingConcernConfirmed",
                ] as GstFieldKey[]
              ).map((field) => (
                <label key={field} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={previewSelections[field]}
                    onChange={(e) =>
                      setPreviewSelections((prev) => ({
                        ...prev,
                        [field]: e.target.checked,
                      }))
                    }
                  />{" "}
                  Apply {field}
                </label>
              ))}
            </div>
          </section>
        )}
        <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          <PremiumGstSection
            eyebrow="Transaction GST profile"
            title="Editable GST inputs"
            description="Confirm the transaction profile, GST treatment and professional confirmation fields used by the existing GST engines."
            icon={<ClipboardCheck className="h-4 w-4" />}
            className="order-2 xl:order-1"
          >
            <div className="mb-3">
              <h3 className="text-base font-semibold text-foreground">
                GST Inputs
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Confirm purchase price, GST treatment and registration status
                used to estimate GST cashflow and economic cost.
              </p>
            </div>
            <div className="space-y-3">
              <FieldShell
                label="Purchase Price"
                source={sources.price}
                conflict={sourceConflicts.price}
                onKeep={() =>
                  setSourceConflicts((prev) => {
                    const next = { ...prev };
                    delete next.price;
                    return next;
                  })
                }
                onUse={() => useSourceValue("price", sourceConflicts.price)}
              >
                <Input
                  className="bg-background/80 font-medium shadow-inner"
                  type="number"
                  value={price}
                  onChange={(e) =>
                    markOverride("price", e.target.value, setPrice)
                  }
                  placeholder="Pulled from property profile or enter manually"
                />
              </FieldShell>
              <div>
                <FieldLabel label="GST Treatment" source={sources.treatment} />
                <Select
                  value={treatment}
                  onValueChange={(v) =>
                    markOverride("treatment", v, setTreatment)
                  }
                >
                  <SelectTrigger className="bg-background/80 font-medium shadow-inner">
                    {treatment === "unknown" ? (
                      <span className="text-muted-foreground">
                        Select GST treatment
                      </span>
                    ) : (
                      <SelectValue />
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Unknown</SelectItem>
                    <SelectItem value="standard">Taxable Supply</SelectItem>
                    <SelectItem value="plus_gst">Price Plus GST</SelectItem>
                    <SelectItem value="going_concern">
                      GST-Free Going Concern
                    </SelectItem>
                    <SelectItem value="margin_scheme">Margin Scheme</SelectItem>
                    <SelectItem value="out_of_scope">Out of Scope</SelectItem>
                    <SelectItem value="no_gst">No GST Applicable</SelectItem>
                    <SelectItem value="custom_review">
                      Custom / Specialist Review
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {treatment === "margin_scheme" && (
                <div>
                  <Label>Prior Acquisition Cost</Label>
                  <Input
                    className="bg-background/80 font-medium shadow-inner"
                    type="number"
                    value={priorCost}
                    onChange={(e) => setPriorCost(e.target.value)}
                    placeholder="Enter prior acquisition cost if known"
                  />
                </div>
              )}
              <FieldConflict
                conflict={sourceConflicts.treatment}
                onKeep={() =>
                  setSourceConflicts((prev) => {
                    const next = { ...prev };
                    delete next.treatment;
                    return next;
                  })
                }
                onUse={() =>
                  useSourceValue("treatment", sourceConflicts.treatment)
                }
              />
              <SelectField
                label="Purchaser GST-Registered"
                value={registered}
                source={sources.registered}
                onChange={(v) => markOverride("registered", v, setRegistered)}
                placeholder="Confirm purchaser GST registration"
                conflict={sourceConflicts.registered}
                onKeep={() =>
                  setSourceConflicts((prev) => {
                    const next = { ...prev };
                    delete next.registered;
                    return next;
                  })
                }
                onUse={() =>
                  useSourceValue("registered", sourceConflicts.registered)
                }
              />
              <SelectField
                label="Going Concern Conditions Confirmed"
                value={goingConcernConfirmed}
                source={sources.goingConcernConfirmed}
                onChange={(v) =>
                  markOverride(
                    "goingConcernConfirmed",
                    v,
                    setGoingConcernConfirmed,
                  )
                }
                placeholder="Confirm contract conditions"
                conflict={sourceConflicts.goingConcernConfirmed}
                onKeep={() =>
                  setSourceConflicts((prev) => {
                    const next = { ...prev };
                    delete next.goingConcernConfirmed;
                    return next;
                  })
                }
                onUse={() =>
                  useSourceValue(
                    "goingConcernConfirmed",
                    sourceConflicts.goingConcernConfirmed,
                  )
                }
              />
              <SelectField
                label="GST Claimability Confirmed"
                value={itcClaimability}
                source={sources.itcClaimability}
                onChange={(v) =>
                  markOverride("itcClaimability", v, setItcClaimability)
                }
                placeholder="Confirm ITC claimability"
                conflict={sourceConflicts.itcClaimability}
                onKeep={() =>
                  setSourceConflicts((prev) => {
                    const next = { ...prev };
                    delete next.itcClaimability;
                    return next;
                  })
                }
                onUse={() =>
                  useSourceValue(
                    "itcClaimability",
                    sourceConflicts.itcClaimability,
                  )
                }
              />
              <TimingField
                value={settlementTiming}
                source={sources.settlementTiming}
                onChange={(v) =>
                  markOverride("settlementTiming", v, setSettlementTiming)
                }
              />
            </div>
          </PremiumGstSection>

          <PremiumGstSection
            eyebrow="GST treatment assumptions"
            title="Calculated GST position"
            description="Report-ready outputs are calculated fields; edit the left-side assumptions to refresh these values."
            icon={<Calculator className="h-4 w-4" />}
            className="order-1 xl:order-2"
          >
            <TreatmentHero
              treatment={treatment}
              readinessStatus={readinessStatus}
              reviewTriggered={reviewTriggered || isSpecialistTreatment}
            />
            {!hasRequiredInputs && (
              <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                <p className="text-sm font-semibold text-primary">
                  Awaiting GST Inputs
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Link a property, extract contract terms or enter purchase
                  price and GST treatment to estimate settlement cashflow and
                  economic cost.
                </p>
              </div>
            )}
            <div className="mt-3 space-y-2">
              <Row
                label="GST Amount / liability"
                value={gstAmountValue === null ? PENDING : fmt(gstAmountValue)}
              />
              <Row
                label="GST Claimable (ITC credit)"
                value={
                  gstClaimableValue === null ? PENDING : fmt(gstClaimableValue)
                }
              />
              <Row
                label="Settlement cashflow requirement"
                value={
                  settlementCashflowValue === null
                    ? PENDING
                    : fmt(settlementCashflowValue)
                }
                highlight
              />
              <Row
                label="Economic cost after claimability"
                value={
                  economicCostValue === null ? PENDING : fmt(economicCostValue)
                }
                highlight
              />
              <Row label="GST Timing Risk" value={timingRiskValue ?? PENDING} />
              <Separator />
              <Row
                label="Net Acquisition Cost"
                value={
                  netAcquisitionCostValue === null
                    ? PENDING
                    : fmt(netAcquisitionCostValue)
                }
                highlight
              />
            </div>
            {hasRequiredInputs && result && (
              <p className="text-xs text-muted-foreground pt-3">
                {result.notes}
              </p>
            )}
          </PremiumGstSection>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Collapsible
            open={confirmationOpen}
            onOpenChange={setConfirmationOpen}
            className="rounded-xl border border-border/70 bg-muted/20 p-4"
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between p-0 text-left hover:bg-transparent"
              >
                <span>
                  <span className="block text-base font-semibold text-foreground">
                    Required Confirmation Checklist
                  </span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Verify the contract GST clause, purchaser GST registration
                    and professional confirmation before relying on the result.
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-primary transition-transform ${confirmationOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2 text-sm">
              {checklist.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{item.label}</span>
                  <Badge variant={item.complete ? "default" : "outline"}>
                    {item.complete ? "Done" : "Pending"}
                  </Badge>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
          <PremiumGstSection
            eyebrow="Advisory notes / warnings"
            title="Recommended next action"
            description="Solicitor/accountant advice notes remain advisory and visible for client review."
            icon={<Scale className="h-4 w-4" />}
            className="bg-primary/5"
          >
            <p className="mt-2 text-sm leading-6 text-foreground">
              {nextAction}
            </p>
          </PremiumGstSection>
        </div>

        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="rounded-xl border border-border/70 bg-muted/20 p-4"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto w-full justify-between p-0 text-left text-primary hover:bg-transparent"
            >
              View GST treatment breakdown
              <ChevronDown
                className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-2">
            <AdvancedBlock
              title="Formula breakdown"
              lines={[
                `Purchase price: ${purchasePriceValue === null ? PENDING : fmt(purchasePriceValue)}`,
                `Treatment: ${treatment}`,
                `GST amount: ${gstAmountValue === null ? PENDING : fmt(gstAmountValue)}`,
                `Claimable: ${gstClaimableValue === null ? PENDING : fmt(gstClaimableValue)}`,
                `Net acquisition cost: ${netAcquisitionCostValue === null ? PENDING : fmt(netAcquisitionCostValue)}`,
              ]}
            />
            <AdvancedBlock
              title="Treatment explanation"
              lines={[
                result?.notes ??
                  "Pending treatment selection and confirmation.",
                isSpecialistTreatment
                  ? "Specialist review is required before relying on this GST treatment."
                  : "Confirm against contract and tax documentation before relying on this estimate.",
              ]}
            />
            <AdvancedBlock
              title="Contract extraction detail"
              lines={[
                sourceCandidates.treatment?.source === "Contract Extracted"
                  ? sourceCandidates.treatment.detail
                  : "No contract-extracted GST treatment currently applied.",
                sourceCandidates.price?.source === "Contract Extracted"
                  ? sourceCandidates.price.detail
                  : "No contract-extracted price currently applied.",
              ]}
            />
            <AdvancedBlock
              title="AI estimate reasoning"
              lines={[
                sourceCandidates.treatment?.source === "AI Estimate"
                  ? sourceCandidates.treatment.detail
                  : "No AI GST estimate currently applied.",
              ]}
            />
            <AdvancedBlock
              title="Full assumption list"
              lines={Object.entries(sources).map(
                ([field, source]) => `${field}: ${sourceLabel(source)}`,
              )}
            />
            <AdvancedBlock
              title="GST Warning Log"
              lines={
                gstWarnings.length
                  ? gstWarnings.map(
                      (w) =>
                        `${w.severity} · ${w.category}: ${w.message} ${w.detail}`,
                    )
                  : ["No GST warning log available yet."]
              }
            />
            <AdvancedBlock
              title="Audit history"
              lines={
                history.length
                  ? history.map(
                      (h) =>
                        `${h.field}: ${h.previousValue} (${sourceLabel(h.previousSource)}) → ${h.nextValue} (${sourceLabel(h.nextSource)})`,
                    )
                  : ["No GST assumption changes recorded yet."]
              }
            />
          </CollapsibleContent>
        </Collapsible>

        {priorityWarnings.length > 0 && (
          <section className="rounded-2xl border border-brand-500/40 bg-gradient-to-br from-brand-500/15 to-brand-500/5 p-4 text-xs text-brand-100 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-1 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Compact Warnings
                </span>
                <span className="ml-2 text-muted-foreground">
                  Showing top {priorityWarnings.length}.
                </span>
              </div>
              <button
                type="button"
                className="text-left text-primary underline"
                onClick={() => setAdvancedOpen(true)}
              >
                View all assumptions and warnings
              </button>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {priorityWarnings.map((w) => (
                <p key={`${w.category}-${w.message}`}>• {w.message}</p>
              ))}
            </div>
          </section>
        )}
      </CardContent>
      <AlertDialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save property GST fields and refresh downstream assumptions?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Purchase price and GST treatment are saved to the property. The
              remaining values shown below refresh downstream GST sync payloads
              without overwriting unrelated property fields.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              {saveRows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmSaveBack();
              }}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save and refresh GST"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SelectField({
  label,
  value,
  source,
  onChange,
  placeholder,
  conflict,
  onKeep,
  onUse,
}: {
  label: string;
  value: ConfirmationState;
  source: SourceState;
  onChange: (v: ConfirmationState) => void;
  placeholder: string;
  conflict?: SourceCandidate<string>;
  onKeep: () => void;
  onUse: () => void;
}) {
  return (
    <div>
      <FieldLabel label={label} source={source} />
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ConfirmationState)}
      >
        <SelectTrigger className="bg-background/80 font-medium shadow-inner">
          {value === "unknown" ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unknown">Unknown / Unconfirmed</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
      <FieldConflict conflict={conflict} onKeep={onKeep} onUse={onUse} />
    </div>
  );
}

function TimingField({
  value,
  source,
  onChange,
}: {
  value: RefundTiming;
  source: SourceState;
  onChange: (v: RefundTiming) => void;
}) {
  return (
    <div>
      <FieldLabel label="Settlement GST Timing" source={source} />
      <Select value={value} onValueChange={(v) => onChange(v as RefundTiming)}>
        <SelectTrigger className="bg-background/80 font-medium shadow-inner">
          {value === "unknown" ? (
            <span className="text-muted-foreground">
              Confirm GST settlement timing
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unknown">Unknown / Unconfirmed</SelectItem>
          <SelectItem value="atSettlement">At settlement</SelectItem>
          <SelectItem value="oneToThreeMonths">
            Refund expected in 1–3 months
          </SelectItem>
          <SelectItem value="threePlusMonths">
            Refund expected after 3+ months
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-foreground">{value}</div>
    </div>
  );
}

function PremiumGstSection({
  eyebrow,
  title,
  description,
  icon,
  className = "",
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-border/70 bg-background/55 p-4 shadow-sm backdrop-blur ${className}`}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </div>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function TreatmentHero({
  treatment,
  readinessStatus,
  reviewTriggered,
}: {
  treatment: GstTreatmentInput;
  readinessStatus: string;
  reviewTriggered: boolean;
}) {
  const labels: Record<GstTreatmentInput, string> = {
    unknown: "Unknown / pending confirmation",
    standard: "Taxable supply",
    plus_gst: "Price plus GST",
    going_concern: "GST-free going concern",
    margin_scheme: "Margin scheme",
    input_taxed: "Input taxed",
    out_of_scope: "Out of scope",
    no_gst: "No GST applicable",
    custom_review: "Custom / specialist review",
  };
  const descriptions: Record<GstTreatmentInput, string> = {
    unknown: "GST treatment has not been confirmed yet.",
    standard:
      "GST-inclusive / taxable supply logic applies based on the selected assumptions.",
    plus_gst:
      "GST is calculated in addition to the stated purchase price and included in settlement cashflow.",
    going_concern:
      "Going concern treatment is shown separately and remains subject to confirmation.",
    margin_scheme:
      "Margin scheme treatment is highlighted where present and remains specialist-review sensitive.",
    input_taxed: "Input-taxed treatment is preserved as selected.",
    out_of_scope: "Out-of-scope treatment is preserved as selected.",
    no_gst: "No-GST treatment is preserved as selected.",
    custom_review:
      "Custom treatment requires solicitor/accountant review before reliance.",
  };

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background/60 to-background/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            {labels[treatment]}
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {descriptions[treatment]}
          </p>
        </div>
        <Badge
          variant="outline"
          className={
            reviewTriggered
              ? "border-brand-500/40 bg-brand-500/10 text-brand-100"
              : "border-success/40 bg-success/10 text-success"
          }
        >
          {reviewTriggered ? "Review required" : readinessStatus}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-background/45 p-3">
          <ArrowRightLeft className="mb-2 h-4 w-4 text-primary" />
          Settlement cashflow is shown as a funding requirement.
        </div>
        <div className="rounded-xl border border-border/60 bg-background/45 p-3">
          <Calculator className="mb-2 h-4 w-4 text-primary" />
          Credits / liabilities are displayed before economic cost.
        </div>
        <div className="rounded-xl border border-border/60 bg-background/45 p-3">
          <FileText className="mb-2 h-4 w-4 text-primary" />
          Outputs remain report-ready once assumptions are confirmed.
        </div>
      </div>
    </div>
  );
}

function AdvancedBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/35 p-3">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-2 space-y-1">
        {lines.map((line, index) => (
          <p key={`${title}-${index}`}>{line}</p>
        ))}
      </div>
    </div>
  );
}

function FieldShell({
  label,
  source,
  conflict,
  onKeep,
  onUse,
  children,
}: {
  label: string;
  source: SourceState;
  conflict?: SourceCandidate<string>;
  onKeep: () => void;
  onUse: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel label={label} source={source} />
      {children}
      <FieldConflict conflict={conflict} onKeep={onKeep} onUse={onUse} />
    </div>
  );
}

function FieldLabel({ label, source }: { label: string; source: SourceState }) {
  return (
    <Label className="flex items-center gap-2">
      <span>{label}</span>
      <SourceBadge source={source} />
    </Label>
  );
}

function SourceBadge({ source }: { source: SourceState }) {
  return (
    <Badge
      variant="outline"
      className="border-primary/30 bg-primary/5 text-[10px] text-primary"
      title={`Source: ${sourceLabel(source)}`}
    >
      {sourceLabel(source)}
    </Badge>
  );
}

function FieldConflict({
  conflict,
  onKeep,
  onUse,
}: {
  conflict?: SourceCandidate<string>;
  onKeep: () => void;
  onUse: () => void;
}) {
  if (!conflict) return null;
  return (
    <div className="mt-2 rounded-md border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-100">
      <div>
        New source value available. This field currently uses a saved override.
      </div>
      <div className="mt-1 text-muted-foreground">
        {sourceLabel(conflict.source)}: {conflict.value}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" className="h-7" onClick={onKeep}>
          Keep override
        </Button>
        <Button size="sm" className="h-7" onClick={onUse}>
          Use source value
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() =>
            window.alert(
              `Current override is preserved. New ${sourceLabel(conflict.source)} value: ${conflict.value}`,
            )
          }
        >
          Compare values
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex justify-between items-center ${highlight ? "text-lg font-bold text-primary" : ""}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
