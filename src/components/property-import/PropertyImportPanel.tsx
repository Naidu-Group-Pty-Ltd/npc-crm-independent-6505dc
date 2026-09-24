import { useCallback, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, FileText, Link, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { convertPdfToImages, imageFileToBase64, isImageFile, isPdfFile } from '@/utils/pdfToImages';
import { provenanceNotice, readScrapeProvenance } from '@/lib/reports/scrapeProvenance.pure';

export type PropertyImportCategory = 'commercial' | 'industrial';

/**
 * An extraction that could not read the listing page says so.
 *
 * The server records `metadata.scrapedFromPage` on every job and nothing here
 * read it, so "URL listing imported · Populated: …" was the same sentence
 * whether the figures came off the page or from a web search for it. See
 * `scrapeProvenance.pure.ts`.
 */
export interface ImportedPropertyData {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  price?: number;
  valuation?: number;
  assetClass?: string;
  assetSubType?: string;
  tenure?: string;
  zoning?: string;
  gfaSqm?: number;
  nlaSqm?: number;
  glaSqm?: number;
  siteAreaSqm?: number;
  parkingBays?: number;
  yearBuilt?: number;
  propertyName?: string;
  siteCoverPct?: number;
  officePct?: number;
  hardstandSqm?: number;
  clearanceMetres?: number;
  powerKva?: number;
  dockDoors?: number;
  groundFloorLoadKpa?: number;
  conditionRating?: string;
  passingNoiPa?: number;
  marketNoiPa?: number;
  passingCapRatePct?: number;
  marketCapRatePct?: number;
  vendorAdvisedRentPa?: number;
  vendorAdvisedOutgoingsPa?: number;
  outgoingsTotalPa?: number;
  outgoingsRecoverablePa?: number;
  vendorAdvisedYieldPct?: number;
  leaseType?: string;
  leaseExpiryDate?: string;
  leaseOptions?: string;
  waleYears?: number;
  tenantNames?: string[];
  gstTreatment?: string;
  truckAccess?: string;
  notes?: string;
  sourceUrl?: string;
}

interface Props {
  category: PropertyImportCategory;
  onImported: (data: ImportedPropertyData) => void;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeDetails(raw: any, category: PropertyImportCategory, sourceUrl?: string): ImportedPropertyData {
  const details = raw?.extractedDetails || raw?.extractedData || raw?.structuredPayload || raw || {};
  const address = details.extractedAddress || details.propertyAddress || details.address;
  const propertyType = details.extractedPropertyType || details.propertyType;
  const buildSize = toNumber(details.extractedBuildSize ?? details.buildSize);
  const landSize = toNumber(details.extractedLandSize ?? details.landSize);

  const financialNotes = [
    toNumber(details.extractedPassingNoiPa ?? details.passingNoiPa) ? `Passing NOI p.a.: $${toNumber(details.extractedPassingNoiPa ?? details.passingNoiPa)!.toLocaleString('en-AU')}` : undefined,
    toNumber(details.extractedMarketNoiPa ?? details.marketNoiPa) ? `Market NOI p.a.: $${toNumber(details.extractedMarketNoiPa ?? details.marketNoiPa)!.toLocaleString('en-AU')}` : undefined,
    toNumber(details.extractedPassingCapRatePct ?? details.passingCapRatePct) ? `Passing cap rate: ${toNumber(details.extractedPassingCapRatePct ?? details.passingCapRatePct)}%` : undefined,
    toNumber(details.extractedVendorYieldPct ?? details.vendorAdvisedYieldPct) ? `Vendor advised yield: ${toNumber(details.extractedVendorYieldPct ?? details.vendorAdvisedYieldPct)}%` : undefined,
    details.extractedLeaseType || details.leaseType ? `Lease type: ${details.extractedLeaseType || details.leaseType}` : undefined,
    details.extractedLeaseExpiryDate || details.leaseExpiryDate ? `Lease expiry: ${details.extractedLeaseExpiryDate || details.leaseExpiryDate}` : undefined,
    details.extractedLeaseOptions || details.leaseOptions ? `Lease options: ${details.extractedLeaseOptions || details.leaseOptions}` : undefined,
    toNumber(details.extractedWaleYears ?? details.waleYears) ? `WALE: ${toNumber(details.extractedWaleYears ?? details.waleYears)} years` : undefined,
    Array.isArray(details.extractedTenantNames ?? details.tenantNames) ? `Tenants: ${(details.extractedTenantNames ?? details.tenantNames).join(', ')}` : undefined,
    details.extractedTruckAccess || details.truckAccess ? `Truck access: ${details.extractedTruckAccess || details.truckAccess}` : undefined,
  ].filter(Boolean);

  const imported: ImportedPropertyData = {
    address,
    suburb: details.extractedSuburb || details.suburb,
    state: (details.extractedState || details.state)?.toUpperCase?.() || details.extractedState || details.state,
    postcode: details.extractedPostcode || details.postcode,
    price: toNumber(details.extractedPrice ?? details.purchasePrice ?? details.price),
    valuation: toNumber(details.extractedValuation ?? details.currentValuation ?? details.valuation),
    assetClass: details.extractedAssetClass || details.assetClass || (category === 'commercial' ? propertyType : undefined),
    assetSubType: details.extractedAssetSubType || details.assetSubType || details.assetSubtype || (category === 'industrial' ? propertyType : undefined),
    tenure: details.extractedTenure || details.tenure,
    zoning: details.extractedZoning || details.zoning,
    gfaSqm: toNumber(details.extractedGfaSqm ?? details.gfaSqm),
    nlaSqm: toNumber(details.extractedNlaSqm ?? details.nlaSqm),
    glaSqm: toNumber(details.extractedGlaSqm ?? details.glaSqm) ?? (category === 'industrial' ? buildSize : undefined),
    siteAreaSqm: toNumber(details.extractedSiteAreaSqm ?? details.siteAreaSqm) ?? landSize,
    parkingBays: toNumber(details.extractedParkingBays ?? details.parkingBays ?? details.extractedCarSpaces ?? details.carSpaces),
    yearBuilt: toNumber(details.extractedYearBuilt ?? details.yearBuilt),
    propertyName: details.extractedPropertyName || details.propertyName || details.title,
    siteCoverPct: toNumber(details.extractedSiteCoverPct ?? details.siteCoverPct),
    officePct: toNumber(details.extractedOfficePct ?? details.officePct),
    hardstandSqm: toNumber(details.extractedHardstandSqm ?? details.hardstandSqm),
    clearanceMetres: toNumber(details.extractedClearanceMetres ?? details.clearanceMetres),
    powerKva: toNumber(details.extractedPowerKva ?? details.powerKva),
    dockDoors: toNumber(details.extractedDockDoors ?? details.dockDoors),
    groundFloorLoadKpa: toNumber(details.extractedGroundFloorLoadKpa ?? details.groundFloorLoadKpa),
    conditionRating: details.extractedConditionRating || details.conditionRating,
    passingNoiPa: toNumber(details.extractedPassingNoiPa ?? details.passingNoiPa),
    marketNoiPa: toNumber(details.extractedMarketNoiPa ?? details.marketNoiPa),
    passingCapRatePct: toNumber(details.extractedPassingCapRatePct ?? details.passingCapRatePct),
    marketCapRatePct: toNumber(details.extractedMarketCapRatePct ?? details.marketCapRatePct),
    vendorAdvisedRentPa: toNumber(details.extractedVendorRentPa ?? details.vendorAdvisedRentPa),
    vendorAdvisedOutgoingsPa: toNumber(details.extractedVendorOutgoingsPa ?? details.vendorAdvisedOutgoingsPa),
    outgoingsTotalPa: toNumber(details.extractedOutgoingsTotalPa ?? details.outgoingsTotalPa),
    outgoingsRecoverablePa: toNumber(details.extractedOutgoingsRecoverablePa ?? details.outgoingsRecoverablePa),
    vendorAdvisedYieldPct: toNumber(details.extractedVendorYieldPct ?? details.vendorAdvisedYieldPct),
    leaseType: details.extractedLeaseType || details.leaseType,
    leaseExpiryDate: details.extractedLeaseExpiryDate || details.leaseExpiryDate,
    leaseOptions: details.extractedLeaseOptions || details.leaseOptions,
    waleYears: toNumber(details.extractedWaleYears ?? details.waleYears),
    tenantNames: Array.isArray(details.extractedTenantNames ?? details.tenantNames) ? (details.extractedTenantNames ?? details.tenantNames) : undefined,
    gstTreatment: details.extractedGstTreatment || details.gstTreatment,
    truckAccess: details.extractedTruckAccess || details.truckAccess,
    notes: [details.extractedNotes || details.notes || details.listing_text, financialNotes.length ? `Imported lease/income details:\n${financialNotes.map(note => `- ${note}`).join('\n')}` : undefined].filter(Boolean).join('\n\n'),
    sourceUrl,
  };

  return Object.fromEntries(Object.entries(imported).filter(([, value]) => value !== undefined && value !== null && value !== '')) as ImportedPropertyData;
}

export function PropertyImportPanel({ category, onImported }: Props) {
  const [propertyUrl, setPropertyUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [conversionProgress, setConversionProgress] = useState<{ current: number; total: number } | null>(null);

  const applyImportedData = (
    data: ImportedPropertyData,
    sourceLabel: string,
    metadata?: unknown,
  ) => {
    onImported(data);
    const found = [
      data.address,
      data.price ? `$${data.price.toLocaleString('en-AU')}` : undefined,
      data.siteAreaSqm ? `${data.siteAreaSqm.toLocaleString('en-AU')}m² site` : undefined,
      data.nlaSqm ? `${data.nlaSqm.toLocaleString('en-AU')}m² NLA` : undefined,
      data.glaSqm ? `${data.glaSqm.toLocaleString('en-AU')}m² GLA` : undefined,
    ].filter(Boolean);

    const notice = metadata === undefined
      ? null
      : provenanceNotice(readScrapeProvenance(metadata));
    const populated = found.length > 0
      ? `Populated: ${found.join(', ')}.`
      : 'Limited details extracted.';

    toast({
      title: notice ? `${sourceLabel} imported — check the figures` : `${sourceLabel} imported`,
      description: notice
        ? `${populated} ${notice.title} — check the address and the price against the listing.`
        : `${populated} Review the fields below before saving.`,
      variant: notice ? 'destructive' : undefined,
    });
  };

  const handleScrapeUrl = async () => {
    if (!propertyUrl.trim()) {
      toast({ title: 'URL required', description: 'Please enter a property listing URL to extract.', variant: 'destructive' });
      return;
    }

    setIsScraping(true);
    setScrapeError(null);

    try {
      // 1) Enqueue the existing extraction job (returns immediately with a jobId).
      const { data: startData, error: startError } = await invokeSecureFunction('scrape-property-listing', {
        url: propertyUrl,
        propertyCategory: category,
      }, { timeoutMs: 60000 });

      if (startError) throw new Error(startError.message || 'Failed to start the extraction');
      if (!startData?.success || !startData?.jobId) {
        throw new Error(startData?.error || 'Failed to start the extraction');
      }

      const jobId: string = startData.jobId;

      // 2) Poll for status — backend does the long work via EdgeRuntime.waitUntil.
      const POLL_INTERVAL_MS = 5000;
      const MAX_WAIT_MS = 1500 * 1000; // 1500 seconds
      const MAX_CONSECUTIVE_POLL_ERRORS = 5;
      const startedAt = Date.now();
      let consecutivePollErrors = 0;
      let lastPollErrorMsg = '';
      let finalData: any = null;

      while (true) {
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          throw new Error('Extraction is taking longer than expected. Please try again or use the PDF / Image tab.');
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const { data: pollData, error: pollError } = await invokeSecureFunction('scrape-property-listing', {
          jobId,
        }, { timeoutMs: 60000 });

        // Tolerate transient poll failures — only abort after several consecutive errors.
        if (pollError || !pollData?.success) {
          consecutivePollErrors += 1;
          lastPollErrorMsg = pollError?.message || pollData?.error || 'Failed to check extraction status';
          if (consecutivePollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            throw new Error(`Extraction status check failed repeatedly: ${lastPollErrorMsg}`);
          }
          continue;
        }
        consecutivePollErrors = 0;

        if (pollData.status === 'succeeded') {
          finalData = pollData.data;
          break;
        }
        if (pollData.status === 'failed') {
          throw new Error(pollData.error || 'Extraction failed');
        }
        // queued | processing → keep polling
      }


      if (!finalData) throw new Error('No data returned from the extraction');

      applyImportedData(
        normalizeDetails(finalData, category, finalData?.sourceUrl || propertyUrl),
        'URL listing',
        finalData?.metadata,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to extract property listing';
      setScrapeError(message);
      toast({ title: 'Extraction failed', description: message, variant: 'destructive' });
    } finally {
      setIsScraping(false);
    }
  };


  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const selected = event.dataTransfer.files?.[0];
    if (!selected) return;
    if (isPdfFile(selected) || isImageFile(selected)) {
      setFile(selected);
      setPdfError(null);
    } else {
      setPdfError('Please upload a PDF or image file (PNG, JPG, WEBP).');
    }
  }, []);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (isPdfFile(selected) || isImageFile(selected)) {
      setFile(selected);
      setPdfError(null);
    } else {
      setPdfError('Please upload a PDF or image file (PNG, JPG, WEBP).');
    }
  };

  const handleParseFile = async () => {
    if (!file) {
      toast({ title: 'File required', description: 'Please upload a PDF or image file first.', variant: 'destructive' });
      return;
    }

    setIsParsing(true);
    setPdfError(null);
    setConversionProgress(null);

    try {
      const requestBody: any = { fileName: file.name, propertyCategory: category };

      if (isPdfFile(file)) {
        toast({ title: 'Converting PDF', description: 'Rendering PDF pages as images for analysis...' });
        const conversionResult = await convertPdfToImages(file, (current, total) => setConversionProgress({ current, total }));
        if (!conversionResult.success) throw new Error(conversionResult.error || 'Failed to convert PDF to images');
        requestBody.pageImages = conversionResult.images.map((image) => ({
          pageNumber: image.pageNumber,
          base64: image.base64,
          width: image.width,
          height: image.height,
        }));
      } else if (isImageFile(file)) {
        requestBody.singleImage = await imageFileToBase64(file);
        requestBody.imageMimeType = file.type || 'image/png';
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or image file.');
      }

      toast({ title: 'Analyzing document', description: 'Extracting property details from the uploaded file...' });
      const { data, error } = await invokeSecureFunction('parse-property-pdf', requestBody, { timeoutMs: 300000 });
      if (error) throw new Error(error.message || 'Failed to parse document');
      if (!data?.success) throw new Error(data?.error || 'Document parsing failed');

      applyImportedData(normalizeDetails(data.extractedData || data.structuredPayload, category), 'Document');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to process document';
      setPdfError(message);
      toast({ title: 'Document processing failed', description: message, variant: 'destructive' });
    } finally {
      setIsParsing(false);
      setConversionProgress(null);
    }
  };

  return (
    <Card className="col-span-2 border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Import property details</CardTitle>
        <CardDescription>
          Extract a listing URL or import a PDF/image, then review the populated fields before saving.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="url" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="url" className="gap-2"><Link className="h-4 w-4" /> URL Extraction</TabsTrigger>
            <TabsTrigger value="pdf" className="gap-2"><FileText className="h-4 w-4" /> PDF / Image</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`${category}-property-url`}>Property listing URL</Label>
              <div className="flex gap-2">
                <Input
                  id={`${category}-property-url`}
                  value={propertyUrl}
                  onChange={(event) => setPropertyUrl(event.target.value)}
                  placeholder="https://www.realcommercial.com.au/..."
                  disabled={isScraping}
                />
                <Button type="button" onClick={handleScrapeUrl} disabled={isScraping || !propertyUrl.trim()}>
                  {isScraping ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Link className="h-4 w-4 mr-2" />}
                  {isScraping ? 'Extracting…' : 'Extract URL'}
                </Button>
              </div>
            </div>
            {scrapeError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <span>{scrapeError}</span>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pdf" className="space-y-3">
            <div
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
              onDrop={handleDrop}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
            >
              {file ? (
                <div className="space-y-3">
                  <FileText className="h-10 w-10 mx-auto text-primary" />
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFile(null)} disabled={isParsing}>
                    <X className="h-4 w-4 mr-2" /> Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <div>
                    <p className="font-medium">Drop a PDF or image here</p>
                    <p className="text-sm text-muted-foreground">or click to select a file</p>
                  </div>
                  <Input className="max-w-xs mx-auto" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={handleFileSelect} />
                </div>
              )}
            </div>

            {conversionProgress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Rendering PDF pages</span>
                  <span>{conversionProgress.current}/{conversionProgress.total}</span>
                </div>
                <Progress value={(conversionProgress.current / conversionProgress.total) * 100} />
              </div>
            )}

            {pdfError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <span>{pdfError}</span>
              </div>
            )}

            <Button type="button" onClick={handleParseFile} disabled={isParsing || !file} className="w-full">
              {isParsing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
              {isParsing ? 'Parsing…' : 'Parse document'}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
