import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  FileSpreadsheet, 
  Download,
  Trash2,
  Loader2,
  Upload,
  Calendar,
  CheckCircle2,
  FileUp,
  AlertTriangle,
  User,
  Briefcase,
  DollarSign,
  Building2,
  CreditCard,
  PiggyBank
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationsContext';
import * as XLSX from 'xlsx';
import { parseFormaraForm } from '@/utils/formaraParser';
import { parseFormaraPdf } from '@/utils/formaraPdfParser';
import type { ParsedClient } from '@/utils/excelClientParser';
import { secureStorageUpload, secureStorageDownload, secureStorageDelete } from '@/hooks/useSecureStorage';

interface ClientFormaraFormsProps {
  clientId: string;
  clientName: string;
}

type UploadStatus = 'idle' | 'parsing' | 'importing' | 'complete' | 'error';

interface ImportSummary {
  personalDetailsUpdated: boolean;
  additionalContactsImported: number;
  employmentRecords: number;
  incomeRecords: number;
  assetRecords: number;
  liabilityRecords: number;
  propertyRecords: number;
  portfolioUpdated: boolean;
  /**
   * Whether the `client_files` row recording the uploaded workbook was
   * written. Separate from the import itself: the parsed data lands either
   * way, and the file record is what the "Imported Client Detail Forms" list
   * reads — so when it is missing, the page must say so rather than show an
   * empty list under a green tick.
   */
  fileRecorded: boolean;
}

/**
 * Normalize legacy file_path values. Some older records stored the entire
 * upload-response JSON (e.g. '{"success":true,"path":"formara-forms/...","fullPath":"client-files/formara-forms/..."}')
 * as the file_path. Returns { bucket, key } for the storage call.
 *
 * The actual files live in the "client-files" bucket under the "formara-forms/" prefix
 * (legacy upload behaviour), even though new uploads target the "formara-forms" bucket.
 */
// 'vownet-forms' is the legacy bucket/prefix retained for reading pre-rename records.
type FormaraStorageBucket = 'formara-forms' | 'vownet-forms' | 'client-files' | 'client-documents';
const LEGACY_PREFIX = 'vownet-forms/';

function resolveStorageLocations(raw: string, storageBucket?: string | null): Array<{ bucket: FormaraStorageBucket; key: string }> {
  if (!raw) return [];
  let trimmed = raw.trim();
  const candidates: Array<{ bucket: FormaraStorageBucket; key: string }> = [];
  const add = (bucket: FormaraStorageBucket, key: string) => {
    const normalized = key.replace(/^\/+/, '').replace(/\\/g, '/');
    if (!normalized || normalized.split('/').some((part) => part === '..' || !part)) return;
    if (!candidates.some((candidate) => candidate.bucket === bucket && candidate.key === normalized)) candidates.push({ bucket, key: normalized });
  };

  // Legacy: stored the JSON response object
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const fullPath: string = parsed?.fullPath || '';
      const path: string = parsed?.path || '';
      if (fullPath.startsWith('client-files/')) {
        add('client-files', fullPath.replace(/^client-files\//, ''));
      }
      if (fullPath.startsWith(LEGACY_PREFIX)) {
        add('vownet-forms', fullPath.replace(/^vownet-forms\//, ''));
        add('client-files', fullPath);
      }
      if (fullPath.startsWith('formara-forms/')) {
        // fullPath prefixed with bucket "formara-forms" but files actually live in client-files
        add('formara-forms', fullPath.replace(/^formara-forms\//, ''));
        add('client-files', fullPath);
      }
      if (path) {
        // Path from upload response is typically "formara-forms/<clientId>/<file>" —
        // the object physically lives in the client-files bucket with that full key.
        add('formara-forms', path.replace(/^formara-forms\//, ''));
        add('client-files', path.startsWith('formara-forms/') ? path : `formara-forms/${path}`);
        if (path.startsWith(LEGACY_PREFIX)) {
          add('vownet-forms', path.replace(/^vownet-forms\//, ''));
          add('client-files', path);
        }
      }
    } catch {
      /* fall through */
    }
  }

  // Stored full signed/public URLs are legacy metadata, not storage keys.
  // Strip query signatures and extract only the object path after /object/.
  try {
    const url = new URL(trimmed);
    const marker = '/object/';
    const objectPath = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    if (url.pathname.includes(marker)) trimmed = decodeURIComponent(objectPath);
  } catch {
    // Plain storage key; continue below.
  }
  trimmed = trimmed.replace(/^\/+/, '');
  const configuredBucket = storageBucket === 'formara-forms' || storageBucket === 'vownet-forms' || storageBucket === 'client-files' || storageBucket === 'client-documents'
    ? storageBucket : null;
  if (configuredBucket) add(configuredBucket, trimmed.replace(new RegExp(`^${configuredBucket}/`), ''));
  if (trimmed.startsWith(LEGACY_PREFIX)) {
    add('vownet-forms', trimmed.replace(/^vownet-forms\//, ''));
    add('client-files', trimmed);
  } else if (trimmed.startsWith('formara-forms/')) {
    add('formara-forms', trimmed.replace(/^formara-forms\//, ''));
    add('client-files', trimmed);
  } else {
    add('client-documents', trimmed.replace(/^client-documents\//, ''));
    add('client-files', trimmed.replace(/^client-files\//, ''));
  }
  return candidates;
}

export function ClientFormaraForms({ clientId, clientName }: ClientFormaraFormsProps) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { addNotification } = useNotifications();

  // Fetch Formara forms for this client
  const { data: formaraForms = [], isLoading } = useQuery({
    queryKey: ['client-formara-forms', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { files: true },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to fetch formara forms');
      
      return (data.files || []).filter((f: any) => f.is_formara_form);
    }
  });

  const processAndImportFormaraForm = async (file: File) => {
    setUploadStatus('parsing');
    setProgress(10);
    setErrorMessage(null);
    setImportSummary(null);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      
      let parsedData: ParsedClient | null;
      
      if (isPdf) {
        // Parse PDF using AI extraction
        parsedData = await parseFormaraPdf(file, (progress) => {
          if (progress.stage === 'extracting') {
            setProgress(10 + (progress.current / progress.total) * 15);
          } else if (progress.stage === 'parsing') {
            setProgress(28);
          }
        });
      } else {
        // Parse Excel file
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        setProgress(30);
        parsedData = parseFormaraForm(workbook);
      }
      
      if (!parsedData) {
        throw new Error('Could not parse client detail form. Please check the file format.');
      }

      setUploadStatus('importing');
      setProgress(40);

      // Helper to perform bulkDelete with error handling
      const bulkDeleteTable = async (table: string) => {
        const { data: delData, error: delError } = await invokeSecureFunction('manage-client-data', {
          operation: 'bulkDelete',
          table,
          clientId,
        });
        if (delError || !delData?.success) {
          const msg = delError?.message || delData?.error || `Failed to clear existing ${table}`;
          console.error(`bulkDelete failed for ${table}:`, msg);
          throw new Error(msg);
        }
        console.log(`bulkDelete ${table}: removed ${delData.result?.count || 0} records`);
      };

      const summary: ImportSummary = {
        personalDetailsUpdated: false,
        additionalContactsImported: 0,
        employmentRecords: 0,
        incomeRecords: 0,
        assetRecords: 0,
        liabilityRecords: 0,
        propertyRecords: 0,
        portfolioUpdated: false,
        fileRecorded: false
      };

      // 1. Update personal details
      const clientUpdate: Record<string, any> = {};
      
      if (parsedData.primaryContact.firstName) clientUpdate.primary_first_name = parsedData.primaryContact.firstName;
      if (parsedData.primaryContact.middleName) clientUpdate.primary_middle_name = parsedData.primaryContact.middleName;
      if (parsedData.primaryContact.surname) clientUpdate.primary_surname = parsedData.primaryContact.surname;
      if (parsedData.primaryContact.mobile) clientUpdate.primary_mobile = parsedData.primaryContact.mobile;
      if (parsedData.primaryContact.email) clientUpdate.primary_email = parsedData.primaryContact.email;
      if (parsedData.primaryContact.gender) clientUpdate.primary_gender = parsedData.primaryContact.gender;
      if (parsedData.primaryContact.dob) clientUpdate.primary_dob = parsedData.primaryContact.dob;
      
      if (parsedData.secondaryContact) {
        if (parsedData.secondaryContact.firstName) clientUpdate.secondary_first_name = parsedData.secondaryContact.firstName;
        if (parsedData.secondaryContact.middleName) clientUpdate.secondary_middle_name = parsedData.secondaryContact.middleName;
        if (parsedData.secondaryContact.surname) clientUpdate.secondary_surname = parsedData.secondaryContact.surname;
        if (parsedData.secondaryContact.mobile) clientUpdate.secondary_mobile = parsedData.secondaryContact.mobile;
        if (parsedData.secondaryContact.email) clientUpdate.secondary_email = parsedData.secondaryContact.email;
        if (parsedData.secondaryContact.gender) clientUpdate.secondary_gender = parsedData.secondaryContact.gender;
        if (parsedData.secondaryContact.dob) clientUpdate.secondary_dob = parsedData.secondaryContact.dob;
      }

      if (parsedData.address) {
        if (parsedData.address.currentAddress) clientUpdate.current_address = parsedData.address.currentAddress;
        if (parsedData.address.country) clientUpdate.country = parsedData.address.country;
        if (parsedData.address.livingSituation) clientUpdate.living_situation = parsedData.address.livingSituation;
      }

      if (parsedData.familyRelations) {
        if (parsedData.familyRelations.maritalStatus) clientUpdate.marital_status = parsedData.familyRelations.maritalStatus;
        if (parsedData.familyRelations.dependentsCount !== undefined) clientUpdate.dependents_count = parsedData.familyRelations.dependentsCount;
      }

      if (parsedData.residentialStatus) clientUpdate.residential_status = parsedData.residentialStatus;

      if (Object.keys(clientUpdate).length > 0) {
        const { data: fnData, error: fnError } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: clientUpdate,
        });
        if (!fnError && fnData?.success) {
          summary.personalDetailsUpdated = true;
        } else {
          console.error('Error updating client details:', fnError?.message);
        }
      }
      
      // 1b. Import additional contacts if present
      if (parsedData.additionalContacts && parsedData.additionalContacts.length > 0) {
        // Delete existing additional contacts first
        await bulkDeleteTable('client_additional_contacts');
        
        for (const contact of parsedData.additionalContacts) {
          const { data: contactResult, error: contactError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_additional_contacts',
            clientId,
            data: {
              client_id: clientId,
              relationship: contact.relationship,
              first_name: contact.firstName,
              surname: contact.surname,
              middle_name: contact.middleName,
              email: contact.email,
              mobile: contact.mobile,
              dob: contact.dob,
              gender: contact.gender,
              display_order: contact.displayOrder,
            }
          });
          if (!contactError && contactResult?.success) summary.additionalContactsImported++;
        }
      }
      setProgress(50);

      // 2. Import employment records (delete existing first to avoid duplicates)
      if (parsedData.employment && parsedData.employment.length > 0) {
        // Delete existing employment records for this client
        await bulkDeleteTable('client_employment');
        
        for (const emp of parsedData.employment) {
          const { data: empResult, error: empError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_employment',
            clientId,
            data: {
              client_id: clientId,
              contact_type: emp.contactType,
              employer_name: emp.employerName,
              employment_type: emp.employmentType,
              occupation_role: emp.occupationRole,
              start_date: emp.startDate,
              is_current: true
            }
          });
          if (!empError && empResult?.success) summary.employmentRecords++;
        }
      }
      setProgress(60);

      // 3. Import income records
      if (parsedData.income && parsedData.income.length > 0) {
        await bulkDeleteTable('client_income');
        
        for (const inc of parsedData.income) {
          const { data: incResult, error: incError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_income',
            clientId,
            data: {
              client_id: clientId,
              contact_type: inc.contactType,
              gross_salary: inc.grossSalary || 0,
              salary_frequency: inc.salaryFrequency || 'annual',
              bonus: inc.bonus || 0,
              allowance: inc.allowance || 0,
              commission: inc.commission || 0,
              overtime_essential: inc.overtimeEssential || 0,
              overtime_non_essential: inc.overtimeNonEssential || 0,
              other_taxable_income: inc.otherTaxableIncome || 0
            }
          });
          if (!incError && incResult?.success) summary.incomeRecords++;
        }
      }
      setProgress(70);

      // 4. Import assets
      if (parsedData.assets && parsedData.assets.length > 0) {
        await bulkDeleteTable('client_assets');
        
        for (const asset of parsedData.assets) {
          const { data: assetResult, error: assetError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_assets',
            clientId,
            data: {
              client_id: clientId,
              asset_type: asset.assetType,
              vehicle_type: asset.vehicleType,
              make_model: asset.makeModel,
              institution_name: asset.institutionName,
              description: asset.description,
              value: asset.value || 0
            }
          });
          if (!assetError && assetResult?.success) summary.assetRecords++;
        }
      }
      setProgress(80);

      // 5. Import liabilities
      if (parsedData.liabilities && parsedData.liabilities.length > 0) {
        await bulkDeleteTable('client_liabilities');
        
        for (const liability of parsedData.liabilities) {
          const { data: liabResult, error: liabError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_liabilities',
            clientId,
            data: {
              client_id: clientId,
              liability_type: liability.liabilityType,
              provider_name: liability.providerName,
              current_balance: liability.currentBalance || 0,
              credit_limit: liability.creditLimit,
              interest_rate: liability.interestRate,
              monthly_repayment: liability.monthlyRepayment || 0,
              repayment_type: liability.repaymentType
            }
          });
          if (!liabError && liabResult?.success) summary.liabilityRecords++;
        }
      }
      setProgress(85);

      // 6. Import properties
      if (parsedData.properties && parsedData.properties.length > 0) {
        // Delete existing properties to avoid duplicates
        await bulkDeleteTable('client_properties');
        
        for (const prop of parsedData.properties) {
          const { data: propResult, error: propError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'client_properties',
            clientId,
            data: {
              client_id: clientId,
              property_type: prop.propertyType,
              address: prop.address || 'Unknown Address',
              value: prop.value || 0,
              loan_remaining: prop.loanRemaining || 0,
              interest_rate: prop.interestRate || 0,
              ownership_percentage: prop.ownershipPercentage || 100,
              monthly_interest_repayment: prop.monthlyInterestRepayment || 0,
              monthly_body_corporate: prop.monthlyBodyCorporate || 0,
              monthly_council_rates: prop.monthlyCouncilRates || 0,
              monthly_water_rates: prop.monthlyWaterRates || 0,
              monthly_repairs_maintenance: prop.monthlyRepairsMaintenance || 0,
              monthly_property_management: prop.monthlyPropertyManagement || 0,
              monthly_landlord_insurance: prop.monthlyLandlordInsurance || 0,
              monthly_building_insurance: prop.monthlyBuildingInsurance || 0,
              monthly_rental_income: prop.monthlyRentalIncome || 0,
              weekly_rental_income: prop.weeklyRentalIncome || 0,
              total_monthly_expenditure: prop.totalMonthlyExpenditure || 0,
              net_monthly_cashflow: prop.netMonthlyCashflow || 0
            }
          });
          if (!propError && propResult?.success) summary.propertyRecords++;
        }
      }
      setProgress(90);

      // 7. Update portfolio summary
      if (parsedData.portfolioSummary) {
        const { data: summaryResult, error: summaryError } = await invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'clients',
          clientId,
          data: {
            total_portfolio_value: parsedData.portfolioSummary.totalPortfolioValue,
            total_debt: parsedData.portfolioSummary.totalDebt,
            total_monthly_expenditure: parsedData.portfolioSummary.totalMonthlyExpenditure,
            total_monthly_income: parsedData.portfolioSummary.totalMonthlyIncome,
            total_monthly_rental_income: parsedData.portfolioSummary.totalMonthlyRentalIncome,
            net_monthly_cash_flow: parsedData.portfolioSummary.netMonthlyCashFlow
          }
        });
        if (!summaryError && summaryResult?.success) summary.portfolioUpdated = true;
      }
      setProgress(95);

      // 8. Store the file in storage via secure Edge Function
      const filePath = `${clientId}/${Date.now()}_${file.name}`;
      const uploadResult = await secureStorageUpload('formara-forms', filePath, file, {
        contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        resourceId: clientId,
      });

      // The stored object and the row that records it are two writes, and the
      // second one used to be issued and never read. When it failed — as it did
      // on every import for seven weeks, because `client_files_storage_bucket_check`
      // predates the rename and did not list `formara-forms` — the import still
      // reported "Import Complete!" over a list that read "(0)". The parsed
      // client data is genuinely imported either way, so this is not a failure
      // of the import; it is a failure of the FILE RECORD, and it is said as
      // that rather than as a red toast over work that succeeded.
      if (uploadResult.success) {
        const { data: fileRow, error: fileError } = await invokeSecureFunction('manage-client-data', {
          operation: 'create',
          table: 'client_files',
          clientId,
          data: {
            client_id: clientId,
            file_name: file.name,
            file_path: uploadResult.path || filePath,
            storage_bucket: 'formara-forms',
            file_size: file.size,
            file_type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            category: 'formara',
            document_type: 'formara_form',
            is_formara_form: true,
            uploaded_by: user?.id
          }
        });
        if (fileError || !fileRow?.success) {
          summary.fileRecorded = false;
          console.error('[ClientFormaraForms] client_files row rejected:', fileError ?? fileRow?.error, fileRow?.details);
        } else {
          summary.fileRecorded = true;
        }
      } else {
        summary.fileRecorded = false;
        console.error('[ClientFormaraForms] upload failed:', uploadResult.error);
      }

      setProgress(100);
      setImportSummary(summary);
      setUploadStatus('complete');

      // Invalidate all related queries
      // An import rewrites most of the client, and the card reading it is
      // `secure-client-data` — which this list never named, so every tab kept
      // the values it had until the card was closed and reopened.
      invalidateClientQueries(queryClient, clientId);

      toast.success('Client detail form imported successfully');
      
      addNotification({
        type: 'formara_form_uploaded',
        title: 'Client Detail Form Imported',
        message: `Client data imported for ${clientName}`,
        entityId: clientId
      });

    } catch (error: any) {
      console.error('Client detail form import error:', error);
      setErrorMessage(error.message);
      setUploadStatus('error');
      toast.error('Failed to import client detail form: ' + error.message);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (file: { id: string; file_path: string; storage_bucket?: string | null }) => {
      // 1. Delete associated data from all related tables via secure Edge Function
      const tablesToDelete = ['client_employment', 'client_income', 'client_assets', 'client_liabilities', 'client_properties'];
      
      for (const table of tablesToDelete) {
        await invokeSecureFunction('manage-client-data', {
          operation: 'bulkDelete',
          table,
          clientId,
        });
      }

      // 2. Clear portfolio summary fields on client record
      await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'clients',
        clientId,
        data: {
          total_portfolio_value: null,
          total_debt: null,
          total_monthly_expenditure: null,
          total_monthly_income: null,
          total_monthly_rental_income: null,
          net_monthly_cash_flow: null,
        }
      });

      // 3. Delete file from storage via secure Edge Function
      const loc = resolveStorageLocations(file.file_path, file.storage_bucket)[0];
      const deleteResult = loc ? await secureStorageDelete(loc.bucket, loc.key) : { success: false };

      if (!deleteResult.success) console.warn('Storage delete failed:', deleteResult.error);

      // 4. Delete file record from database via secure Edge Function
      const { error: dbError } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_files',
        clientId,
        recordId: file.id,
      });

      if (dbError) throw new Error(dbError.message);
    },
    onSuccess: () => {
      // Invalidate all related queries to refresh UI
      // An import rewrites most of the client, and the card reading it is
      // `secure-client-data` — which this list never named, so every tab kept
      // the values it had until the card was closed and reopened.
      invalidateClientQueries(queryClient, clientId);
      toast.success('Client detail form and associated data deleted');
    },
    onError: (error: any) => {
      toast.error('Failed to delete: ' + error.message);
    }
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      processAndImportFormaraForm(acceptedFiles[0]);
    }
  }, [clientId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
      'application/vnd.ms-excel.sheet.binary.macroEnabled.12': ['.xlsb'],
      'application/octet-stream': ['.xlsx', '.xls', '.xlsm', '.xlsb'],
      'text/csv': ['.csv'],
      'application/pdf': ['.pdf']
    },
    disabled: uploadStatus === 'parsing' || uploadStatus === 'importing'
  });

  const downloadFile = async (file: { file_path: string; file_name: string; storage_bucket?: string | null }) => {
    const locations = resolveStorageLocations(file.file_path, file.storage_bucket);
    let result: Awaited<ReturnType<typeof secureStorageDownload>> | undefined;
    for (const location of locations) {
      const attempt = await secureStorageDownload(location.bucket, location.key);
      if (attempt.success && attempt.blob) { result = attempt; break; }
    }
    if (!result?.blob) {
      toast.error('The original file could not be found or accessed. The record remains available, but the source PDF may need to be uploaded again.');
      return;
    }

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.file_name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const resetUpload = () => {
    setUploadStatus('idle');
    setProgress(0);
    setErrorMessage(null);
    setImportSummary(null);
  };

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Upload & Import Client Detail Form
          </CardTitle>
        </CardHeader>
        <CardContent>
          {uploadStatus === 'idle' && (
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}
              `}
            >
              <input {...getInputProps()} />
              {isDragActive ? (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-primary" />
                  <p className="text-sm text-primary">Drop client detail form here</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Drag & drop client detail form to import all client data (Excel or PDF)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Automatically populates personal details, employment, income, assets, liabilities & properties
                  </p>
                </div>
              )}
            </div>
          )}

          {(uploadStatus === 'parsing' || uploadStatus === 'importing') && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <div>
                  <p className="font-medium text-sm">
                    {uploadStatus === 'parsing' ? 'Parsing client detail form...' : 'Importing data...'}
                  </p>
                  <p className="text-xs text-muted-foreground">Please wait</p>
                </div>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

          {uploadStatus === 'complete' && importSummary && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-success">
                <CheckCircle2 className="h-5 w-5" />
                <p className="font-medium text-sm">Import Complete!</p>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                {importSummary.personalDetailsUpdated && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <User className="h-3 w-3 text-muted-foreground" />
                    <span>Personal details updated</span>
                  </div>
                )}
                {importSummary.employmentRecords > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <Briefcase className="h-3 w-3 text-muted-foreground" />
                    <span>{importSummary.employmentRecords} employment record(s)</span>
                  </div>
                )}
                {importSummary.incomeRecords > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <DollarSign className="h-3 w-3 text-muted-foreground" />
                    <span>{importSummary.incomeRecords} income record(s)</span>
                  </div>
                )}
                {importSummary.assetRecords > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <PiggyBank className="h-3 w-3 text-muted-foreground" />
                    <span>{importSummary.assetRecords} asset(s)</span>
                  </div>
                )}
                {importSummary.liabilityRecords > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <CreditCard className="h-3 w-3 text-muted-foreground" />
                    <span>{importSummary.liabilityRecords} liability(s)</span>
                  </div>
                )}
                {importSummary.propertyRecords > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                    <Building2 className="h-3 w-3 text-muted-foreground" />
                    <span>{importSummary.propertyRecords} property(s)</span>
                  </div>
                )}
                {importSummary.portfolioUpdated && (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded col-span-2">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    <span>Portfolio summary updated</span>
                  </div>
                )}
                {/*
                  The data landed; the record of the file it came from did not.
                  Saying so is the difference between an empty list somebody
                  reports as a defect and an empty list that explains itself.
                */}
                {!importSummary.fileRecorded && (
                  <div className="col-span-2 flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                    <span>
                      The client data was imported, but this form could not be filed against the
                      client, so it will not appear in the list below.
                    </span>
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" onClick={resetUpload} className="w-full mt-2">
                <Upload className="h-4 w-4 mr-2" />
                Upload Another Form
              </Button>
            </div>
          )}

          {uploadStatus === 'error' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <div>
                  <p className="font-medium text-sm">Import Failed</p>
                  <p className="text-xs">{errorMessage}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={resetUpload} className="w-full">
                Try Again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Forms List */}
      <div>
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Imported Client Detail Forms ({formaraForms.length})
        </h4>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : formaraForms.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No client detail forms imported yet</p>
              <p className="text-xs mt-1">Upload a client detail form to import client data</p>
            </CardContent>
          </Card>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2 pr-4">
              {formaraForms.map((file) => (
                <Card key={file.id} className="group">
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-success/15 dark:bg-success/30">
                      <FileSpreadsheet className="h-4 w-4 text-success dark:text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{file.file_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="bg-success/15 text-success dark:bg-success/30 dark:text-success">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Imported
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatFileSize(file.file_size)}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(file.uploaded_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => downloadFile(file)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => deleteMutation.mutate(file)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
