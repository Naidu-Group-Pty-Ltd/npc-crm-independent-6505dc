import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { 
  Upload, 
  Plus, 
  Trash2, 
  Download, 
  RefreshCw,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle,
  Loader2,
  Database
} from 'lucide-react';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { useToast } from '@/hooks/use-toast';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import {
  DepreciationComp,
  PurchaseDateCategory,
  PropertyType,
  FinishStandard,
  NearestCity,
  CITY_LABELS,
  PROPERTY_TYPE_LABELS,
  FINISH_STANDARD_LABELS,
  PURCHASE_CATEGORY_LABELS,
} from '@/types/depreciation';

export function DepreciationCompsAdmin() {
  const { toast } = useToast();
  // Use the JWT-bearing client so depreciation_comps can drop its anon/public
  // read+write grants (RLS-W2); this admin surface is staff-only.
  const { supabase } = useAuthenticatedSupabase();
  const [comps, setComps] = useState<DepreciationComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [csvFullData, setCsvFullData] = useState<string[][]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  
  // Add form state
  const [newComp, setNewComp] = useState<Partial<DepreciationComp>>({
    purchase_date_category: 'post_budget_brand_new',
    property_type: 'house',
    finish_standard: 'medium',
    nearest_city: 'sydney_nsw',
    renovated: false,
    fully_furnished: false,
  });
  const [bulkYearsInput, setBulkYearsInput] = useState('');
  
  // Fetch comps
  const fetchComps = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('depreciation_comps')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      setComps(data as DepreciationComp[] || []);
    } catch (error) {
      console.error('Error fetching comps:', error);
      toast({
        title: "Failed to load data",
        description: "Could not fetch depreciation comparables.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  
  useEffect(() => {
    fetchComps();
  }, [fetchComps]);
  
  // CSV helpers (handles quoted commas, BOMs, and messy column names)
  const normalizeCsvHeader = (header: string) => {
    const h = (header ?? '')
      .toString()
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase();

    return h
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  const parseCsvText = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    const pushCell = () => {
      row.push(cell.trim());
      cell = '';
    };

    const pushRow = () => {
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    };

    const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];

      if (ch === '"') {
        // Escaped quote within a quoted cell
        if (inQuotes && s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === ',') {
        pushCell();
        continue;
      }

      if (!inQuotes && ch === '\n') {
        pushCell();
        pushRow();
        continue;
      }

      cell += ch;
    }

    // flush last row
    pushCell();
    pushRow();

    return rows;
  };

  const parseBoolean = (value: string): boolean => {
    const v = (value ?? '').toString().replace(/^\uFEFF/, '').trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'y';
  };

  const formatImportError = (err: any): string => {
    if (!err) return 'Could not import CSV data.';
    if (typeof err === 'string') return err;

    const message = typeof err?.message === 'string' && err.message.trim().length > 0
      ? err.message
      : 'Could not import CSV data.';

    const extra: string[] = [];
    if (typeof err?.details === 'string' && err.details.trim().length > 0) extra.push(`Details: ${err.details}`);
    if (typeof err?.hint === 'string' && err.hint.trim().length > 0) extra.push(`Hint: ${err.hint}`);
    if (typeof err?.code === 'string' && err.code.trim().length > 0) extra.push(`Code: ${err.code}`);

    return extra.length ? `${message} | ${extra.join(' | ')}` : message;
  };

  // Handle CSV file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvError(null);
    setCsvPreview([]);
    setCsvFullData([]);

    try {
      const text = await file.text();
      const lines = parseCsvText(text);

      if (lines.length < 2) {
        setCsvError('CSV must have at least a header row and one data row');
        return;
      }

      setCsvFullData(lines); // Store ALL parsed lines
      setCsvPreview(lines.slice(0, 6)); // Show first 5 rows + header for preview
    } catch (error) {
      console.error('Error parsing CSV:', error);
      setCsvError('Failed to parse CSV file');
    }
  };
  
  // Normalize enum values to match database expectations (lowercase with underscores)
  const normalizeEnumValue = (value: string, fieldName: string): string => {
    const cleaned = (value ?? '').toString().replace(/^\uFEFF/, '').trim();
    if (!cleaned) return cleaned;

    // Normalize: lowercase and replace non-alphanumerics with underscores
    const normalized = cleaned
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    // Valid enum values for each field
    const validValues: Record<string, string[]> = {
      nearest_city: ['sydney_nsw', 'melbourne_vic', 'perth_wa', 'brisbane_qld', 'adelaide_sa', 'cairns_qld', 'canberra_act', 'darwin_nt', 'hobart_tas'],
      property_type: ['house', 'townhouse', 'unit', 'highrise', 'commercial', 'industrial'],
      finish_standard: ['low', 'medium', 'high'],
      purchase_date_category: ['pre_budget', 'post_budget_second_hand', 'post_budget_brand_new'],
    };

    if (validValues[fieldName]) {
      const match = validValues[fieldName].find((v) => v === normalized);
      if (match) return match;

      const compact = normalized.replace(/_/g, '');
      const partialMatch = validValues[fieldName].find((v) => {
        const vCompact = v.replace(/_/g, '');
        return vCompact === compact || compact.includes(vCompact) || vCompact.includes(compact);
      });
      if (partialMatch) return partialMatch;
    }

    return normalized;
  };

  // Import CSV data
  const handleImportCsv = async () => {
    if (csvFullData.length < 2) return;

    setUploading(true);
    try {
      const headers = csvFullData[0].map(normalizeCsvHeader);
      const rows = csvFullData.slice(1); // Use FULL data, not preview

      const records: Partial<DepreciationComp>[] = [];
      const enumFields = new Set(['nearest_city', 'property_type', 'finish_standard', 'purchase_date_category']);
      // Fields to exclude from import - these are auto-generated or use UUID format
      const excludeFields = new Set(['id', 'source_schedule_id', 'created_at', 'updated_at', 'created_by']);

      for (const row of rows) {
        if (row.length < headers.length) continue;

        const record: Record<string, any> = {};
        headers.forEach((header, i) => {
          if (!header) return;
          
          // Skip fields that should not be imported (auto-generated UUIDs, timestamps, etc.)
          if (excludeFields.has(header)) return;

          const raw = row[i] ?? '';
          const value = (typeof raw === 'string' ? raw : String(raw)).replace(/^\uFEFF/, '').trim();

          // Parse numeric fields (strip thousand separators)
          if (
            header.includes('price') ||
            header.includes('year') ||
            header.startsWith('dv_') ||
            header.startsWith('pc_')
          ) {
            record[header] = parseFloat(removeCommas(value)) || 0;
          } else if (header === 'renovated' || header === 'fully_furnished') {
            record[header] = parseBoolean(value);
          } else if (enumFields.has(header)) {
            record[header] = normalizeEnumValue(value, header);
          } else {
            record[header] = value;
          }
        });

        // Validate required fields
        if (
          record.purchase_price &&
          record.purchase_date_category &&
          record.build_year &&
          record.property_type &&
          record.finish_standard &&
          record.nearest_city
        ) {
          records.push(record as Partial<DepreciationComp>);
        }
      }

      if (records.length === 0) {
        throw new Error('No valid records found in CSV');
      }

      // Insert in batches of 500 to handle large datasets
      const batchSize = 500;
      let imported = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from('depreciation_comps').insert(batch as any);
        if (error) throw error;
        imported += batch.length;
      }

      toast({
        title: 'Import Successful',
        description: `Imported ${imported} depreciation comparables.`,
      });

      setCsvPreview([]);
      setCsvFullData([]);
      fetchComps();
    } catch (error: any) {
      console.error('Error importing CSV:', error);
      toast({
        title: 'Import Failed',
        description: formatImportError(error),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };
  
  // Parse bulk years input (tab or comma separated: DV values, then PC values)
  const parseBulkYears = (input: string) => {
    const values = input.split(/[\t,\n]+/).map(v => parseFloat(v.trim()) || 0);
    if (values.length >= 20) {
      return {
        dv_year1: values[0], dv_year2: values[1], dv_year3: values[2], dv_year4: values[3], dv_year5: values[4],
        dv_year6: values[5], dv_year7: values[6], dv_year8: values[7], dv_year9: values[8], dv_year10: values[9],
        pc_year1: values[10], pc_year2: values[11], pc_year3: values[12], pc_year4: values[13], pc_year5: values[14],
        pc_year6: values[15], pc_year7: values[16], pc_year8: values[17], pc_year9: values[18], pc_year10: values[19],
      };
    }
    return null;
  };
  
  // Add single comp
  const handleAddComp = async () => {
    try {
      // Parse bulk years if provided
      let yearData = {};
      if (bulkYearsInput) {
        const parsed = parseBulkYears(bulkYearsInput);
        if (parsed) {
          yearData = parsed;
        } else {
          toast({
            title: "Invalid Year Data",
            description: "Please provide 20 values: 10 DV years followed by 10 PC years.",
            variant: "destructive",
          });
          return;
        }
      }
      
      const record = {
        ...newComp,
        ...yearData,
      };
      
      if (!record.purchase_price || !record.build_year) {
        toast({
          title: "Missing Required Fields",
          description: "Purchase price and build year are required.",
          variant: "destructive",
        });
        return;
      }
      
      const { error } = await supabase
        .from('depreciation_comps')
        .insert([record] as any);
      
      if (error) throw error;
      
      toast({
        title: "Comp Added",
        description: "Depreciation comparable has been added.",
      });
      
      setShowAddModal(false);
      setNewComp({
        purchase_date_category: 'post_budget_brand_new',
        property_type: 'house',
        finish_standard: 'medium',
        nearest_city: 'sydney_nsw',
        renovated: false,
        fully_furnished: false,
      });
      setBulkYearsInput('');
      fetchComps();
    } catch (error) {
      console.error('Error adding comp:', error);
      toast({
        title: "Failed to Add",
        description: "Could not add depreciation comparable.",
        variant: "destructive",
      });
    }
  };
  
  // Delete comp
  const handleDeleteComp = async (id: string) => {
    if (!confirm('Are you sure you want to delete this comparable?')) return;
    
    try {
      const { error } = await supabase
        .from('depreciation_comps')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      toast({
        title: "Deleted",
        description: "Depreciation comparable has been removed.",
      });
      
      fetchComps();
    } catch (error) {
      console.error('Error deleting comp:', error);
      toast({
        title: "Delete Failed",
        description: "Could not delete depreciation comparable.",
        variant: "destructive",
      });
    }
  };
  
  // Export template CSV
  const handleExportTemplate = () => {
    const headers = [
      'purchase_price', 'purchase_date_category', 'build_year', 'property_type', 
      'finish_standard', 'nearest_city', 'renovated', 'fully_furnished',
      'dv_year1', 'dv_year2', 'dv_year3', 'dv_year4', 'dv_year5',
      'dv_year6', 'dv_year7', 'dv_year8', 'dv_year9', 'dv_year10',
      'pc_year1', 'pc_year2', 'pc_year3', 'pc_year4', 'pc_year5',
      'pc_year6', 'pc_year7', 'pc_year8', 'pc_year9', 'pc_year10',
      'notes'
    ];
    
    const exampleRow = [
      '750000', 'post_budget_brand_new', '2022', 'house',
      'medium', 'sydney_nsw', 'false', 'false',
      '15000', '13000', '11000', '10000', '9000', '8000', '7000', '6500', '6000', '5500',
      '12000', '12000', '12000', '12000', '12000', '12000', '12000', '12000', '12000', '12000',
      'Example property'
    ];
    
    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'depreciation_comps_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      aria-labelledby="depreciation-comps-title"
      className="min-h-[calc(100dvh-5rem)] space-y-5 px-1 pb-6 sm:space-y-6 sm:px-0"
    >
      <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-border/70 bg-card/90 shadow-sm ring-1 ring-border/40 dark:border-white/10 dark:bg-background/80 dark:ring-white/10">
        <CardHeader className="relative overflow-hidden border-b border-border/60 bg-card/70 px-4 py-5 dark:border-white/10 sm:px-6 lg:px-7">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,hsl(var(--primary)/0.10),transparent_36%,hsl(var(--background)/0.22))]" />
          <div className="relative flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-inner shadow-primary/10">
                <Database className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <CardTitle id="depreciation-comps-title" className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Depreciation Comparables Database
                </CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Manage the comparable properties dataset used for depreciation estimates.
                </CardDescription>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="w-fit shrink-0 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary shadow-sm"
            >
              {comps.length} records
            </Badge>
          </div>
        </CardHeader>
      
        <CardContent className="min-w-0 space-y-6 p-4 sm:p-6 lg:p-7">
          <Tabs defaultValue="list" className="min-w-0 space-y-5" aria-label="Depreciation comparables workspace">
            <DashboardThemeFrame variant="toolbar" className="overflow-x-auto border-primary/15 bg-background/65 p-1.5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:bg-background/40 dark:shadow-black/25">
              <TabsList className="grid min-w-[18rem] flex-1 grid-cols-2 rounded-xl bg-muted/45 p-1 sm:min-w-0">
                <TabsTrigger
                  value="list"
                  className="rounded-lg text-sm font-semibold text-muted-foreground transition-all duration-200 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_28px_hsl(var(--primary)/0.25)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                >
                  View Data
                </TabsTrigger>
                <TabsTrigger
                  value="import"
                  className="rounded-lg text-sm font-semibold text-muted-foreground transition-all duration-200 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_28px_hsl(var(--primary)/0.25)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
                >
                  Import Data
                </TabsTrigger>
              </TabsList>
            </DashboardThemeFrame>
          
          <TabsContent value="list" className="min-w-0 space-y-4">
            {/* Actions */}
            <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-card/55 p-3 shadow-sm dark:border-white/10 dark:bg-background/35 sm:flex-row sm:items-center sm:justify-between">
              <Button
                onClick={() => setShowAddModal(true)}
                aria-label="Add depreciation comparable"
                className="w-full bg-primary font-semibold text-primary-foreground shadow-[0_12px_30px_hsl(var(--primary)/0.22)] transition-all duration-200 hover:bg-primary/90 hover:shadow-[0_16px_38px_hsl(var(--primary)/0.28)] focus-visible:ring-primary motion-reduce:transition-none sm:w-auto"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Comp
              </Button>
              <Button
                variant="outline"
                onClick={fetchComps}
                disabled={loading}
                aria-label="Refresh depreciation comparables"
                className="w-full border-primary/20 bg-background/70 font-medium text-foreground transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:w-auto"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            
            {/* Comps Table */}
            <DashboardThemeFrame variant="card" className="min-w-0 overflow-hidden">
              <ScrollArea className="h-[420px]">
                <div className="w-full overflow-x-auto [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                  <Table className="min-w-[980px]">
                    <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur dark:bg-background/90">
                      <TableRow className="border-border/70 hover:bg-transparent dark:border-white/10">
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">Price</TableHead>
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">Year</TableHead>
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">Type</TableHead>
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">Finish</TableHead>
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">City</TableHead>
                        <TableHead className="whitespace-nowrap font-semibold text-foreground">Category</TableHead>
                        <TableHead className="whitespace-nowrap text-right font-semibold text-foreground">DV Total</TableHead>
                        <TableHead className="whitespace-nowrap text-right font-semibold text-foreground">PC Total</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="py-12 text-center">
                            <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-primary/20 bg-background/65 p-6 text-muted-foreground shadow-inner dark:bg-background/35" role="status" aria-live="polite">
                              <Loader2 className="h-6 w-6 animate-spin text-primary" />
                              <p className="text-sm font-medium">Loading comparables...</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : comps.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="py-14 text-center text-muted-foreground">
                            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dashed border-primary/25 bg-background/65 p-6 shadow-inner dark:bg-background/35">
                              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                                <Database className="h-5 w-5" />
                              </div>
                              <p className="text-sm font-medium leading-6 text-muted-foreground">
                                No comparables found. Add some data to enable the calculator.
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : comps.map(comp => {
                        const dvTotal = comp.dv_year1 + comp.dv_year2 + comp.dv_year3 + comp.dv_year4 + comp.dv_year5 +
                                       comp.dv_year6 + comp.dv_year7 + comp.dv_year8 + comp.dv_year9 + comp.dv_year10;
                        const pcTotal = comp.pc_year1 + comp.pc_year2 + comp.pc_year3 + comp.pc_year4 + comp.pc_year5 +
                                       comp.pc_year6 + comp.pc_year7 + comp.pc_year8 + comp.pc_year9 + comp.pc_year10;
                        
                        return (
                          <TableRow key={comp.id} className="border-border/60 transition-colors hover:bg-primary/5 dark:border-white/10">
                            <TableCell className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                              ${formatNumberWithCommas(comp.purchase_price.toString())}
                            </TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {comp.build_year}
                            </TableCell>
                            <TableCell className="max-w-[9rem] truncate text-xs text-foreground" title={PROPERTY_TYPE_LABELS[comp.property_type]}>
                              <span className="inline-flex max-w-full items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-medium text-primary">
                                <span className="truncate">{PROPERTY_TYPE_LABELS[comp.property_type]}</span>
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[7rem] truncate text-muted-foreground" title={comp.finish_standard}>
                              <span className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                <span className="truncate">{comp.finish_standard}</span>
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[11rem] truncate text-xs text-foreground" title={CITY_LABELS[comp.nearest_city]}>
                              {CITY_LABELS[comp.nearest_city]}
                            </TableCell>
                            <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground" title={PURCHASE_CATEGORY_LABELS[comp.purchase_date_category]}>
                              <span className="inline-flex max-w-full items-center rounded-full border border-brand-400/25 bg-brand-500/10 px-2.5 py-1 font-medium text-brand-700 dark:text-brand-200">
                                <span className="truncate">{PURCHASE_CATEGORY_LABELS[comp.purchase_date_category]}</span>
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-foreground">
                              <span className="text-primary">${formatNumberWithCommas(dvTotal.toString())}</span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-foreground">
                              <span className="text-success dark:text-success">${formatNumberWithCommas(pcTotal.toString())}</span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => handleDeleteComp(comp.id)}
                                aria-label="Delete comparable"
                                className="hover:bg-destructive/10 focus-visible:ring-destructive"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </DashboardThemeFrame>
          </TabsContent>
          
          <TabsContent value="import" className="min-w-0 space-y-4">
            {/* CSV Import */}
            <div className="min-w-0 space-y-4">
              <DashboardThemeFrame variant="toolbar" className="min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">CSV import workspace</p>
                  <p className="text-xs leading-5 text-muted-foreground">Use the template before importing comparable records.</p>
                </div>
                <Button
                  variant="outline"
                  onClick={handleExportTemplate}
                  aria-label="Download depreciation comps CSV template"
                  className="w-full border-primary/20 bg-background/70 font-medium text-foreground transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-primary motion-reduce:transition-none sm:w-auto"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
              </DashboardThemeFrame>
              
              <DashboardThemeFrame variant="sectionAccent" className="group border-dashed p-1 transition-all duration-200 hover:border-primary/50 motion-reduce:transition-none">
                <Label
                  htmlFor="csv-upload"
                  className="flex min-h-[14rem] cursor-pointer flex-col items-center justify-center rounded-[1.35rem] border border-white/35 bg-background/55 px-4 py-8 text-center transition-colors duration-200 group-hover:bg-primary/5 dark:border-white/10 dark:bg-background/35 motion-reduce:transition-none sm:px-6"
                >
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-inner shadow-primary/10">
                    <FileSpreadsheet className="h-8 w-8" />
                  </span>
                  <span id="csv-upload-help" className="max-w-xl text-base font-semibold leading-7">
                    <span className="text-primary underline-offset-4 group-hover:underline">Click to upload</span>
                    <span className="text-muted-foreground"> or drag and drop a CSV file</span>
                  </span>
                </Label>
                <Input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  aria-describedby="csv-upload-help"
                  className="sr-only"
                />
              </DashboardThemeFrame>
              
              {csvError && (
                <Alert variant="destructive" className="overflow-hidden rounded-2xl border-destructive/30 bg-destructive/10 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="break-words leading-6">{csvError}</AlertDescription>
                </Alert>
              )}
              
              {csvPreview.length > 0 && (
                <DashboardThemeFrame variant="card" className="space-y-4 p-4">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h4 className="font-medium text-foreground">Preview (first 5 rows):</h4>
                    <Badge variant="secondary" className="w-fit shrink-0 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                      {csvFullData.length - 1} total rows found
                    </Badge>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 dark:border-white/10">
                    <ScrollArea className="h-[220px]">
                      <div className="w-full overflow-x-auto [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
                        <Table className="min-w-[760px]">
                          <TableHeader className="sticky top-0 z-10 bg-muted/70 backdrop-blur dark:bg-background/90">
                            <TableRow className="hover:bg-transparent">
                              {csvPreview[0].map((header, i) => (
                                <TableHead key={i} className="max-w-[12rem] truncate whitespace-nowrap text-xs font-semibold text-foreground" title={header}>{header}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {csvPreview.slice(1).map((row, i) => (
                              <TableRow key={i} className="border-border/60 hover:bg-primary/5 dark:border-white/10">
                                {row.map((cell, j) => (
                                  <TableCell key={j} className="max-w-[12rem] truncate text-xs text-muted-foreground" title={cell}>{cell}</TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </ScrollArea>
                  </div>
                  
                  <Button
                    onClick={handleImportCsv}
                    disabled={uploading}
                    aria-label={`Import all ${csvFullData.length - 1} depreciation comparable records`}
                    className="w-full bg-primary font-semibold text-primary-foreground shadow-[0_12px_30px_hsl(var(--primary)/0.22)] hover:bg-primary/90 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Import All {csvFullData.length - 1} Records
                      </>
                    )}
                  </Button>
                </DashboardThemeFrame>
              )}
            </div>
          </TabsContent>
        </Tabs>
        
        {/* Add Comp Modal */}
        <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
          <DialogContent className="flex h-[90dvh] max-h-[90dvh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-primary/20 bg-card/95 p-0 shadow-[0_28px_90px_rgba(15,23,42,0.22)] sm:h-auto sm:max-h-[min(88vh,760px)] dark:border-white/10 dark:bg-background/95 dark:shadow-black/45">
            <DialogHeader className="shrink-0 border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--card)/0.92)_42%,hsl(var(--background)/0.9))] px-5 py-5 dark:border-white/10 sm:px-6">
              <DialogTitle className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight text-foreground">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <Plus className="h-5 w-5" />
                </span>
                <span className="min-w-0 truncate">Add Depreciation Comparable</span>
              </DialogTitle>
              <DialogDescription className="pl-0 text-sm leading-6 text-muted-foreground sm:pl-[3.25rem]">
                Add a new comparable property to the database
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:px-6">

              <div className="grid gap-5">
                <section className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
                  <div className="mb-4 min-w-0">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Property identity</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-purchase-price">Purchase Price</Label>
                      <Input
                        id="depreciation-comp-purchase-price"
                        type="number"
                        value={newComp.purchase_price || ''}
                        onChange={(e) => setNewComp(prev => ({ ...prev, purchase_price: parseFloat(e.target.value) || 0 }))}
                        placeholder="750000"
                        className="bg-background/80 focus-visible:ring-primary"
                      />
                    </div>
                    
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-build-year">Build Year</Label>
                      <Input
                        id="depreciation-comp-build-year"
                        type="number"
                        value={newComp.build_year || ''}
                        onChange={(e) => setNewComp(prev => ({ ...prev, build_year: parseInt(e.target.value) || 0 }))}
                        placeholder="2022"
                        className="bg-background/80 focus-visible:ring-primary"
                      />
                    </div>
                  </div>
                </section>
                
                <section className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
                  <div className="mb-4 min-w-0">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Classification and location</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-purchase-date-category">Purchase Date Category</Label>
                      <Select 
                        value={newComp.purchase_date_category} 
                        onValueChange={(v) => setNewComp(prev => ({ ...prev, purchase_date_category: v as PurchaseDateCategory }))}
                      >
                        <SelectTrigger id="depreciation-comp-purchase-date-category" className="bg-background/80 focus:ring-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PURCHASE_CATEGORY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-property-type">Property Type</Label>
                      <Select 
                        value={newComp.property_type} 
                        onValueChange={(v) => setNewComp(prev => ({ ...prev, property_type: v as PropertyType }))}
                      >
                        <SelectTrigger id="depreciation-comp-property-type" className="bg-background/80 focus:ring-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-finish-standard">Finish Standard</Label>
                      <Select 
                        value={newComp.finish_standard} 
                        onValueChange={(v) => setNewComp(prev => ({ ...prev, finish_standard: v as FinishStandard }))}
                      >
                        <SelectTrigger id="depreciation-comp-finish-standard" className="bg-background/80 focus:ring-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(FINISH_STANDARD_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="min-w-0 space-y-2">
                      <Label htmlFor="depreciation-comp-nearest-city">Nearest City</Label>
                      <Select 
                        value={newComp.nearest_city} 
                        onValueChange={(v) => setNewComp(prev => ({ ...prev, nearest_city: v as NearestCity }))}
                      >
                        <SelectTrigger id="depreciation-comp-nearest-city" className="bg-background/80 focus:ring-primary">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CITY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>
                
                <Separator />
                
                <section className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
                  <div className="mb-4 min-w-0">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Depreciation values</h3>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="depreciation-comp-bulk-years">Bulk Year Values (paste from spreadsheet)</Label>
                    <Textarea
                      id="depreciation-comp-bulk-years"
                      value={bulkYearsInput}
                      onChange={(e) => setBulkYearsInput(e.target.value)}
                      placeholder="Paste 20 values: DV Year 1-10, then PC Year 1-10 (tab, comma, or newline separated)"
                      rows={4}
                      className="min-h-28 bg-background/80 focus-visible:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: DV1, DV2, DV3... DV10, PC1, PC2, PC3... PC10
                    </p>
                  </div>
                </section>
                
                <section className="rounded-2xl border border-border/60 bg-background/55 p-4 shadow-sm dark:border-white/10 dark:bg-background/35">
                  <div className="mb-4 min-w-0">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Metadata</h3>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="depreciation-comp-notes">Notes (optional)</Label>
                    <Input
                      id="depreciation-comp-notes"
                      value={newComp.notes || ''}
                      onChange={(e) => setNewComp(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Source or additional info"
                      className="bg-background/80 focus-visible:ring-primary"
                    />
                  </div>
                </section>
              </div>
            </div>
            
            <DialogFooter className="shrink-0 border-t border-border/60 bg-background/75 px-5 py-4 dark:border-white/10 dark:bg-background/75 sm:px-6">
              <Button
                variant="outline"
                onClick={() => setShowAddModal(false)}
                className="border-primary/20 bg-background/80 transition-colors hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-primary motion-reduce:transition-none"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddComp}
                className="bg-primary font-semibold text-primary-foreground shadow-[0_12px_30px_hsl(var(--primary)/0.24)] transition-colors hover:bg-primary/90 focus-visible:ring-primary motion-reduce:transition-none"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Comparable
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </CardContent>
      </Card>
    </DashboardThemeFrame>
  );
}
