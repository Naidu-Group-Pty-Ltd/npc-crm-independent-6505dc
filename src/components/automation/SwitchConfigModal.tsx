import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SwitchCriteria } from '@/pages/Automation';
import { AlertTriangle, X } from 'lucide-react';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface SwitchConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSwitch: {
    id: string;
    name: string;
    description: string | null;
    is_enabled: boolean;
    priority: number;
    criteria: SwitchCriteria;
  } | null;
  onSaved: () => void;
  existingSwitches: Array<{ id: string; name: string; criteria: SwitchCriteria; is_enabled: boolean }>;
}

const PROPERTY_TYPES = ['House', 'Apartment', 'Townhouse', 'Unit', 'Villa', 'Duplex', 'Land', 'Other'];
const CATEGORIES = ['listing', 'news', 'spec_sheet', 'job_post', 'press_release', 'report', 'other'];
const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

export const SwitchConfigModal = ({ 
  open, 
  onOpenChange, 
  editingSwitch, 
  onSaved,
  existingSwitches 
}: SwitchConfigModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(0);
  const [saving, setSaving] = useState(false);
  
  // Criteria state
  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const [bedsMin, setBedsMin] = useState<string>('');
  const [bedsMax, setBedsMax] = useState<string>('');
  const [bathsMin, setBathsMin] = useState<string>('');
  const [bathsMax, setBathsMax] = useState<string>('');
  const [states, setStates] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [confidenceMin, setConfidenceMin] = useState<number[]>([0]);
  const [hasPrice, setHasPrice] = useState<boolean | null>(null);
  const [sourceHosts, setSourceHosts] = useState<string>('');

  useEffect(() => {
    if (editingSwitch) {
      setName(editingSwitch.name);
      setDescription(editingSwitch.description || '');
      setPriority(editingSwitch.priority);
      
      const c = editingSwitch.criteria;
      setPropertyTypes(c.propertyTypes || []);
      setPriceMin(c.priceMin?.toString() || '');
      setPriceMax(c.priceMax?.toString() || '');
      setBedsMin(c.bedsMin?.toString() || '');
      setBedsMax(c.bedsMax?.toString() || '');
      setBathsMin(c.bathsMin?.toString() || '');
      setBathsMax(c.bathsMax?.toString() || '');
      setStates(c.states || []);
      setCategories(c.categories || []);
      setConfidenceMin([c.confidenceMin || 0]);
      setHasPrice(c.hasPrice ?? null);
      setSourceHosts(c.sourceHosts?.join(', ') || '');
    } else {
      resetForm();
    }
  }, [editingSwitch, open]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setPriority(0);
    setPropertyTypes([]);
    setPriceMin('');
    setPriceMax('');
    setBedsMin('');
    setBedsMax('');
    setBathsMin('');
    setBathsMax('');
    setStates([]);
    setCategories([]);
    setConfidenceMin([0]);
    setHasPrice(null);
    setSourceHosts('');
  };

  const toggleArrayItem = (arr: string[], item: string, setter: (arr: string[]) => void) => {
    if (arr.includes(item)) {
      setter(arr.filter(i => i !== item));
    } else {
      setter([...arr, item]);
    }
  };

  const buildCriteria = (): SwitchCriteria => {
    const criteria: SwitchCriteria = {};
    
    if (propertyTypes.length > 0) criteria.propertyTypes = propertyTypes;
    if (priceMin) criteria.priceMin = parseInt(priceMin);
    if (priceMax) criteria.priceMax = parseInt(priceMax);
    if (bedsMin) criteria.bedsMin = parseInt(bedsMin);
    if (bedsMax) criteria.bedsMax = parseInt(bedsMax);
    if (bathsMin) criteria.bathsMin = parseInt(bathsMin);
    if (bathsMax) criteria.bathsMax = parseInt(bathsMax);
    if (states.length > 0) criteria.states = states;
    if (categories.length > 0) criteria.categories = categories;
    if (confidenceMin[0] > 0) criteria.confidenceMin = confidenceMin[0];
    if (hasPrice !== null) criteria.hasPrice = hasPrice;
    if (sourceHosts.trim()) {
      criteria.sourceHosts = sourceHosts.split(',').map(s => s.trim()).filter(Boolean);
    }
    
    return criteria;
  };

  const checkConflicts = (): string[] => {
    const currentCriteria = buildCriteria();
    const conflicts: string[] = [];
    
    // Check for potential overlap with other enabled switches
    existingSwitches
      .filter(s => s.is_enabled && s.id !== editingSwitch?.id)
      .forEach(otherSwitch => {
        const other = otherSwitch.criteria;
        let hasOverlap = true;
        
        // Check property types overlap
        if (currentCriteria.propertyTypes?.length && other.propertyTypes?.length) {
          const overlap = currentCriteria.propertyTypes.some(t => other.propertyTypes?.includes(t));
          if (!overlap) hasOverlap = false;
        }
        
        // Check states overlap
        if (currentCriteria.states?.length && other.states?.length) {
          const overlap = currentCriteria.states.some(s => other.states?.includes(s));
          if (!overlap) hasOverlap = false;
        }
        
        // Check categories overlap
        if (currentCriteria.categories?.length && other.categories?.length) {
          const overlap = currentCriteria.categories.some(c => other.categories?.includes(c));
          if (!overlap) hasOverlap = false;
        }
        
        // Check price range overlap
        if (currentCriteria.priceMin && currentCriteria.priceMax && other.priceMin && other.priceMax) {
          const noOverlap = currentCriteria.priceMax < other.priceMin || currentCriteria.priceMin > other.priceMax;
          if (noOverlap) hasOverlap = false;
        }
        
        if (hasOverlap) {
          conflicts.push(otherSwitch.name);
        }
      });
    
    return conflicts;
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Please enter a switch name');
      return;
    }

    setSaving(true);
    const criteria = buildCriteria();

    if (editingSwitch) {
      const { error } = await supabase
        .from('auto_report_switches')
        .update({ 
          name, 
          description: description || null, 
          priority, 
          criteria: JSON.parse(JSON.stringify(criteria))
        })
        .eq('id', editingSwitch.id);
      
      if (error) {
        toast.error('Failed to update switch');
      } else {
        toast.success('Switch updated');
        onSaved();
      }
    } else {
      const { error } = await supabase
        .from('auto_report_switches')
        .insert([{ 
          name, 
          description: description || null, 
          priority, 
          criteria: JSON.parse(JSON.stringify(criteria)),
          is_enabled: false 
        }]);
      
      if (error) {
        toast.error('Failed to create switch');
      } else {
        toast.success('Switch created');
        logActivityDirect({
          actionType: 'automation_switch_created',
          entityType: 'automation_switch',
          entityName: name,
          metadata: { criteriaCount: Object.keys(criteria).length }
        });
        onSaved();
      }
    }
    
    setSaving(false);
  };

  const conflicts = checkConflicts();
  const criteriaCount = Object.keys(buildCriteria()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-hidden rounded-3xl border-border/70 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)/0.92))] p-0 shadow-[0_24px_80px_rgba(15,23,42,0.16)] dark:border-white/10 dark:shadow-black/40 sm:w-auto">
        <DialogHeader className="border-b border-border/60 px-5 py-5 sm:px-6">
          <DialogTitle className="text-xl tracking-tight text-foreground">{editingSwitch ? 'Edit Switch' : 'Create New Switch'}</DialogTitle>
          <DialogDescription className="text-sm leading-5">
            Configure the criteria for auto-generating investment reports
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 overscroll-contain px-5 py-5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] sm:px-6">
          <div className="min-w-0 space-y-5 pr-3">
            {/* Basic Info */}
            <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">Switch identity</p>
                <Badge variant="outline" className="bg-card/70 text-xs">{editingSwitch ? 'Edit Switch' : 'Create New Switch'}</Badge>
              </div>
              <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Switch Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Premium VIC Houses"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe what this switch filters for..."
                  rows={2}
                />
              </div>
            </div>
            </div>

            <Separator />

            <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">Source criteria</p>
                <Badge variant="secondary" className="bg-primary/10 text-xs text-foreground">{criteriaCount} criteria configured</Badge>
              </div>

              {/* Property Type */}
              <div className="space-y-3">
              <Label>Property Types</Label>
              <div className="flex flex-wrap gap-2">
                {PROPERTY_TYPES.map(type => (
                  <Badge
                    key={type}
                    variant={propertyTypes.includes(type) ? 'default' : 'outline'}
                    className="cursor-pointer rounded-full transition-all hover:border-primary/40 hover:bg-primary/10"
                    onClick={() => toggleArrayItem(propertyTypes, type, setPropertyTypes)}
                    aria-label={`Toggle property type ${type}`}
                  >
                    {type}
                    {propertyTypes.includes(type) && <X className="h-3 w-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>

              {/* Price Range */}
              <div className="mt-5 space-y-3">
              <Label>Price Range</Label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Minimum ($)</Label>
                  <Input
                    type="number"
                    value={priceMin}
                    onChange={(e) => setPriceMin(e.target.value)}
                    placeholder="e.g., 400000"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Maximum ($)</Label>
                  <Input
                    type="number"
                    value={priceMax}
                    onChange={(e) => setPriceMax(e.target.value)}
                    placeholder="e.g., 1500000"
                  />
                </div>
              </div>
            </div>

            </div>

            <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">Filter rules</p>
              </div>

              {/* Bedrooms & Bathrooms */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <div className="space-y-3">
                <Label>Bedrooms</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Min</Label>
                    <Input
                      type="number"
                      value={bedsMin}
                      onChange={(e) => setBedsMin(e.target.value)}
                      placeholder="0"
                      min={0}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Max</Label>
                    <Input
                      type="number"
                      value={bedsMax}
                      onChange={(e) => setBedsMax(e.target.value)}
                      placeholder="Any"
                      min={0}
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <Label>Bathrooms</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Min</Label>
                    <Input
                      type="number"
                      value={bathsMin}
                      onChange={(e) => setBathsMin(e.target.value)}
                      placeholder="0"
                      min={0}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Max</Label>
                    <Input
                      type="number"
                      value={bathsMax}
                      onChange={(e) => setBathsMax(e.target.value)}
                      placeholder="Any"
                      min={0}
                    />
                  </div>
                </div>
              </div>
            </div>

              {/* States */}
              <div className="mt-5 space-y-3">
              <Label>States</Label>
              <div className="flex flex-wrap gap-2">
                {STATES.map(state => (
                  <Badge
                    key={state}
                    variant={states.includes(state) ? 'default' : 'outline'}
                    className="cursor-pointer rounded-full transition-all hover:border-primary/40 hover:bg-primary/10"
                    onClick={() => toggleArrayItem(states, state, setStates)}
                    aria-label={`Toggle state ${state}`}
                  >
                    {state}
                    {states.includes(state) && <X className="h-3 w-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>

              {/* Categories */}
              <div className="mt-5 space-y-3">
              <Label>Categories</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => (
                  <Badge
                    key={cat}
                    variant={categories.includes(cat) ? 'default' : 'outline'}
                    className="cursor-pointer rounded-full capitalize transition-all hover:border-primary/40 hover:bg-primary/10"
                    onClick={() => toggleArrayItem(categories, cat, setCategories)}
                    aria-label={`Toggle category ${cat.replace('_', ' ')}`}
                  >
                    {cat.replace('_', ' ')}
                    {categories.includes(cat) && <X className="h-3 w-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>

            </div>

            <div className="rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-foreground">Generation settings</p>
              </div>

              {/* Confidence Score */}
              <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Minimum Confidence Score</Label>
                <span className="text-sm text-muted-foreground">{confidenceMin[0]}%</span>
              </div>
              <Slider
                value={confidenceMin}
                onValueChange={setConfidenceMin}
                max={100}
                step={5}
                className="w-full"
              />
            </div>

              {/* Has Price */}
              <div className="mt-5 space-y-3">
              <Label>Price Requirement</Label>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={hasPrice === true ? 'default' : 'outline'}
                  className="cursor-pointer rounded-full transition-all hover:border-primary/40 hover:bg-primary/10"
                  onClick={() => setHasPrice(hasPrice === true ? null : true)}
                  aria-label="Toggle must have price requirement"
                >
                  Must have price
                </Badge>
                <Badge
                  variant={hasPrice === false ? 'default' : 'outline'}
                  className="cursor-pointer rounded-full transition-all hover:border-primary/40 hover:bg-primary/10"
                  onClick={() => setHasPrice(hasPrice === false ? null : false)}
                  aria-label="Toggle no price required option"
                >
                  No price required
                </Badge>
              </div>
            </div>

              {/* Source Hosts */}
              <div className="mt-5 space-y-2">
              <Label htmlFor="sourceHosts">Source Hosts (comma-separated)</Label>
              <Input
                id="sourceHosts"
                value={sourceHosts}
                onChange={(e) => setSourceHosts(e.target.value)}
                placeholder="e.g., realestate.com.au, domain.com.au"
              />
            </div>

            </div>

            {/* Overlap Info */}
            {conflicts.length > 0 && (
              <div className="rounded-2xl border border-info/25 bg-[linear-gradient(135deg,hsl(var(--info)/0.10),hsl(var(--card)/0.86))] p-4 shadow-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-info mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-medium text-info">Overlapping Criteria</p>
                    <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">
                      This switch has overlapping criteria with: {conflicts.join(', ')}. 
                      Using OR logic, a listing only needs to match one switch to trigger a report.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex flex-col-reverse items-center justify-between gap-3 border-t border-border/60 bg-background/55 px-5 py-4 sm:flex-row sm:px-6">
          <div className="w-full rounded-2xl border border-border/60 bg-card/70 px-3 py-2 text-center text-sm text-muted-foreground sm:w-auto sm:text-left">
            {criteriaCount} criteria configured
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)} aria-label="Cancel switch configuration" className="min-h-[44px] flex-1 border-border/70 bg-background/75 sm:min-h-0 sm:flex-initial">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} aria-label={editingSwitch ? 'Update automation switch' : 'Create automation switch'} className="min-h-[44px] flex-1 bg-primary text-primary-foreground shadow-[0_12px_28px_hsl(var(--primary)/0.18)] hover:bg-primary-hover sm:min-h-0 sm:flex-initial">
              {saving ? 'Saving...' : editingSwitch ? 'Update Switch' : 'Create Switch'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
