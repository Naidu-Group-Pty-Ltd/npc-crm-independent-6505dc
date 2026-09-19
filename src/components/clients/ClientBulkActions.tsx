import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trash2, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GHLExportDialog } from '@/components/shared/GHLExportDialog';

interface Client {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  ghl_contact_id?: string | null;
  total_portfolio_value: number;
  total_debt: number;
  net_monthly_cash_flow: number;
  ghl_sync_status: string | null;
  client_properties?: { id: string }[];
}

interface ClientBulkActionsProps {
  selectedClients: string[];
  clients: Client[];
  onClearSelection: () => void;
  onActionComplete: () => void;
}

export function ClientBulkActions({ 
  selectedClients, 
  clients, 
  onClearSelection,
  onActionComplete 
}: ClientBulkActionsProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const selectedCount = selectedClients.length;
  const selectedClientData = clients.filter(c => selectedClients.includes(c.id));
  const ghlExportFields = [
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'tags', label: 'Tags' },
    { key: 'source', label: 'Source' },
    { key: 'portfolio_value', label: 'Portfolio Value' },
    { key: 'total_debt', label: 'Total Debt' },
    { key: 'net_cash_flow', label: 'Net Cash Flow' },
    { key: 'properties', label: 'Properties' },
    { key: 'ghl_contact_id', label: 'GHL Contact ID' },
    { key: 'ghl_status', label: 'GHL Status' },
  ];
  const ghlExportRecords = selectedClientData.map((client) => ({
    first_name: client.primary_first_name || '',
    last_name: client.primary_surname || '',
    email: client.primary_email || '',
    phone: client.primary_mobile || '',
    tags: 'Dashboard Export',
    source: 'Dashboard Export',
    portfolio_value: client.total_portfolio_value?.toString() || '0',
    total_debt: client.total_debt?.toString() || '0',
    net_cash_flow: client.net_monthly_cash_flow?.toString() || '0',
    properties: (client.client_properties?.length || 0).toString(),
    ghl_contact_id: client.ghl_contact_id || '',
    ghl_status: client.ghl_sync_status || 'not_synced',
  }));

  const handleBulkSync = async () => {
    setIsSyncing(true);
    let successCount = 0;
    let errorCount = 0;

    for (const clientId of selectedClients) {
      try {
        const { data, error } = await invokeSecureFunction('sync-client-to-ghl', {
          clientId
        });
        if (error || !data?.success) {
          errorCount++;
        } else {
          successCount++;
        }
      } catch {
        errorCount++;
      }
    }

    setIsSyncing(false);
    toast.success(`Synced ${successCount} clients${errorCount > 0 ? `, ${errorCount} failed` : ''}`);
    onActionComplete();
    onClearSelection();
  };

  const handleBulkDelete = async () => {
    setIsDeleting(true);
    
    try {
      // Use secure Edge Function with HttpOnly cookie auth
      let allSuccess = true;
      for (const clientId of selectedClients) {
        try {
          const { data, error } = await invokeSecureFunction('manage-client-data', {
            operation: 'delete',
            table: 'clients',
            clientId,
          });
          
          if (error || !data?.success) {
            allSuccess = false;
            break;
          }
        } catch {
          allSuccess = false;
          break;
        }
      }
      
      if (allSuccess) {
        logActivityDirect({
          actionType: 'client_deleted',
          entityType: 'client',
          metadata: { count: selectedCount, client_ids: selectedClients }
        });
        toast.success(`Deleted ${selectedCount} clients`);
        onActionComplete();
        onClearSelection();
        return;
      }
      
      // Fallback to direct query
      const { error } = await supabase
        .from('clients')
        .delete()
        .in('id', selectedClients);

      if (error) throw error;

      toast.success(`Deleted ${selectedCount} clients`);
      onActionComplete();
      onClearSelection();
    } catch (error: any) {
      toast.error(`Failed to delete: ${error.message}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Tags', 'Source', 'Portfolio Value', 'Total Debt', 'Net Cash Flow', 'Properties', 'GHL Contact ID', 'GHL Status'];
    const rows = selectedClientData.map(c => [
      c.primary_first_name,
      c.primary_surname,
      c.primary_email || '',
      c.primary_mobile || '',
      'Dashboard Export',
      'Dashboard Export',
      c.total_portfolio_value?.toString() || '0',
      c.total_debt?.toString() || '0',
      c.net_monthly_cash_flow?.toString() || '0',
      (c.client_properties?.length || 0).toString(),
      c.ghl_contact_id || '',
      c.ghl_sync_status || 'not_synced'
    ]);

    const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-ghl-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logActivityDirect({
      actionType: 'data_exported',
      entityType: 'client',
      metadata: { format: 'csv', count: selectedCount }
    });
    toast.success(`Exported ${selectedCount} clients to GHL-ready CSV`);
  };

  const handleExportJSON = () => {
    const exportData = selectedClientData.map(c => ({
      name: `${c.primary_first_name} ${c.primary_surname}`,
      email: c.primary_email,
      phone: c.primary_mobile,
      portfolioValue: c.total_portfolio_value,
      totalDebt: c.total_debt,
      netCashFlow: c.net_monthly_cash_flow,
      propertiesCount: c.client_properties?.length || 0,
      ghlStatus: c.ghl_sync_status
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clients-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logActivityDirect({
      actionType: 'data_exported',
      entityType: 'client',
      metadata: { format: 'json', count: selectedCount }
    });
    toast.success(`Exported ${selectedCount} clients to JSON`);
  };

  if (selectedCount === 0) return null;

  return (
    <>
      {/* Same rail as the search/filter toolbar above it — one bar language per page.
          No `bg-*` utility: it would paint over the glass (see src/styles/glass.css). */}
      <div className="glass-rail flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <Badge variant="secondary" className="font-medium tabular-nums">
          {selectedCount} selected
        </Badge>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={handleBulkSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync to GHL
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={handleExportCSV}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Quick CSV Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
              <Download className="h-4 w-4 mr-2" />
              Mapped GHL Export
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportJSON}>
              <Download className="h-4 w-4 mr-2" />
              Export as JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteDialog(true)}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          Clear
        </Button>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} Clients</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedCount} clients? This will also delete all their properties, income, assets, and liabilities. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GHLExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        title="Export clients for GHL"
        description="Map your client fields to GoHighLevel import headers before exporting as CSV or XLSX."
        fields={ghlExportFields}
        records={ghlExportRecords}
        fileBaseName={`clients-ghl-export-${new Date().toISOString().split('T')[0]}`}
        sheetName="Clients Export"
        onExported={(format, count) => toast.success(`Exported ${count} clients to ${format.toUpperCase()}`)}
      />
    </>
  );
}
