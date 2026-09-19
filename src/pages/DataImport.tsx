import { useState } from "react";
import { LiveModelBadge, ModelUpgradeButton } from "@/components/agentModels";

import { useModulePermissions } from "@/hooks/useModulePermissions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  FileText,
  Database,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Globe2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { logActivityDirect } from "@/hooks/useActivityLogger";
import { useNotifications } from "@/contexts/NotificationsContext";

const DATA_TYPES = [
  {
    value: "suburb_directory",
    label: "Suburb Directory",
    table: "suburb_directory",
    requiresState: false,
  },
  {
    value: "schools",
    label: "Schools Directory",
    table: "schools_directory",
    requiresState: true,
  },
  {
    value: "abs_census",
    label: "ABS Census Data",
    table: "abs_census_cache",
    requiresState: true,
  },
  {
    value: "crime_stats",
    label: "Crime Statistics",
    table: "crime_statistics_cache",
    requiresState: true,
  },
  {
    value: "economic",
    label: "Economic Data (National)",
    table: "economic_data_cache",
    requiresState: false,
  },
  {
    value: "transport",
    label: "Transport Data",
    table: "transport_data_cache",
    requiresState: true,
  },
  {
    value: "risk",
    label: "Risk Assessment",
    table: "risk_assessment_cache",
    requiresState: true,
  },
  {
    value: "climate",
    label: "Climate Data",
    table: "climate_data_cache",
    requiresState: true,
  },
  {
    value: "median_rent",
    label: "Median Rent Cache",
    table: "median_rent_cache",
    requiresState: false,
  },
];

const AUSTRALIAN_STATES = [
  { value: "NSW", label: "New South Wales (NSW)" },
  { value: "VIC", label: "Victoria (VIC)" },
  { value: "QLD", label: "Queensland (QLD)" },
  { value: "SA", label: "South Australia (SA)" },
  { value: "WA", label: "Western Australia (WA)" },
  { value: "TAS", label: "Tasmania (TAS)" },
  { value: "NT", label: "Northern Territory (NT)" },
  { value: "ACT", label: "Australian Capital Territory (ACT)" },
];

export default function DataImport() {
  const { canEdit: canEditImport } = useModulePermissions("data_import");
  const [selectedType, setSelectedType] = useState<string>("");
  const [selectedState, setSelectedState] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();
  const { addNotification } = useNotifications();

  const selectedDataType = DATA_TYPES.find((t) => t.value === selectedType);
  const requiresState = selectedDataType?.requiresState ?? false;
  const uploadReady = Boolean(
    file && selectedType && (!requiresState || selectedState),
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (
        selectedFile.type !== "text/csv" &&
        !selectedFile.name.endsWith(".csv")
      ) {
        toast({
          title: "Invalid File Type",
          description: "Please upload a CSV file",
          variant: "destructive",
        });
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  };

  const parseCSV = (text: string): any[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim());
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || null;
      });
      return obj;
    });
  };

  const handleUpload = async () => {
    if (!file || !selectedType) {
      toast({
        title: "Missing Information",
        description: "Please select a data type and file",
        variant: "destructive",
      });
      return;
    }

    if (requiresState && !selectedState) {
      toast({
        title: "Missing State",
        description: "Please select a state for this data type",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const text = await file.text();
      const records = parseCSV(text);

      if (selectedType === "schools") {
        // Use the import-schools-data edge function
        const { data, error } = await invokeSecureFunction(
          "import-schools-data",
          {
            schools: records.map((r) => ({
              name: r.name || r.school_name,
              suburb: r.suburb,
              postcode: r.postcode,
              state: selectedState || r.state,
              school_type: r.school_type || r.type,
              school_level: r.school_level || r.level,
              icsea_score: r.icsea_score ? parseInt(r.icsea_score) : null,
              student_count: r.student_count ? parseInt(r.student_count) : null,
              latitude: r.latitude ? parseFloat(r.latitude) : null,
              longitude: r.longitude ? parseFloat(r.longitude) : null,
              address: r.address,
              website_url: r.website_url || r.website,
            })),
            overwrite: true,
          },
        );

        if (error) throw error;
        setResult(data);

        toast({
          title: "Upload Successful",
          description: `Imported ${data.summary.imported} schools, updated ${data.summary.updated}, skipped ${data.summary.skipped}`,
        });

        addNotification({
          type: "data_import_complete",
          title: "Schools Data Import Complete",
          message: `Imported ${data.summary.imported} schools for ${selectedState}`,
        });
      } else {
        // Direct database insert for cache tables
        const dataType = DATA_TYPES.find((t) => t.value === selectedType);
        if (!dataType) throw new Error("Invalid data type");

        // Transform records based on table schema
        const transformedRecords = records.map((r) => {
          const base: any = {
            fetched_at: new Date().toISOString(),
            expires_at: new Date(
              Date.now() + 90 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            data_quality: "imported",
          };

          switch (selectedType) {
            case "suburb_directory":
              return {
                suburb: r.suburb?.trim(),
                postcode: r.postcode?.trim(),
                state: r.state?.toUpperCase()?.trim(),
              };
            case "median_rent":
              return {
                ...base,
                suburb: r.suburb?.toLowerCase()?.trim(),
                postcode: r.postcode?.trim(),
                state: r.state?.toUpperCase()?.trim(),
                property_type:
                  r.property_type?.toLowerCase()?.trim() || "house",
                bedrooms: r.bedrooms ? parseInt(r.bedrooms) : 3,
                median_weekly_rent: r.median_weekly_rent
                  ? parseFloat(r.median_weekly_rent)
                  : null,
                vacancy_rate: r.vacancy_rate
                  ? parseFloat(r.vacancy_rate)
                  : null,
                stock_on_market: r.stock_on_market
                  ? parseInt(r.stock_on_market)
                  : null,
                source_url: r.source_url || null,
              };
            case "abs_census":
              return {
                ...base,
                postcode: r.postcode,
                state: selectedState || r.state?.toUpperCase(),
                dataset: r.dataset,
                data: JSON.parse(r.data || "{}"),
              };
            case "crime_stats":
              return {
                ...base,
                suburb: r.suburb?.toLowerCase(),
                postcode: r.postcode,
                state: selectedState || r.state?.toUpperCase(),
                data: JSON.parse(r.data || "{}"),
              };
            case "economic":
              return {
                ...base,
                data_type: r.data_type,
                data: JSON.parse(r.data || "{}"),
              };
            case "transport":
              return {
                ...base,
                latitude: parseFloat(r.latitude),
                longitude: parseFloat(r.longitude),
                state: selectedState || r.state?.toUpperCase(),
                suburb: r.suburb?.toLowerCase(),
                data: JSON.parse(r.data || "{}"),
              };
            case "risk":
              return {
                ...base,
                suburb: r.suburb?.toLowerCase(),
                postcode: r.postcode,
                state: selectedState || r.state?.toUpperCase(),
                latitude: r.latitude ? parseFloat(r.latitude) : null,
                longitude: r.longitude ? parseFloat(r.longitude) : null,
                flood_risk: JSON.parse(r.flood_risk || "{}"),
                bushfire_risk: JSON.parse(r.bushfire_risk || "{}"),
              };
            case "climate":
              return {
                ...base,
                suburb: r.suburb?.toLowerCase(),
                postcode: r.postcode,
                state: selectedState || r.state?.toUpperCase(),
                climate_zone: r.climate_zone,
                temperature_data: JSON.parse(r.temperature_data || "{}"),
                rainfall_data: JSON.parse(r.rainfall_data || "{}"),
                humidity_data: JSON.parse(r.humidity_data || "{}"),
                extreme_weather: JSON.parse(r.extreme_weather || "{}"),
                projections: JSON.parse(r.projections || "{}"),
              };
            default:
              return r;
          }
        });

        const { data, error } = await invokeSecureFunction(
          "manage-data-import",
          {
            operation: "insert",
            table: dataType.table as any,
            data: transformedRecords,
          },
        );

        if (error) throw new Error(error.message);

        setResult({
          success: true,
          summary: {
            total: records.length,
            imported: data?.summary?.imported || records.length,
            table: dataType.table,
          },
        });

        toast({
          title: "Upload Successful",
          description: `Imported ${records.length} records into ${dataType.label}`,
        });

        addNotification({
          type: "data_import_complete",
          title: `${dataType.label} Import Complete`,
          message: `Successfully imported ${records.length} records`,
        });

        // Log data import
        logActivityDirect({
          actionType: "data_imported",
          entityType: "data_import",
          entityName: dataType.label,
          metadata: {
            action: "import",
            table: dataType.table,
            records_count: records.length,
            state: selectedState || undefined,
          },
        });
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setResult({
        success: false,
        error: error.message,
      });
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const [importingSuburbs, setImportingSuburbs] = useState(false);

  const handleImportSuburbDirectory = async () => {
    setImportingSuburbs(true);
    try {
      const { data, error } = await invokeSecureFunction(
        "import-suburb-directory",
        {
          body: {},
        },
      );

      if (error) throw error;

      if (data?.success) {
        toast({
          title: "Suburb Directory Imported",
          description: `Imported ${data.summary.inserted} suburbs from ${data.summary.source}`,
        });

        addNotification({
          type: "data_import_complete",
          title: "Suburb Directory Import Complete",
          message: `Imported ${data.summary.inserted} suburbs`,
        });
      } else {
        throw new Error(data?.error || "Import failed");
      }
    } catch (error: any) {
      console.error("Suburb import error:", error);
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setImportingSuburbs(false);
    }
  };

  return (
    <DashboardThemeFrame
      variant="page"
      className="min-h-0 overflow-x-hidden space-y-5 rounded-[1.75rem] border border-border/45 bg-[linear-gradient(180deg,hsl(var(--background)/0.72),hsl(var(--muted)/0.18))] px-2 py-3 shadow-[0_18px_60px_hsl(var(--foreground)/0.06)] dark:border-white/10 dark:bg-[linear-gradient(180deg,hsl(var(--background)/0.42),hsl(var(--muted)/0.08))] dark:shadow-black/25 sm:space-y-6 sm:px-4 sm:py-4 lg:px-5"
    >
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="border-primary/20 p-5 shadow-xl shadow-sm ring-1 ring-white/45 transition-shadow duration-300 hover:shadow-[0_18px_54px_hsl(var(--primary)/0.10)] dark:shadow-black/20 dark:ring-white/10 sm:p-7"
      >
        <div className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-8 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary shadow-sm">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Cache-table operations</span>
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Data Import
              </h1>
              <p className="max-w-3xl pt-1 text-sm leading-6 text-muted-foreground sm:text-base">
                Upload CSV files to populate cache tables and directories
              </p>
              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                <LiveModelBadge agentKey="pdf_property_extraction" size="sm" showSlot />
                <LiveModelBadge agentKey="pdf_formara_extraction" size="sm" showSlot />
                <ModelUpgradeButton agentKey="pdf_property_extraction" />
              </div>
            </div>

          </div>
          <div className="grid min-w-0 gap-2 rounded-2xl border border-border/60 bg-background/55 p-3 text-xs text-muted-foreground shadow-sm backdrop-blur sm:grid-cols-3 lg:min-w-[28rem]">
            <div className="min-w-0 rounded-xl bg-card/70 p-3">
              <p className="font-semibold text-foreground">01 Source</p>
              <p className="mt-1 break-words">
                Trusted external directory or local CSV.
              </p>
            </div>
            <div className="min-w-0 rounded-xl bg-card/70 p-3">
              <p className="font-semibold text-foreground">02 Validate</p>
              <p className="mt-1 break-words">
                Match the required data type format.
              </p>
            </div>
            <div className="min-w-0 rounded-xl bg-card/70 p-3">
              <p className="font-semibold text-foreground">03 Populate</p>
              <p className="mt-1 break-words">
                Write to the configured cache table.
              </p>
            </div>
          </div>
        </div>
      </DashboardThemeFrame>

      {/* Quick Import Section */}
      <Card className="group relative w-full min-w-0 overflow-hidden rounded-[1.5rem] border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--primary)/0.08))] shadow-[0_18px_48px_hsl(var(--foreground)/0.08)] backdrop-blur dark:border-primary/20 dark:bg-[linear-gradient(135deg,hsl(var(--card)/0.82),hsl(var(--primary)/0.10))] dark:shadow-black/30 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_22px_60px_hsl(var(--primary)/0.12)]">
        <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute left-8 top-0 h-px w-2/3 bg-gradient-to-r from-primary/45 via-primary/20 to-transparent" />
        <CardHeader className="relative border-b border-primary/15 bg-background/35">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <Database className="h-5 w-5" />
              </span>
              <span className="min-w-0 break-words">
                Quick Import from External Sources
              </span>
            </CardTitle>
            <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full border border-success/25 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Trusted external source</span>
            </div>
          </div>
          <CardDescription className="break-words">
            Import data directly from trusted external sources
          </CardDescription>
        </CardHeader>
        <CardContent className="relative p-4 sm:p-6">
          <div className="grid min-w-0 max-w-full gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0 rounded-2xl border border-dashed border-primary/25 bg-background/55 p-4 shadow-inner">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
                  <Globe2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    Australian suburb directory cache
                  </p>
                  <p className="min-w-0 text-xs leading-5 text-muted-foreground">
                    ~18,500 suburbs from matthewproctor.com (community-sourced
                    postcode database)
                  </p>
                  <div className="flex min-w-0 max-w-full flex-wrap gap-2 text-[11px] font-medium text-muted-foreground">
                    <span className="max-w-full break-words rounded-full border border-border/60 bg-card/80 px-2.5 py-1">
                      Source import
                    </span>
                    <span className="max-w-full break-words rounded-full border border-border/60 bg-card/80 px-2.5 py-1">
                      Cache-table population
                    </span>
                    <span className="max-w-full break-words rounded-full border border-border/60 bg-card/80 px-2.5 py-1">
                      No local file required
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <Button
              onClick={handleImportSuburbDirectory}
              aria-label="Import Australian Suburb Directory"
              disabled={importingSuburbs}
              aria-busy={importingSuburbs}
              variant="outline"
              className="min-w-0 max-w-full shrink-0 rounded-full border-primary/35 ring-1 ring-primary/10 bg-primary px-5 font-semibold text-primary-foreground shadow-[0_12px_30px_hsl(var(--primary)/0.20)] transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/90 hover:text-primary-foreground hover:shadow-[0_18px_42px_hsl(var(--primary)/0.28)] active:translate-y-0 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:translate-y-0 disabled:cursor-wait disabled:border-primary/25 disabled:bg-primary/55 disabled:text-primary-foreground/80 disabled:shadow-none lg:min-w-[18rem]"
            >
              {importingSuburbs ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                  <span className="truncate">Importing Suburbs...</span>
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">
                    Import Australian Suburb Directory
                  </span>
                </>
              )}
            </Button>
          </div>
          {importingSuburbs && (
            <div
              className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-3 text-sm text-primary"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <p className="min-w-0 break-words">
                Importing suburbs from the trusted external source. This action
                will complete only after the existing import workflow confirms
                the result.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full min-w-0 overflow-hidden rounded-[1.5rem] border-border/60 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--muted)/0.24))] shadow-[0_14px_40px_hsl(var(--foreground)/0.06)] backdrop-blur dark:border-white/10 dark:bg-background/55 dark:shadow-black/25 transition-all duration-300 hover:border-primary/20 hover:shadow-[0_18px_52px_hsl(var(--foreground)/0.08)]">
        <CardHeader className="border-b border-border/50 bg-background/35">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Upload className="h-5 w-5" />
              </span>
              <span className="min-w-0 break-words">Upload CSV Data</span>
            </CardTitle>
            <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full border border-border/60 bg-card/80 px-3 py-1 text-xs font-semibold text-muted-foreground">
              <Upload className="h-5 w-5" />
              <span className="truncate">Manual CSV workflow</span>
            </div>
          </div>
          <CardDescription className="break-words">
            Select a data type and upload a properly formatted CSV file
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 rounded-2xl border border-border/50 bg-background/45 p-3 sm:grid-cols-2 sm:p-4">
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <Label htmlFor="dataType">Data Type</Label>
              </div>
              <Select
                value={selectedType}
                onValueChange={(value) => {
                  setSelectedType(value);
                  setSelectedState("");
                }}
              >
                <SelectTrigger
                  id="dataType"
                  className="min-w-0 max-w-full rounded-xl border-border/70 bg-card/90 shadow-sm transition-all duration-200 hover:border-primary/35 focus:ring-2 focus:ring-primary/40"
                >
                  <SelectValue placeholder="Select data type..." />
                </SelectTrigger>
                <SelectContent className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-border/70 bg-popover shadow-xl">
                  {DATA_TYPES.map((type) => (
                    <SelectItem
                      key={type.value}
                      value={type.value}
                      className="min-w-0 rounded-lg transition-colors focus:bg-primary/10 focus:text-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-foreground"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Database className="h-4 w-4 shrink-0" />
                        <span className="truncate">{type.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {requiresState && (
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    2
                  </span>
                  <Label htmlFor="state">
                    State/Territory <span className="text-destructive">*</span>
                  </Label>
                </div>
                <Select value={selectedState} onValueChange={setSelectedState}>
                  <SelectTrigger
                    id="state"
                    className="min-w-0 max-w-full rounded-xl border-border/70 bg-card/90 shadow-sm transition-all duration-200 hover:border-primary/35 focus:ring-2 focus:ring-primary/40"
                  >
                    <SelectValue placeholder="Select state..." />
                  </SelectTrigger>
                  <SelectContent className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-border/70 bg-popover shadow-xl">
                    {AUSTRALIAN_STATES.map((state) => (
                      <SelectItem
                        key={state.value}
                        value={state.value}
                        className="rounded-lg transition-colors focus:bg-primary/10 focus:text-foreground data-[state=checked]:bg-primary/10 data-[state=checked]:text-foreground"
                      >
                        {state.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Data will be tagged for{" "}
                  {selectedState || "the selected state"}
                </p>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-2 rounded-2xl border border-border/50 bg-background/45 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {requiresState ? "3" : "2"}
              </span>
              <Label htmlFor="csvFile">CSV File</Label>
            </div>
            <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/20 p-4 transition-all duration-200 hover:border-primary/25 hover:bg-primary/5 focus-within:border-primary/45 focus-within:bg-primary/5 sm:flex-row sm:items-center sm:gap-4">
              <input
                id="csvFile"
                aria-label="CSV File"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="min-w-0 max-w-full w-full text-sm text-muted-foreground file:mr-4 file:rounded-full file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground file:shadow-sm hover:file:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              {file && (
                <div
                  className="flex min-w-0 items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm sm:max-w-[18rem]"
                  title={file.name}
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={handleUpload}
            aria-label="Upload Data"
            disabled={!uploadReady || uploading}
            aria-busy={uploading}
            className={`min-w-0 max-w-full w-full rounded-full py-6 font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:translate-y-0 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none ${
              uploadReady
                ? "shadow-[0_12px_30px_hsl(var(--primary)/0.22)] hover:-translate-y-0.5 hover:shadow-[0_18px_42px_hsl(var(--primary)/0.28)]"
                : ""
            }`}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                <span className="truncate">Uploading...</span>
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate">Upload Data</span>
              </>
            )}
          </Button>
          {!uploadReady && !uploading && (
            <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-3 text-sm text-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 break-words">
                Upload Data becomes available after the required data type
                selection{requiresState ? ", state selection" : ""} and CSV file
                are provided.
              </p>
            </div>
          )}

          {result && (
            <Alert
              variant={result.success ? "default" : "destructive"}
              className={`min-w-0 overflow-hidden rounded-2xl ${
                result.success
                  ? "border-success/30 bg-success/10 text-foreground"
                  : "border-destructive/35 bg-destructive/10"
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertDescription className="min-w-0 break-words">
                {result.success ? (
                  <div className="space-y-2">
                    <p className="font-medium">
                      Upload completed successfully!
                    </p>
                    {result.summary && (
                      <div className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                        <div className="min-w-0 rounded-xl border border-success/20 bg-background/70 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Total records
                          </p>
                          <p className="mt-1 font-semibold tabular-nums text-foreground">
                            {result.summary.total}
                          </p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-success/20 bg-background/70 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Imported
                          </p>
                          <p className="mt-1 font-semibold tabular-nums text-success">
                            {result.summary.imported}
                          </p>
                        </div>
                        {result.summary.updated !== undefined && (
                          <div className="min-w-0 rounded-xl border border-primary/20 bg-background/70 p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Updated
                            </p>
                            <p className="mt-1 font-semibold tabular-nums text-foreground">
                              {result.summary.updated}
                            </p>
                          </div>
                        )}
                        {result.summary.skipped !== undefined && (
                          <div className="min-w-0 rounded-xl border border-warning/25 bg-warning/10 p-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-warning">
                              Skipped
                            </p>
                            <p className="mt-1 font-semibold tabular-nums text-foreground">
                              {result.summary.skipped}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="min-w-0">
                    <p className="font-medium">Upload failed</p>
                    <div className="mt-2 min-w-0 rounded-xl border border-destructive/25 bg-background/70 p-3">
                      <p className="break-words text-sm">{result.error}</p>
                    </div>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="w-full min-w-0 overflow-hidden rounded-[1.5rem] border-border/60 bg-card/80 shadow-[0_14px_40px_hsl(var(--foreground)/0.06)] backdrop-blur dark:border-white/10 dark:bg-background/55 dark:shadow-black/25">
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
                <AlertCircle className="h-5 w-5" />
              </span>
              <span className="min-w-0 break-words">
                CSV Format Requirements
              </span>
            </CardTitle>
            <div className="inline-flex max-w-full items-center gap-2 self-start rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Import specification guide</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 text-sm md:grid-cols-2">
            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  📍 Suburb Directory:
                </h4>
                <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  All Australian
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                All Australian suburbs - no state selection needed
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                suburb,postcode,state
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  💵 Median Rent Cache:
                </h4>
                <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  No state selection
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                Pre-cached rent data - no state selection needed
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                suburb,postcode,state,property_type,bedrooms,median_weekly_rent,vacancy_rate,stock_on_market,source_url
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  🏫 Schools Directory:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                name,suburb,postcode,state,school_type,school_level,icsea_score,student_count,latitude,longitude,address,website_url
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  📊 ABS Census Cache:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                postcode,state,dataset,data
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  🚨 Crime Statistics Cache:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                suburb,postcode,state,data
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  🚇 Transport Data Cache:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                latitude,longitude,state,suburb,data
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  ⚠️ Risk Assessment Cache:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                suburb,postcode,state,latitude,longitude,flood_risk,bushfire_risk
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  🌡️ Climate Data Cache:
                </h4>
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                  State required
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                State-specific (select state above)
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                suburb,postcode,state,climate_zone,temperature_data,rainfall_data,humidity_data,extreme_weather,projections
              </code>
            </div>

            <div className="group min-w-0 max-w-full rounded-2xl border border-border/50 bg-background/45 p-4 shadow-sm transition-all duration-200 hover:border-primary/25 hover:bg-card/70">
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="font-medium break-words">
                  💰 Economic Data (National):
                </h4>
                <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                  National
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">
                No state selection needed
              </p>
              <code className="block min-w-0 max-w-full overflow-x-auto rounded-xl border border-border/50 bg-muted/80 p-3 font-mono text-xs leading-6 text-foreground shadow-inner outline-none transition-colors duration-200 whitespace-pre focus-visible:ring-2 focus-visible:ring-primary/40">
                data_type,data
              </code>
            </div>
            <Alert className="min-w-0 rounded-2xl border-warning/25 bg-warning/10 transition-colors duration-200 md:col-span-2">
              <div className="flex min-w-0 gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <AlertDescription className="min-w-0 break-words">
                  Refer to the documentation for detailed CSV format
                  specifications for each data type.
                </AlertDescription>
              </div>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </DashboardThemeFrame>
  );
}
