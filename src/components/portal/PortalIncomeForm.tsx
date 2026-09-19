import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { IncomeSourceForm } from '@/components/clients/income/IncomeSourceForm';
import { IncomeSourceCard } from '@/components/clients/income/IncomeSourceCard';
import {
  IncomeSource,
  getSourceTotalAnnual,
  formatCurrency,
} from '@/components/clients/income/incomeSourceTypes';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName } from '@/components/portal/PortalSurface';

interface PortalIncomeFormProps {
  existingIncome: IncomeSource[];
  onRefresh: () => void;
}

export function PortalIncomeForm({ existingIncome, onRefresh }: PortalIncomeFormProps) {
  const [editingSource, setEditingSource] = useState<IncomeSource | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const mutation = usePortalUpdateData();

  // Filter out employment-linked sources (read-only)
  const employmentSources = useMemo(() => existingIncome.filter((s: any) => s.employment_id), [existingIncome]);
  const standaloneSources = useMemo(() => existingIncome.filter((s: any) => !s.employment_id), [existingIncome]);
  const combinedTotal = useMemo(() => existingIncome.reduce((sum, s) => sum + getSourceTotalAnnual(s), 0), [existingIncome]);

  const showForm = isAdding || editingSource !== null;

  const handleSave = async (source: IncomeSource) => {
    const { id, client_id, ...payload } = source;
    payload.contact_type = 'primary';

    try {
      await mutation.mutateAsync({
        operation: id ? 'update' : 'insert',
        table: 'client_income_sources',
        id: id || undefined,
        data: payload,
      });
      toast.success('Income source saved');
      setEditingSource(null);
      setIsAdding(false);
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDelete = async (sourceId: string) => {
    try {
      await mutation.mutateAsync({ operation: 'delete', table: 'client_income_sources', id: sourceId });
      toast.success('Income source removed');
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  };

  if (showForm) {
    return (
      <IncomeSourceForm
        source={editingSource || undefined}
        contactType="primary"
        onSave={handleSave}
        onCancel={() => { setEditingSource(null); setIsAdding(false); }}
        isPending={mutation.isPending}
        hideEmploymentCategory
        hideShading
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Summary */}
      {existingIncome.length > 0 && (
        <Card className={portalPanelClassName('border-success/20 bg-success/10')}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-success" />
              <span className="font-medium text-success">Total Income</span>
            </div>
            <p className="text-2xl font-bold text-success">{formatCurrency(combinedTotal)}/year</p>
            <p className="text-sm text-muted-foreground">
              {formatCurrency(combinedTotal / 12)}/month • {existingIncome.length} source{existingIncome.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Employment-linked (read-only) */}
      {employmentSources.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From Employment</p>
          {employmentSources.map((source: any) => (
            <IncomeSourceCard
              key={source.id}
              source={source}
              onEdit={() => {}}
              onDelete={() => {}}
              isLinkedToEmployment
              hideShading
            />
          ))}
        </div>
      )}

      {/* Standalone sources */}
      {standaloneSources.length > 0 && (
        <div className="space-y-2">
          {employmentSources.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-4">Other Income</p>
          )}
          {standaloneSources.map((source: any) => (
            <IncomeSourceCard
              key={source.id}
              source={source}
              onEdit={() => setEditingSource(source)}
              onDelete={() => source.id && handleDelete(source.id)}
              hideShading
            />
          ))}
        </div>
      )}

      {existingIncome.length === 0 && (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<DollarSign className="h-8 w-8" />}
          title="No income sources yet"
          description="Add income sources to keep your financial profile up to date for reporting and borrowing assessments."
        />
      )}

      <Button variant="outline" size="sm" className="w-full" onClick={() => setIsAdding(true)}>
        <Plus className="h-4 w-4 mr-2" />
        Add Income Source
      </Button>
    </div>
  );
}
