import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Loader2, Trash2, Edit, PiggyBank, Car, Wallet, Building, TrendingUp, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName, portalStatCardClassName } from '@/components/portal/PortalSurface';

interface PortalAssetFormProps {
  existingAssets: any[];
  onRefresh: () => void;
}

interface AssetFormData {
  asset_type: string;
  description: string;
  value: number;
  institution_name: string;
  vehicle_type: string;
  make_model: string;
}

const assetTypeOptions = [
  { value: 'vehicle', label: 'Vehicle', icon: Car },
  { value: 'savings', label: 'Savings/Deposit', icon: Wallet },
  { value: 'superfund', label: 'Superfund', icon: Building },
  { value: 'alternative', label: 'Alternative', icon: TrendingUp },
  { value: 'other', label: 'Other', icon: PiggyBank },
];

const vehicleTypeOptions = [
  { value: 'car', label: 'Car' }, { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'boat', label: 'Boat' }, { value: 'caravan', label: 'Caravan' }, { value: 'other', label: 'Other' },
];

const alternativeAssetOptions = [
  { value: 'cryptocurrency', label: 'Cryptocurrency' }, { value: 'hedge_fund', label: 'Hedge Fund' },
  { value: 'forex', label: 'Forex' }, { value: 'private_equity', label: 'Private Equity' },
  { value: 'commodities', label: 'Commodities' }, { value: 'art_collectibles', label: 'Art & Collectibles' },
  { value: 'precious_metals', label: 'Precious Metals' }, { value: 'real_estate_fund', label: 'REITs' },
  { value: 'other', label: 'Other' },
];

const defaultFormData: AssetFormData = {
  asset_type: 'vehicle', description: '', value: 0, institution_name: '', vehicle_type: 'car', make_model: '',
};

const fmt = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

export function PortalAssetForm({ existingAssets, onRefresh }: PortalAssetFormProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<AssetFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const updateData = usePortalUpdateData();

  const updateField = useCallback((field: keyof AssetFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => { setFormData(defaultFormData); setEditingId(null); };

  const startEdit = (a: any) => {
    setFormData({
      asset_type: a.asset_type || 'other',
      description: a.description || '',
      value: a.value || 0,
      institution_name: a.institution_name || '',
      vehicle_type: a.vehicle_type || 'car',
      make_model: a.make_model || '',
    });
    setEditingId(a.id);
  };

  const handleSubmit = async () => {
    if (formData.value <= 0) { toast.error('Please enter a value'); return; }
    setSaving(true);
    try {
      await updateData.mutateAsync({
        operation: editingId ? 'update' : 'insert',
        table: 'client_assets',
        data: {
          asset_type: formData.asset_type,
          description: formData.description || null,
          value: formData.value,
          institution_name: formData.institution_name || null,
          vehicle_type: ['vehicle', 'alternative'].includes(formData.asset_type) ? formData.vehicle_type : null,
          make_model: formData.asset_type === 'vehicle' ? formData.make_model : null,
        },
        id: editingId || undefined,
      });
      toast.success(editingId ? 'Asset updated' : 'Asset added');
      resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save asset');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await updateData.mutateAsync({ operation: 'delete', table: 'client_assets', id });
      toast.success('Asset deleted');
      if (editingId === id) resetForm();
      onRefresh();
    } catch (err: any) { toast.error(err.message || 'Failed to delete'); }
    finally { setDeleting(null); }
  };

  const getAssetLabel = (a: any) => {
    if (a.asset_type === 'vehicle') return a.make_model || 'Vehicle';
    if (a.asset_type === 'savings') return a.institution_name || 'Savings/Deposit';
    if (a.asset_type === 'superfund') return a.institution_name || 'Superfund';
    if (a.asset_type === 'alternative') {
      const opt = alternativeAssetOptions.find(o => o.value === a.vehicle_type);
      return opt?.label || 'Alternative';
    }
    return a.description || 'Other Asset';
  };
  const getTypeLabel = (t: string) => assetTypeOptions.find(o => o.value === t)?.label || t;
  const getIcon = (t: string) => { const opt = assetTypeOptions.find(o => o.value === t); const Icon = opt?.icon || PiggyBank; return <Icon className="h-4 w-4" />; };

  const totalValue = existingAssets.reduce((s, a) => s + (a.value || 0), 0);

  return (
    <div className="space-y-4">
      {existingAssets.length > 0 ? (
        <div className="space-y-3">
          <Card className={portalStatCardClassName()}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Asset Value</p>
              <p className="text-xl font-bold text-success">{fmt(totalValue)}</p>
            </CardContent>
          </Card>

          {existingAssets.map((a) => (
            <Card key={a.id} className={portalPanelClassName()}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {getIcon(a.asset_type)}
                      <span className="text-sm font-medium">{getAssetLabel(a)}</span>
                      <Badge variant="outline" className="text-xs">{getTypeLabel(a.asset_type)}</Badge>
                    </div>
                    <p className="text-sm font-medium text-success mt-1">{fmt(a.value || 0)}</p>
                    {a.institution_name && a.asset_type !== 'superfund' && (
                      <p className="text-xs text-muted-foreground">{a.institution_name}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { startEdit(a); setOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={deleting === a.id} onClick={() => handleDelete(a.id)}>
                      {deleting === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<PiggyBank className="h-8 w-8" />}
          title="No assets recorded yet"
          description="Add your assets to keep your balance sheet complete and give your advisor a clearer financial picture."
        />
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full gap-2"><Plus className="h-4 w-4" />Add Asset</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PiggyBank className="h-5 w-5" />{editingId ? 'Edit Asset' : 'Add Asset'}</DialogTitle>
            <DialogDescription>Record a personal asset</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs">Asset Type *</Label>
              <Select value={formData.asset_type} onValueChange={(v) => { updateField('asset_type', v); if (v !== formData.asset_type) { setFormData(prev => ({ ...prev, asset_type: v })); } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {assetTypeOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex items-center gap-2"><o.icon className="h-4 w-4" />{o.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.asset_type === 'vehicle' && (
              <>
                <div className="space-y-2">
                  <Label className="text-xs">Vehicle Type</Label>
                  <Select value={formData.vehicle_type} onValueChange={(v) => updateField('vehicle_type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {vehicleTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Make & Model</Label>
                  <Input value={formData.make_model} onChange={(e) => updateField('make_model', e.target.value)} placeholder="Toyota Camry 2020" />
                </div>
              </>
            )}

            {formData.asset_type === 'alternative' && (
              <div className="space-y-2">
                <Label className="text-xs">Alternative Asset Type</Label>
                <Select value={formData.vehicle_type} onValueChange={(v) => updateField('vehicle_type', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {alternativeAssetOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {['savings', 'superfund', 'alternative'].includes(formData.asset_type) && (
              <div className="space-y-2">
                <Label className="text-xs">{formData.asset_type === 'superfund' ? 'Superfund Institution' : 'Institution / Provider'}</Label>
                <Input value={formData.institution_name} onChange={(e) => updateField('institution_name', e.target.value)} placeholder={formData.asset_type === 'superfund' ? 'Australian Super' : 'Institution name'} />
              </div>
            )}

            {['alternative', 'other'].includes(formData.asset_type) && (
              <div className="space-y-2">
                <Label className="text-xs">Description</Label>
                <Input value={formData.description} onChange={(e) => updateField('description', e.target.value)} placeholder="Brief description" />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">Value *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" value={formData.value || ''} onChange={(e) => updateField('value', parseFloat(e.target.value) || 0)} className="pl-7" placeholder="0" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {editingId && <Button variant="outline" onClick={resetForm}>Cancel Edit</Button>}
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Update Asset' : 'Add Asset'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
