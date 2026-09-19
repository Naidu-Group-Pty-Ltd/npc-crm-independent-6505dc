import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, Loader2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFormaraTemplate, downloadBlankFormaraTemplate, type FormaraExportData } from '@/utils/formaraTemplateGenerator';
import { useNotifications } from '@/contexts/NotificationsContext';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface ExportFormaraButtonProps {
  clientId: string;
  clientName: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Fetch client data securely via HttpOnly cookies
 */
async function fetchClientDataForExport(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: {
      client: true,
      properties: true,
      employment: true,
      income: true,
      assets: true,
      liabilities: true,
    },
  });

  if (error || !data?.success) {
    throw new Error(error?.message || data?.error || 'Failed to fetch client data');
  }
  
  return {
    client: data.client,
    properties: data.properties || [],
    employment: data.employment || [],
    income: data.income || [],
    assets: data.assets || [],
    liabilities: data.liabilities || [],
  };
}

export function ExportFormaraButton({ 
  clientId, 
  clientName,
  variant = 'outline',
  size = 'sm'
}: ExportFormaraButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { addNotification } = useNotifications();
      
  const handleExportPrefilled = async () => {
    setIsExporting(true);
    try {
      const data = await fetchClientDataForExport(clientId);
      
      if (!data?.client) {
        throw new Error('Failed to fetch client data');
      }

      const exportData: FormaraExportData = {
        client: data.client,
        properties: data.properties,
        employment: data.employment,
        income: data.income,
        assets: data.assets,
        liabilities: data.liabilities,
      };

      downloadFormaraTemplate(exportData);
      logActivityDirect({
        actionType: 'client_exported',
        entityType: 'client',
        entityId: clientId,
        entityName: clientName,
        metadata: { format: 'formara_excel', type: 'prefilled' }
      });
      toast.success('Client detail form exported successfully');
      
      addNotification({
        type: 'formara_form_exported',
        title: 'Client Detail Form Exported',
        message: `Client detail form exported for ${clientName}`,
        entityId: clientId
      });
    } catch (error: any) {
      console.error('Export error:', error);
      toast.error('Failed to export: ' + error.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportBlank = () => {
    downloadBlankFormaraTemplate();
    toast.success('Blank client detail template downloaded');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Export
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportPrefilled}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export Pre-filled Client Detail Form
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportBlank}>
          <FileSpreadsheet className="h-4 w-4 mr-2 opacity-50" />
          Download Blank Template
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
