import { Filter, X, Search, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { getFullStateName } from '@/lib/states';
// One shape for the predicate and both panels — see @/lib/listingFilters.
import {
  DEFAULT_LISTING_FILTERS,
  LISTED_WITHIN_OPTIONS,
  activeListingFilterCount,
  type ListingFilterState as FilterState,
} from '@/lib/listingFilters';

import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/SearchableSelect';


interface MobileFilterSheetProps {
  filters: FilterState;
  setFilters: (filters: FilterState) => void;
  uniqueValues: {
    propertyTypes: string[];
    suburbs: string[];
    states: string[];
    zipCodes: string[];
    sourceHosts: string[];
    agencies: string[];
    /** Optional: present once the projection reads the columns they live in. */
    intents?: string[];
    sectors?: string[];
  };
}

export function MobileFilterSheet({ filters, setFilters, uniqueValues }: MobileFilterSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters);

  // Counted by the one authority both panels share, so the badge can only ever
  // name filters that are actually narrowing the set.
  const activeFilterCount = activeListingFilterCount(filters);


  const handleOpen = (open: boolean) => {
    if (open) {
      setLocalFilters(filters);
    }
    setIsOpen(open);
  };

  const handleApply = () => {
    setFilters(localFilters);
    setIsOpen(false);
  };

  const handleClear = () => {
    const clearedFilters: FilterState = { ...DEFAULT_LISTING_FILTERS };
    setLocalFilters(clearedFilters);
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-10 rounded-full border-border/70 bg-background/90 px-4 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-400/60 hover:bg-brand-50/80 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400/35 dark:border-white/10 dark:bg-background/55 dark:hover:bg-brand-400/10 dark:hover:text-brand-200 gap-2">
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <Badge variant="default" className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 p-0 text-xs text-foreground dark:text-white shadow-sm">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-xl">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <SheetTitle>Filters</SheetTitle>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              <X className="h-4 w-4 mr-1" />
              Clear all
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(85vh-140px)] pr-4">
          <div className="space-y-6">
            {/* Keyword Search */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" />
                Keyword Search
              </Label>
              <Input
                placeholder="e.g. study, pool, granny flat..."
                value={localFilters.keywordSearch}
                onChange={(e) => setLocalFilters({ ...localFilters, keywordSearch: e.target.value })}
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Searches descriptions, summaries &amp; features
              </p>
            </div>

            <Separator />

            {/* Property Type */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Property Type</Label>
              <Select
                value={localFilters.propertyType}
                onValueChange={(value) => setLocalFilters({ ...localFilters, propertyType: value })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {uniqueValues.propertyTypes.filter(t => t?.trim()).map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Location Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Location</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-sm">State</Label>
                  <Select
                    value={localFilters.state}
                    onValueChange={(value) => setLocalFilters({ ...localFilters, state: value })}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All states</SelectItem>
                      {uniqueValues.states.filter(s => s?.trim()).map((state) => (
                        <SelectItem key={state} value={state}>{getFullStateName(state)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm">Postcode</Label>
                  <SearchableSelect
                    value={localFilters.zipCode}
                    onValueChange={(value) => setLocalFilters({ ...localFilters, zipCode: value })}
                    options={uniqueValues.zipCodes.filter(z => z?.trim())}
                    placeholder="All postcodes"
                    allLabel="All postcodes"
                    triggerClassName="h-11"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Suburb</Label>
                  {localFilters.suburb && localFilters.suburb !== 'all' && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <Label htmlFor="nearby-toggle-mobile" className="text-xs text-muted-foreground cursor-pointer">
                        Include nearby
                      </Label>
                      <Switch
                        id="nearby-toggle-mobile"
                        checked={localFilters.includeNearbySuburbs}
                        onCheckedChange={(checked) => setLocalFilters({ ...localFilters, includeNearbySuburbs: checked })}
                        className="scale-75"
                      />
                    </div>
                  )}
                </div>
                <SearchableSelect
                  value={localFilters.suburb}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, suburb: value, includeNearbySuburbs: false })}
                  options={uniqueValues.suburbs.filter(s => s?.trim())}
                  placeholder="All suburbs"
                  allLabel="All suburbs"
                  triggerClassName="h-11"
                />
                {localFilters.includeNearbySuburbs && localFilters.suburb && localFilters.suburb !== 'all' && (
                  <p className="text-xs text-muted-foreground">
                    Will also show listings from surrounding suburbs
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* Listed within */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Listed within</Label>
              <Select
                value={localFilters.listedWithinDays}
                onValueChange={(value) => setLocalFilters({ ...localFilters, listedWithinDays: value })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LISTED_WITHIN_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Only show */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Only show</Label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Listings with photos</span>
                <Switch
                  checked={localFilters.hasPhotos}
                  onCheckedChange={(checked) => setLocalFilters({ ...localFilters, hasPhotos: checked })}
                  aria-label="Only listings with photos"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Listings that can be mapped</span>
                <Switch
                  checked={localFilters.mappableOnly}
                  onCheckedChange={(checked) => setLocalFilters({ ...localFilters, mappableOnly: checked })}
                  aria-label="Only listings that can be mapped"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Include undisclosed prices</span>
                <Switch
                  checked={localFilters.includeUndisclosedPrice}
                  onCheckedChange={(checked) =>
                    setLocalFilters({ ...localFilters, includeUndisclosedPrice: checked })
                  }
                  aria-label="Include listings with undisclosed prices in a price range"
                />
              </div>
            </div>

            <Separator />

            {/* Land size */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Land size (m²)</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Min"
                  type="number"
                  inputMode="numeric"
                  value={localFilters.landSizeMin}
                  onChange={(e) => setLocalFilters({ ...localFilters, landSizeMin: e.target.value })}
                  className="h-11"
                />
                <Input
                  placeholder="Max"
                  type="number"
                  inputMode="numeric"
                  value={localFilters.landSizeMax}
                  onChange={(e) => setLocalFilters({ ...localFilters, landSizeMax: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>

            <Separator />

            {/* Price Range */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Price Range</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Min price"
                  type="number"
                  inputMode="numeric"
                  value={localFilters.priceMin}
                  onChange={(e) => setLocalFilters({ ...localFilters, priceMin: e.target.value })}
                  className="h-11"
                />
                <Input
                  placeholder="Max price"
                  type="number"
                  inputMode="numeric"
                  value={localFilters.priceMax}
                  onChange={(e) => setLocalFilters({ ...localFilters, priceMax: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>

            {/* Property Features */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Features</h4>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Beds (min)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={localFilters.bedsMin}
                    onChange={(e) => setLocalFilters({ ...localFilters, bedsMin: e.target.value })}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Baths (min)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={localFilters.bathsMin}
                    onChange={(e) => setLocalFilters({ ...localFilters, bathsMin: e.target.value })}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Cars (min)</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={localFilters.carsMin}
                    onChange={(e) => setLocalFilters({ ...localFilters, carsMin: e.target.value })}
                    className="h-11"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Agency & Source */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">Agency</Label>
                <Select
                  value={localFilters.agencyName}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, agencyName: value })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="All agencies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agencies</SelectItem>
                    {uniqueValues.agencies.filter(a => a?.trim()).map((agency) => (
                      <SelectItem key={agency} value={agency}>{agency}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Source</Label>
                <Select
                  value={localFilters.sourceHost}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, sourceHost: value })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="All sources" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    {uniqueValues.sourceHosts.filter(s => s?.trim()).map((source) => (
                      <SelectItem key={source} value={source}>{source}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Quick Filters */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Filters</h4>
              
              <div className="space-y-3">
                <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.hasInspection}
                    onCheckedChange={(checked) => 
                      setLocalFilters({ ...localFilters, hasInspection: !!checked })
                    }
                  />
                  <span className="text-sm font-medium">Has inspection scheduled</span>
                </label>
                
                <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.lowConfidence}
                    onCheckedChange={(checked) => 
                      setLocalFilters({ ...localFilters, lowConfidence: !!checked })
                    }
                  />
                  <span className="text-sm font-medium">Low confidence only</span>
                </label>
                
                <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.offMarket}
                    onCheckedChange={(checked) => 
                      setLocalFilters({ ...localFilters, offMarket: !!checked })
                    }
                  />
                  <span className="text-sm font-medium">Off-market properties</span>
                </label>
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="pt-4 border-t border-border">
          <Button onClick={handleApply} className="w-full h-12 text-base">
            Apply Filters
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
