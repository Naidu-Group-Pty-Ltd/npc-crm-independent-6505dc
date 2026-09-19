import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  AlertTriangle,
  ArrowRight,
  Plus,
  RefreshCw,
  Building2
} from 'lucide-react';
import { toast } from 'sonner';
import { parseExcelToClients, type ParsedClient, type ParsedProperty } from '@/utils/excelClientParser';
import { parseFormaraPdf } from '@/utils/formaraPdfParser';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationsContext';
import { secureStorageUpload } from '@/hooks/useSecureStorage';

interface ClientFormaraUploadProps {
  clientId: string;
  clientName: string;
  existingProperties: Array<{
    id: string;
    address: string;
    property_type: string;
    value: number | null;
  }>;
  onComplete: () => void;
}

interface PropertyMergeItem {
  parsed: ParsedProperty;
  existingMatch?: {
    id: string;
    address: string;
    property_type: string;
    value: number | null;
  };
  action: 'add' | 'update' | 'skip';
  selected: boolean;
}

type UploadStatus = 'idle' | 'parsing' | 'preview' | 'importing' | 'complete' | 'error';

export function ClientFormaraUpload({ 
  clientId, 
  clientName,
  existingProperties, 
  onComplete 
}: ClientFormaraUploadProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedClient, setParsedClient] = useState<ParsedClient | null>(null);
  const [mergeItems, setMergeItems] = useState<PropertyMergeItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const { user } = useAuth();
  const { addNotification } = useNotifications();

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Find matching existing property by address similarity
  const findExistingMatch = (parsed: ParsedProperty) => {
    if (!parsed.address) return undefined;
    const parsedAddr = parsed.address.toLowerCase().trim();
    return existingProperties.find(ep => {
      const existingAddr = ep.address.toLowerCase().trim();
      return existingAddr === parsedAddr || 
             existingAddr.includes(parsedAddr) || 
             parsedAddr.includes(existingAddr);
    });
  };

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setUploadedFile(file);
    setStatus('parsing');
    setProgress(10);
    setErrorMessage(null);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      
      let client: ParsedClient;
      
      if (isPdf) {
        // Parse PDF using AI extraction
        client = await parseFormaraPdf(file, (progress) => {
          if (progress.stage === 'extracting') {
            setProgress(10 + (progress.current / progress.total) * 30);
          } else if (progress.stage === 'parsing') {
            setProgress(50);
          }
        });
      } else {
        // Parse Excel file
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        setProgress(50);

        const clients = parseExcelToClients(workbook);
        
        if (clients.length === 0) {
          throw new Error('No valid client data found in the spreadsheet');
        }
        client = clients[0];
      }
      
      setParsedClient(client);

      // Build merge items with matching logic
      const items: PropertyMergeItem[] = (client.properties || []).map(prop => {
        const match = findExistingMatch(prop);
        return {
          parsed: prop,
          existingMatch: match,
          action: match ? 'update' : 'add',
          selected: true
        };
      });

      setMergeItems(items);
      setProgress(100);
      setStatus('preview');

    } catch (error: any) {
      console.error('Parse error:', error);
      setErrorMessage(error.message);
      setStatus('error');
    }
  }, [existingProperties]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        processFile(acceptedFiles[0]);
      }
    },
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/pdf': ['.pdf']
    },
    maxFiles: 1,
    disabled: status === 'parsing' || status === 'importing'
  });

  const toggleItemSelection = (index: number) => {
    setMergeItems(prev => prev.map((item, i) => 
      i === index ? { ...item, selected: !item.selected } : item
    ));
  };

  const toggleItemAction = (index: number) => {
    setMergeItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      // Cycle through actions: add -> update -> skip -> add
      const nextAction = item.action === 'add' 
        ? (item.existingMatch ? 'update' : 'skip')
        : item.action === 'update' 
          ? 'skip' 
          : 'add';
      return { ...item, action: nextAction };
    }));
  };

  const handleApplyChanges = async () => {
    const selectedItems = mergeItems.filter(item => item.selected && item.action !== 'skip');
    
    if (selectedItems.length === 0) {
      toast.info('No properties selected for import');
      return;
    }

    setStatus('importing');
    setProgress(0);

    try {
      let processed = 0;
      let added = 0;
      let updated = 0;

      for (const item of selectedItems) {
        const propertyData = {
          client_id: clientId,
          property_type: item.parsed.propertyType,
          address: item.parsed.address || 'Unknown Address',
          value: item.parsed.value || 0,
          loan_remaining: item.parsed.loanRemaining || 0,
          interest_rate: item.parsed.interestRate || 0,
          ownership_percentage: item.parsed.ownershipPercentage || 100,
          monthly_interest_repayment: item.parsed.monthlyInterestRepayment || 0,
          monthly_body_corporate: item.parsed.monthlyBodyCorporate || 0,
          monthly_council_rates: item.parsed.monthlyCouncilRates || 0,
          monthly_water_rates: item.parsed.monthlyWaterRates || 0,
          monthly_repairs_maintenance: item.parsed.monthlyRepairsMaintenance || 0,
          monthly_property_management: item.parsed.monthlyPropertyManagement || 0,
          monthly_landlord_insurance: item.parsed.monthlyLandlordInsurance || 0,
          monthly_building_insurance: item.parsed.monthlyBuildingInsurance || 0,
          monthly_rental_income: item.parsed.monthlyRentalIncome || 0,
          weekly_rental_income: item.parsed.weeklyRentalIncome || 0,
          total_monthly_expenditure: item.parsed.totalMonthlyExpenditure || 0,
          net_monthly_cashflow: item.parsed.netMonthlyCashflow || 0
        };

        if (item.action === 'update' && item.existingMatch) {
          const { data: fnData, error: fnError } = await invokeSecureFunction('manage-client-data', {
            operation: 'update',
            table: 'client_properties',
            clientId,
            recordId: item.existingMatch.id,
            data: propertyData,
          });
          if (fnError) throw new Error(fnError.message);
          if (!fnData?.success) throw new Error(fnData?.error || 'Failed to update property');
          updated++;
        } else if (item.action === 'add') {
          const { data: fnData, error: fnError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_properties',
            clientId,
            data: propertyData,
          });
          if (fnError) throw new Error(fnError.message);
          if (!fnData?.success) throw new Error(fnData?.error || 'Failed to add property');
          added++;
        }

        processed++;
        setProgress((processed / selectedItems.length) * 100);
      }

      // Store the Formara form in secure storage
      if (uploadedFile) {
        const filePath = `${clientId}/${Date.now()}_${uploadedFile.name}`;
        const uploadResult = await secureStorageUpload('client-documents', filePath, uploadedFile, {
          contentType: uploadedFile.type,
          resourceId: clientId,
        });

        if (uploadResult.success) {
          // Record in client_files table via secure Edge Function
          await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_files',
            clientId,
            data: {
              client_id: clientId,
              file_name: uploadedFile.name,
              file_path: uploadResult.path || filePath,
              file_size: uploadedFile.size,
              file_type: uploadedFile.type,
              category: 'formara',
              document_type: 'formara_form',
              is_formara_form: true,
              uploaded_by: user?.id
            }
          });
        }
      }

      // Update client portfolio summary if parsed via secure Edge Function
      if (parsedClient?.portfolioSummary) {
        await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: {
            total_portfolio_value: parsedClient.portfolioSummary.totalPortfolioValue,
            total_debt: parsedClient.portfolioSummary.totalDebt,
            total_monthly_expenditure: parsedClient.portfolioSummary.totalMonthlyExpenditure,
            total_monthly_income: parsedClient.portfolioSummary.totalMonthlyIncome,
            total_monthly_rental_income: parsedClient.portfolioSummary.totalMonthlyRentalIncome,
            net_monthly_cash_flow: parsedClient.portfolioSummary.netMonthlyCashFlow
          }
        });
      }

      toast.success(`Portfolio updated: ${added} added, ${updated} updated`);
      setStatus('complete');
      
      // Send notifications
      addNotification({
        type: 'formara_form_uploaded',
        title: 'Client Detail Form Uploaded',
        message: `Client detail form uploaded for ${clientName}`,
        entityId: clientId
      });
      
      if (added > 0 || updated > 0) {
        addNotification({
          type: 'portfolio_updated',
          title: 'Portfolio Updated',
          message: `${clientName}'s portfolio: ${added} properties added, ${updated} updated`,
          entityId: clientId
        });
      }
      
      onComplete();

    } catch (error: any) {
      console.error('Import error:', error);
      setErrorMessage(error.message);
      setStatus('error');
      toast.error('Failed to import properties');
    }
  };

  const resetState = () => {
    setStatus('idle');
    setProgress(0);
    setFileName(null);
    setParsedClient(null);
    setMergeItems([]);
    setErrorMessage(null);
    setUploadedFile(null);
  };

  const selectedCount = mergeItems.filter(i => i.selected && i.action !== 'skip').length;
  const addCount = mergeItems.filter(i => i.selected && i.action === 'add').length;
  const updateCount = mergeItems.filter(i => i.selected && i.action === 'update').length;

  return (
    <div className="space-y-4">
      {status === 'idle' && (
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
            ${isDragActive 
              ? 'border-primary bg-primary/5' 
              : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }
          `}
        >
          <input {...getInputProps()} />
          <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">
            {isDragActive ? 'Drop client detail form here' : 'Upload Client Detail Form'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Drag & drop or click to update {clientName}'s portfolio (Excel or PDF)
          </p>
        </div>
      )}

      {status === 'parsing' && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium text-sm">{fileName}</p>
              <p className="text-xs text-muted-foreground">Parsing spreadsheet...</p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {status === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-sm">Review Changes</h4>
              <p className="text-xs text-muted-foreground">
                {mergeItems.length} properties found in {fileName}
              </p>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary">{addCount} new</Badge>
              <Badge variant="outline">{updateCount} update</Badge>
            </div>
          </div>

          <ScrollArea className="h-[300px] border rounded-lg">
            <div className="p-3 space-y-2">
              {mergeItems.map((item, index) => (
                <Card key={index} className={`transition-opacity ${!item.selected ? 'opacity-50' : ''}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={item.selected}
                        onCheckedChange={() => toggleItemSelection(index)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium truncate">
                            {item.parsed.address || 'Unknown Address'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{item.parsed.propertyType === 'owner_occupied' ? 'Owner Occupied' : 'Investment'}</span>
                          <span>•</span>
                          <span>{formatCurrency(item.parsed.value)}</span>
                        </div>
                        {item.existingMatch && (
                          <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                            <span className="text-muted-foreground">Matches existing: </span>
                            <span>{item.existingMatch.address}</span>
                            <span className="text-muted-foreground"> ({formatCurrency(item.existingMatch.value)})</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleItemAction(index)}
                        className="shrink-0"
                      >
                        {item.action === 'add' && (
                          <Badge className="bg-success/15 text-success hover:bg-success/20">
                            <Plus className="h-3 w-3 mr-1" />
                            Add
                          </Badge>
                        )}
                        {item.action === 'update' && (
                          <Badge className="bg-info/15 text-info hover:bg-info/20">
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Update
                          </Badge>
                        )}
                        {item.action === 'skip' && (
                          <Badge variant="secondary">
                            Skip
                          </Badge>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          <Separator />

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={resetState}>
              Cancel
            </Button>
            <Button 
              onClick={handleApplyChanges}
              disabled={selectedCount === 0}
            >
              Apply {selectedCount} Change{selectedCount !== 1 ? 's' : ''}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {status === 'importing' && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="font-medium text-sm">Importing properties...</p>
              <p className="text-xs text-muted-foreground">Please wait</p>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {status === 'complete' && (
        <div className="border border-success/30 bg-success/10 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div>
              <p className="font-medium text-sm text-success">Import Complete</p>
              <p className="text-xs text-success">Portfolio has been updated successfully</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetState}
            className="mt-3 w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Another Form
          </Button>
        </div>
      )}

      {status === 'error' && (
        <div className="border border-destructive/50 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-sm text-foreground">Import Failed</p>
              <p className="text-xs text-muted-foreground">{errorMessage}</p>
            </div>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={resetState}
            className="mt-3 w-full"
          >
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}