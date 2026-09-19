import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  FileCheck2
} from 'lucide-react';
import { toast } from 'sonner';
import { parseExcelToClients, type ParsedClient } from '@/utils/excelClientParser';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationsContext';

interface ExcelDropzoneProps {
  onImportComplete: () => void;
}

type ImportStatus = 'idle' | 'parsing' | 'importing' | 'complete' | 'error';

interface ImportResult {
  clientsCreated: number;
  propertiesCreated: number;
  errors: string[];
}

export function ExcelDropzone({ onImportComplete }: ExcelDropzoneProps) {
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedClients, setParsedClients] = useState<ParsedClient[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const { user } = useAuth();
  const { addNotification } = useNotifications();

  const processFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setStatus('parsing');
    setProgress(10);

    try {
      // Read the Excel file
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      setProgress(30);

      // Parse clients from the workbook
      const clients = parseExcelToClients(workbook);

      if (clients.length === 0) {
        throw new Error('No valid client data found in the spreadsheet');
      }

      setParsedClients(clients);
      setProgress(50);
      setStatus('importing');

      // Import each client
      const result: ImportResult = {
        clientsCreated: 0,
        propertiesCreated: 0,
        errors: []
      };

      for (let i = 0; i < clients.length; i++) {
        const client = clients[i];

        try {
          // Prepare client data
          const clientInsertData = {
            primary_first_name: client.primaryContact.firstName || 'Unknown',
            primary_middle_name: client.primaryContact.middleName,
            primary_surname: client.primaryContact.surname || 'Unknown',
            primary_mobile: client.primaryContact.mobile,
            primary_email: client.primaryContact.email,
            primary_gender: client.primaryContact.gender,
            primary_dob: client.primaryContact.dob,
            secondary_first_name: client.secondaryContact?.firstName,
            secondary_middle_name: client.secondaryContact?.middleName,
            secondary_surname: client.secondaryContact?.surname,
            secondary_mobile: client.secondaryContact?.mobile,
            secondary_email: client.secondaryContact?.email,
            secondary_gender: client.secondaryContact?.gender,
            secondary_dob: client.secondaryContact?.dob,
            current_address: client.address?.currentAddress,
            country: client.address?.country || 'Australia',
            living_situation: client.address?.livingSituation,
            residential_status: client.residentialStatus,
            marital_status: client.familyRelations?.maritalStatus,
            dependents_count: client.familyRelations?.dependentsCount || 0,
            total_portfolio_value: client.portfolioSummary?.totalPortfolioValue || 0,
            total_debt: client.portfolioSummary?.totalDebt || 0,
            total_monthly_expenditure: client.portfolioSummary?.totalMonthlyExpenditure || 0,
            total_monthly_income: client.portfolioSummary?.totalMonthlyIncome || 0,
            total_monthly_rental_income: client.portfolioSummary?.totalMonthlyRentalIncome || 0,
            net_monthly_cash_flow: client.portfolioSummary?.netMonthlyCashFlow || 0,
            ghl_sync_status: 'pending',
            created_by: user?.id
          };

          // Insert client via secure Edge Function
          const { data: fnData, error: fnError } = await invokeSecureFunction('manage-client-data', {
            operation: 'create',
            table: 'clients',
            clientId: '',
            data: clientInsertData,
          });

          if (fnError) throw new Error(fnError.message);
          if (!fnData?.success) throw new Error(fnData?.error || 'Failed to create client');

          const clientData = fnData.result;
          result.clientsCreated++;
          const newClientId = clientData.id;

          // Insert properties
          if (client.properties && client.properties.length > 0) {
            for (const property of client.properties) {
              const propertyData = {
                client_id: newClientId,
                property_type: property.propertyType,
                address: property.address || 'Unknown Address',
                value: property.value || 0,
                loan_remaining: property.loanRemaining || 0,
                interest_rate: property.interestRate || 0,
                ownership_percentage: property.ownershipPercentage || 100,
                monthly_interest_repayment: property.monthlyInterestRepayment || 0,
                monthly_body_corporate: property.monthlyBodyCorporate || 0,
                monthly_council_rates: property.monthlyCouncilRates || 0,
                monthly_water_rates: property.monthlyWaterRates || 0,
                monthly_repairs_maintenance: property.monthlyRepairsMaintenance || 0,
                monthly_property_management: property.monthlyPropertyManagement || 0,
                monthly_landlord_insurance: property.monthlyLandlordInsurance || 0,
                monthly_building_insurance: property.monthlyBuildingInsurance || 0,
                monthly_rental_income: property.monthlyRentalIncome || 0,
                weekly_rental_income: property.weeklyRentalIncome || 0,
                total_monthly_expenditure: property.totalMonthlyExpenditure || 0,
                net_monthly_cashflow: property.netMonthlyCashflow || 0
              };

              const { data: propData, error: propError } = await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_properties',
                clientId: newClientId,
                data: propertyData,
              });

              if (propError || !propData?.success) {
                result.errors.push(`Property error for ${client.primaryContact.firstName}: ${propError?.message || propData?.error}`);
              } else {
                result.propertiesCreated++;
              }
            }
          }

          // Insert employment records
          if (client.employment) {
            for (const emp of client.employment) {
              const empData = {
                client_id: newClientId,
                contact_type: emp.contactType,
                employer_name: emp.employerName,
                employment_type: emp.employmentType,
                occupation_role: emp.occupationRole,
                start_date: emp.startDate,
                is_current: true
              };

              await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_employment',
                clientId: newClientId,
                data: empData,
              });
            }
          }

          // Insert income records
          if (client.income) {
            for (const inc of client.income) {
              const incData = {
                client_id: newClientId,
                contact_type: inc.contactType,
                gross_salary: inc.grossSalary || 0,
                salary_frequency: inc.salaryFrequency || 'annual',
                bonus: inc.bonus || 0,
                allowance: inc.allowance || 0,
                commission: inc.commission || 0,
                overtime_essential: inc.overtimeEssential || 0,
                overtime_non_essential: inc.overtimeNonEssential || 0,
                other_taxable_income: inc.otherTaxableIncome || 0
              };

              await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_income',
                clientId: newClientId,
                data: incData,
              });
            }
          }

          // Insert assets
          if (client.assets) {
            for (const asset of client.assets) {
              const assetData = {
                client_id: newClientId,
                asset_type: asset.assetType,
                vehicle_type: asset.vehicleType,
                make_model: asset.makeModel,
                institution_name: asset.institutionName,
                description: asset.description,
                value: asset.value || 0
              };

              await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_assets',
                clientId: newClientId,
                data: assetData,
              });
            }
          }

          // Insert liabilities
          if (client.liabilities) {
            for (const liability of client.liabilities) {
              const liabData = {
                client_id: newClientId,
                liability_type: liability.liabilityType,
                provider_name: liability.providerName,
                current_balance: liability.currentBalance || 0,
                credit_limit: liability.creditLimit,
                interest_rate: liability.interestRate,
                monthly_repayment: liability.monthlyRepayment || 0,
                repayment_type: liability.repaymentType
              };

              await invokeSecureFunction('manage-client-data', {
                operation: 'create',
                table: 'client_liabilities',
                clientId: newClientId,
                data: liabData,
              });
            }
          }

        } catch (err: any) {
          result.errors.push(`Failed to import ${client.primaryContact.firstName || 'client'}: ${err.message}`);
        }

        setProgress(50 + ((i + 1) / clients.length) * 45);
      }

      // Log the import via secure Edge Function
      await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_import_logs',
        clientId: '',
        data: {
          file_name: file.name,
          status: result.errors.length === 0 ? 'completed' : 'completed_with_errors',
          clients_created: result.clientsCreated,
          properties_created: result.propertiesCreated,
          errors: result.errors,
          imported_by: user?.id,
          completed_at: new Date().toISOString()
        }
      });

      setProgress(100);
      setImportResult(result);
      setStatus('complete');

      if (result.clientsCreated > 0) {
        toast.success(`Successfully imported ${result.clientsCreated} client(s) with ${result.propertiesCreated} properties`);

        // Add notification for client import
        addNotification({
          type: 'client_created',
          title: 'Clients Imported',
          message: `${result.clientsCreated} client(s) imported with ${result.propertiesCreated} properties`
        });

        // Auto-sync imported clients to GHL via secure Edge Function
        try {
          const { data: clientsData } = await invokeSecureFunction<{ success: boolean; clients: Array<{ id: string }> }>('get-client-data', {
            listMode: true,
            listOptions: {
              select: 'id',
              filters: { ghl_sync_status: 'pending' },
              orderBy: 'created_at',
              order_asc: false,
              limit: result.clientsCreated
            }
          });

          const newClients = clientsData?.clients || [];

          if (newClients.length > 0) {
            toast.info('Syncing clients to GoHighLevel...');
            const clientIds = newClients.map(c => c.id);

            const { data: syncResult, error: syncError } = await invokeSecureFunction('sync-client-to-ghl', {
              action: 'batch', clientIds,
            });

            if (syncError) {
              console.error('Auto-sync error:', syncError);
              toast.warning('Import complete, but GHL sync failed. You can retry manually.');
            } else if (syncResult?.success) {
              toast.success(`Synced ${syncResult.results?.filter((r: any) => r.success).length || 0} clients to GHL`);
            }
          }
        } catch (syncErr) {
          console.error('Auto-sync error:', syncErr);
        }

        onImportComplete();
      }

    } catch (error: any) {
      console.error('Import error:', error);
      setStatus('error');
      toast.error(`Import failed: ${error.message}`);
    }
  }, [user, onImportComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        processFile(acceptedFiles[0]);
      }
    },
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    maxFiles: 1,
    disabled: status === 'parsing' || status === 'importing'
  });

  const resetState = () => {
    setStatus('idle');
    setProgress(0);
    setFileName(null);
    setParsedClients([]);
    setImportResult(null);
  };

  return (
    <div className="space-y-5">
      {status === 'idle' && (
        <div
          {...getRootProps({
            role: 'button',
            'aria-label': 'Upload Excel client import file',
          })}
          className={`
            group relative min-h-[280px] cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed p-6 text-center transition-all duration-300 sm:p-8 md:p-10
            ${isDragActive
              ? 'scale-[1.01] border-brand-300 bg-brand-300/10 shadow-2xl shadow-brand-500/25 ring-4 ring-brand-300/20'
              : 'border-brand-300/35 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.12),transparent_36%),linear-gradient(145deg,rgba(24,24,27,0.88),rgba(3,7,18,0.78))] shadow-xl shadow-sm dark:shadow-black/20 hover:-translate-y-0.5 hover:border-brand-300/70 hover:bg-brand-300/[0.08] hover:shadow-2xl hover:shadow-brand-950/20 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-300/20'
            }
          `}
        >
          <input {...getInputProps()} />
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <div className="absolute right-4 top-4 rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/25 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground dark:text-muted-foreground">
            No file selected
          </div>
          <div className="flex min-h-[220px] flex-col items-center justify-center">
            <div className={`mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border shadow-2xl transition-all duration-300 ${isDragActive ? 'border-brand-200/60 bg-brand-300 text-black shadow-brand-500/35 scale-105' : 'border-brand-300/25 bg-brand-300/10 text-brand-100 shadow-brand-950/25 group-hover:border-brand-200/50 group-hover:bg-brand-300/15'}`}>
              <FileSpreadsheet className="h-10 w-10" />
            </div>
            <div className="max-w-xl space-y-2">
              <p className="text-2xl font-bold tracking-tight text-foreground dark:text-white sm:text-3xl">
                {isDragActive ? 'Drop the Excel file here' : 'Drag & drop your Excel file here'}
              </p>
              <p className="text-sm leading-6 text-muted-foreground dark:text-muted-foreground sm:text-base">
                Import client intake data and property portfolios from a spreadsheet, or click anywhere in this panel to browse.
              </p>
            </div>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
              <span className="inline-flex items-center gap-2 rounded-full border border-brand-300/25 bg-brand-300/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-100">
                <Upload className="h-3.5 w-3.5" />
                Browse files
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-border dark:border-white/10 bg-background dark:bg-black/20 px-4 py-2 text-xs font-semibold text-muted-foreground dark:text-foreground">
                <FileCheck2 className="h-3.5 w-3.5 text-success" />
                Supports .xlsx and .xls
              </span>
            </div>
          </div>
        </div>
      )}

      {(status === 'parsing' || status === 'importing') && (
        <div className="relative overflow-hidden rounded-3xl border border-brand-300/25 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_34%),linear-gradient(145deg,rgba(24,24,27,0.92),rgba(3,7,18,0.86))] p-5 shadow-xl shadow-brand-950/15 sm:p-6">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-300/10 text-brand-100 shadow-lg shadow-brand-950/20">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="truncate font-semibold text-brand-50">{fileName}</p>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-300/25 bg-brand-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-100">
                  {status === 'parsing' ? 'Parsing' : 'Importing'}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
                {status === 'parsing' ? 'Parsing spreadsheet...' : 'Importing clients...'}
              </p>
              <div className="mt-4 rounded-2xl border border-brand-300/10 bg-background dark:bg-black/20 p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-brand-100/70">
                  <span>{status === 'parsing' ? 'Reading workbook structure' : 'Creating client records'}</span>
                  <span className="tabular-nums">{Math.round(progress)}%</span>
                </div>
                <Progress value={progress} className="h-3 border border-brand-300/15 bg-brand-950/60 shadow-inner shadow-sm dark:shadow-black/30 [&>div]:bg-gradient-to-r [&>div]:from-brand-300 [&>div]:via-brand-400 [&>div]:to-warning [&>div]:shadow-[0_0_18px_rgba(251,191,36,0.36)]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {status === 'complete' && importResult && (
        <div className="relative overflow-hidden rounded-3xl border border-success/25 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.16),transparent_34%),linear-gradient(145deg,rgba(24,24,27,0.92),rgba(3,7,18,0.86))] p-5 shadow-xl shadow-success/15 sm:p-6">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-success/60 to-transparent" />
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-success/30 bg-success/10 text-success shadow-lg shadow-success/20">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-success-foreground">Import Complete</p>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-success/25 bg-success/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-success">
                  Complete
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground dark:text-muted-foreground">{fileName}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Badge variant="secondary" className="justify-center rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-bold text-success">
              {importResult.clientsCreated} Client(s)
            </Badge>
            <Badge variant="secondary" className="justify-center rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-bold text-success">
              {importResult.propertiesCreated} Properties
            </Badge>
          </div>

          {importResult.errors.length > 0 && (
            <div className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">{importResult.errors.length} Warning(s)</span>
              </div>
              <ul className="space-y-1 text-sm text-destructive/80">
                {importResult.errors.slice(0, 5).map((error, i) => (
                  <li key={i}>• {error}</li>
                ))}
                {importResult.errors.length > 5 && (
                  <li>• ...and {importResult.errors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          <Button onClick={resetState} variant="outline" className="mt-5 h-11 w-full rounded-2xl border-success/20 bg-white/[0.03] text-success hover:bg-success/10">
            <Upload className="h-4 w-4 mr-2" />
            Import Another File
          </Button>
        </div>
      )}

      {status === 'error' && (
        <div className="relative overflow-hidden rounded-3xl border border-destructive/40 bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.14),transparent_34%),linear-gradient(145deg,rgba(24,24,27,0.92),rgba(3,7,18,0.86))] p-5 shadow-xl shadow-destructive/15 sm:p-6">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-destructive/60 to-transparent" />
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 text-destructive shadow-lg shadow-destructive/20">
              <XCircle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-semibold text-foreground">Import Failed</p>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-destructive">
                  Error
                </span>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{fileName}</p>
              <p className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive/90">
                Import failed. Please review the file and try again.
              </p>
            </div>
          </div>
          <Button onClick={resetState} variant="outline" className="mt-5 h-11 w-full rounded-2xl border-destructive/30 bg-white/[0.03] text-destructive hover:bg-destructive/10">
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}
