import { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, PiggyBank, Loader2, Trash2, Edit, Car, Wallet, Building, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface AssetManualEntryProps {
  clientId: string;
  onComplete: () => void;
}

interface AssetFormData {
  id?: string;
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
  { value: 'car', label: 'Car' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'boat', label: 'Boat' },
  { value: 'caravan', label: 'Caravan' },
  { value: 'other', label: 'Other' },
];

const alternativeAssetOptions = [
  { value: 'cryptocurrency', label: 'Cryptocurrency' },
  { value: 'hedge_fund', label: 'Hedge Fund' },
  { value: 'forex', label: 'Foreign Exchange (Forex)' },
  { value: 'private_equity', label: 'Private Equity' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'art_collectibles', label: 'Art & Collectibles' },
  { value: 'precious_metals', label: 'Precious Metals' },
  { value: 'venture_capital', label: 'Venture Capital' },
  { value: 'real_estate_fund', label: 'Real Estate Fund (REITs)' },
  { value: 'options_derivatives', label: 'Options & Derivatives' },
  { value: 'other', label: 'Other Alternative' },
];

const defaultFormData: AssetFormData = {
  asset_type: 'vehicle',
  description: '',
  value: 0,
  institution_name: '',
  vehicle_type: 'car',
  make_model: '',
};

import { invokeSecureFunction } from '@/lib/secureInvoke';

export function AssetManualEntry({ clientId, onComplete }: AssetManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('vehicle');
  const [formData, setFormData] = useState<AssetFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch existing assets with secure Edge Function (HttpOnly cookies)
  const { data: existingAssets = [] } = useQuery({
    queryKey: ['client-assets', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { assets: true },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch assets');
      return data.assets || [];
    },
  });

  const vehicleAssets = existingAssets.filter(a => a.asset_type === 'vehicle');
  const savingsAssets = existingAssets.filter(a => a.asset_type === 'savings');
  const superfundAssets = existingAssets.filter(a => a.asset_type === 'superfund');
  const alternativeAssets = existingAssets.filter(a => a.asset_type === 'alternative');
  const otherAssets = existingAssets.filter(a => a.asset_type === 'other');

  const updateField = useCallback((field: keyof AssetFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => {
    setFormData({ ...defaultFormData, asset_type: activeTab });
    setEditingId(null);
  };

  const startEdit = (asset: any) => {
    setFormData({
      id: asset.id,
      asset_type: asset.asset_type,
      description: asset.description || '',
      value: asset.value || 0,
      institution_name: asset.institution_name || '',
      vehicle_type: asset.vehicle_type || 'car',
      make_model: asset.make_model || '',
    });
    setEditingId(asset.id);
    setActiveTab(asset.asset_type);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        asset_type: formData.asset_type,
        description: formData.description || null,
        value: formData.value,
        institution_name: formData.institution_name || null,
        vehicle_type: formData.asset_type === 'vehicle' || formData.asset_type === 'alternative' ? formData.vehicle_type : null,
        make_model: formData.asset_type === 'vehicle' ? formData.make_model : null,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: editingId ? 'update' : 'create',
        table: 'client_assets',
        clientId,
        recordId: editingId,
        data: payload,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save asset');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-assets', clientId] });
      toast.success(editingId ? 'Asset updated' : 'Asset added');
      resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to save asset: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_assets',
        clientId,
        recordId: id,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete asset');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-assets', clientId] });
      toast.success('Asset deleted');
      if (editingId) resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to delete: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (formData.value <= 0) {
      toast.error('Please enter a value');
      return;
    }
    saveMutation.mutate();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalAssetValue = existingAssets.reduce((sum, a) => sum + (a.value || 0), 0);

  const getAlternativeAssetLabel = (vehicleType: string | null) => {
    const option = alternativeAssetOptions.find(o => o.value === vehicleType);
    return option?.label || vehicleType || 'Alternative Asset';
  };

  const AssetCard = ({ asset }: { asset: any }) => (
    <Card className="mb-2">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">
                {asset.asset_type === 'vehicle' && asset.make_model}
                {asset.asset_type === 'savings' && 'Savings/Deposit'}
                {asset.asset_type === 'superfund' && (asset.institution_name || 'Superfund')}
                {asset.asset_type === 'alternative' && getAlternativeAssetLabel(asset.vehicle_type)}
                {asset.asset_type === 'other' && (asset.description || 'Other Asset')}
              </span>
            </div>
            {asset.asset_type === 'vehicle' && (
              <p className="text-sm text-muted-foreground">{asset.vehicle_type}</p>
            )}
            {asset.asset_type === 'alternative' && asset.description && (
              <p className="text-sm text-muted-foreground">{asset.description}</p>
            )}
            {asset.institution_name && asset.asset_type !== 'superfund' && (
              <p className="text-sm text-muted-foreground">{asset.institution_name}</p>
            )}
            <p className="text-sm font-medium text-success mt-1">
              {formatCurrency(asset.value || 0)}
            </p>
          </div>
          <div className="flex gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => startEdit(asset)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-destructive"
              onClick={() => deleteMutation.mutate(asset.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const getAssetLabel = (asset: any) => {
    if (asset.asset_type === 'vehicle') return asset.make_model || 'Vehicle';
    if (asset.asset_type === 'savings') return asset.institution_name || 'Savings/Deposit';
    if (asset.asset_type === 'superfund') return asset.institution_name || 'Superfund';
    if (asset.asset_type === 'alternative') return getAlternativeAssetLabel(asset.vehicle_type);
    return asset.description || 'Other Asset';
  };

  // Vehicle form JSX (inline to prevent focus loss from component remounting)
  const vehicleFormJSX = (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Car className="h-4 w-4" />
          {editingId ? 'Edit Vehicle' : 'Add Vehicle'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Vehicle Type</Label>
          <Select
            value={formData.vehicle_type}
            onValueChange={(v) => updateField('vehicle_type', v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {vehicleTypeOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Make and Model</Label>
          <Input
            value={formData.make_model}
            onChange={(e) => updateField('make_model', e.target.value)}
            placeholder="Toyota Camry 2020"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Value</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              value={formData.value || ''}
              onChange={(e) => updateField('value', parseFloat(e.target.value) || 0)}
              className="pl-7"
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {editingId && (
            <Button variant="outline" onClick={resetForm} className="flex-1">
              Cancel
            </Button>
          )}
          <Button 
            onClick={handleSubmit} 
            disabled={saveMutation.isPending}
            className="flex-1"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editingId ? 'Update' : 'Add Vehicle'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // Savings form JSX
  const savingsFormJSX = (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          {editingId ? 'Edit Savings' : 'Add Savings/Deposit'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Institution Name</Label>
          <Input
            value={formData.institution_name}
            onChange={(e) => updateField('institution_name', e.target.value)}
            placeholder="Commonwealth Bank"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Savings Amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              value={formData.value || ''}
              onChange={(e) => updateField('value', parseFloat(e.target.value) || 0)}
              className="pl-7"
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {editingId && (
            <Button variant="outline" onClick={resetForm} className="flex-1">
              Cancel
            </Button>
          )}
          <Button 
            onClick={handleSubmit} 
            disabled={saveMutation.isPending}
            className="flex-1"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editingId ? 'Update' : 'Add Savings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // Superfund form JSX
  const superfundFormJSX = (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Building className="h-4 w-4" />
          {editingId ? 'Edit Superfund' : 'Add Superfund'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Superfund Institution</Label>
          <Input
            value={formData.institution_name}
            onChange={(e) => updateField('institution_name', e.target.value)}
            placeholder="Australian Super"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Value</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              value={formData.value || ''}
              onChange={(e) => updateField('value', parseFloat(e.target.value) || 0)}
              className="pl-7"
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {editingId && (
            <Button variant="outline" onClick={resetForm} className="flex-1">
              Cancel
            </Button>
          )}
          <Button 
            onClick={handleSubmit} 
            disabled={saveMutation.isPending}
            className="flex-1"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editingId ? 'Update' : 'Add Superfund'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // Alternative/Other form JSX
  const alternativeFormJSX = (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {editingId ? 'Edit Alternative Asset' : 'Add Alternative Asset'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Asset Type</Label>
          <Select
            value={formData.vehicle_type}
            onValueChange={(v) => updateField('vehicle_type', v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {alternativeAssetOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Platform/Provider (Optional)</Label>
          <Input
            value={formData.institution_name}
            onChange={(e) => updateField('institution_name', e.target.value)}
            placeholder="e.g., Coinbase, Binance, BlackRock"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Description (Optional)</Label>
          <Input
            value={formData.description}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="e.g., Bitcoin holdings, Gold ETF"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Value</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              value={formData.value || ''}
              onChange={(e) => updateField('value', parseFloat(e.target.value) || 0)}
              className="pl-7"
              placeholder="0"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {editingId && (
            <Button variant="outline" onClick={resetForm} className="flex-1">
              Cancel
            </Button>
          )}
          <Button 
            onClick={handleSubmit} 
            disabled={saveMutation.isPending}
            className="flex-1"
          >
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editingId ? 'Update' : 'Add Asset'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Assets Summary Display */}
      {existingAssets.length > 0 ? (
        <div className="space-y-2">
          <Card className="bg-success/10 border-success/30">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-2">
                <PiggyBank className="h-4 w-4 text-success" />
                <span className="font-medium text-success">Total Assets</span>
              </div>
              <p className="text-2xl font-bold text-success">{formatCurrency(totalAssetValue)}</p>
            </CardContent>
          </Card>
          
          {existingAssets.map(asset => (
            <Card key={asset.id}>
              <CardContent className="pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{getAssetLabel(asset)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{asset.asset_type}</p>
                  </div>
                  <p className="font-medium text-success">{formatCurrency(asset.value || 0)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground">
          <PiggyBank className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No assets recorded</p>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            {existingAssets.length > 0 ? 'Edit Assets' : 'Add Asset'}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <PiggyBank className="h-5 w-5" />
              Financial Details (Assets)
            </SheetTitle>
          <SheetDescription>
            Manage vehicles, savings, superfund, and alternative assets
          </SheetDescription>
          </SheetHeader>

          {/* Total Summary */}
          <Card className="bg-muted/50 border-0 mt-4">
            <CardContent className="pt-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Assets Value</span>
                <span className="text-lg font-bold text-success">
                  {formatCurrency(totalAssetValue)}
                </span>
              </div>
            </CardContent>
          </Card>

          <ScrollArea className="h-[calc(100vh-280px)] pr-4 mt-4">
            <Tabs value={activeTab} onValueChange={(v) => {
              setActiveTab(v);
              setFormData(prev => ({ ...prev, asset_type: v }));
              setEditingId(null);
            }}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="vehicle">Vehicles</TabsTrigger>
                <TabsTrigger value="savings">Savings</TabsTrigger>
                <TabsTrigger value="superfund">Super</TabsTrigger>
                <TabsTrigger value="alternative">Others</TabsTrigger>
              </TabsList>

              <TabsContent value="vehicle" className="space-y-4 mt-4">
                {vehicleAssets.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Existing Vehicles</Label>
                    {vehicleAssets.map(asset => (
                      <AssetCard key={asset.id} asset={asset} />
                    ))}
                  </div>
                )}
                {vehicleFormJSX}
              </TabsContent>

              <TabsContent value="savings" className="space-y-4 mt-4">
                {savingsAssets.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Existing Savings</Label>
                    {savingsAssets.map(asset => (
                      <AssetCard key={asset.id} asset={asset} />
                    ))}
                  </div>
                )}
                {savingsFormJSX}
              </TabsContent>

              <TabsContent value="superfund" className="space-y-4 mt-4">
                {superfundAssets.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Existing Superfunds</Label>
                    {superfundAssets.map(asset => (
                      <AssetCard key={asset.id} asset={asset} />
                    ))}
                  </div>
                )}
                {superfundFormJSX}
              </TabsContent>

              <TabsContent value="alternative" className="space-y-4 mt-4">
                {alternativeAssets.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Alternative Investments</Label>
                    {alternativeAssets.map(asset => (
                      <AssetCard key={asset.id} asset={asset} />
                    ))}
                  </div>
                )}
                {alternativeFormJSX}
              </TabsContent>
            </Tabs>
          </ScrollArea>

          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); onComplete(); }}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
