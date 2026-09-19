import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { Filter, X, Search, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { getFullStateName } from '@/lib/states';
// One shape for the predicate and both panels — see @/lib/listingFilters.
import {
  DEFAULT_LISTING_FILTERS,
  LISTED_WITHIN_OPTIONS,
  activeListingFilterCount,
  type ListingFilterState as FilterState,
} from '@/lib/listingFilters';



interface ListingFiltersProps {
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

export function ListingFilters({ filters, setFilters, uniqueValues }: ListingFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters);

  // One authority for "how many filters are narrowing this set" — see
  // `activeListingFilterCount`. The previous inline count treated every
  // categorical default of `'all'` outside a short whitelist as a live filter,
  // so `status`, `listedWithinDays`, `intent`, `sector`, `packageType` and
  // `sourceType` contributed a permanent phantom 6 on a page with nothing set.
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
    setLocalFilters({ ...DEFAULT_LISTING_FILTERS });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-10 rounded-full border-border/70 bg-background/90 px-4 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-400/60 hover:bg-brand-50/80 hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-400/35 dark:border-white/10 dark:bg-background/55 dark:hover:bg-brand-400/10 dark:hover:text-brand-200">
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 p-0 text-xs text-foreground dark:text-white shadow-sm">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <DialogTitle>Filter Listings</DialogTitle>
            <Button variant="ghost" size="sm" onClick={handleClear} className="mr-8">
              <X className="h-4 w-4 mr-1" />
              Clear all
            </Button>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6">
          <div className="space-y-6 pb-6">
            {/* Keyword Search - full width */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 font-medium">
                <Search className="h-3.5 w-3.5" />
                Keyword Search
              </Label>
              <Input
                placeholder="e.g. study, pool, granny flat..."
                value={localFilters.keywordSearch}
                onChange={(e) => setLocalFilters({ ...localFilters, keywordSearch: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Searches listing descriptions, summaries &amp; extracted features. Separate multiple keywords with spaces.
              </p>
            </div>

            <Separator />

            {/* Two-column grid for dropdowns */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {/* Property Type */}
              <div className="space-y-2">
                <Label className="font-medium">Property Type</Label>
                <Select
                  value={localFilters.propertyType}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, propertyType: value })}
                >
                  <SelectTrigger>
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

              {/* State */}
              <div className="space-y-2">
                <Label className="font-medium">State</Label>
                <Select
                  value={localFilters.state}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, state: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All states" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All states</SelectItem>
                    {uniqueValues.states.filter(s => s?.trim()).map((state) => (
                      <SelectItem key={state} value={state}>{getFullStateName(state)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Suburb */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Suburb</Label>
                  {localFilters.suburb && localFilters.suburb !== 'all' && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <Label htmlFor="nearby-toggle-modal" className="text-xs text-muted-foreground cursor-pointer">
                        Include nearby
                      </Label>
                      <Switch
                        id="nearby-toggle-modal"
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
                  contentClassName="flex max-h-[min(320px,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
                  optionsClassName="max-h-[min(280px,calc(var(--radix-popover-content-available-height)-44px))] min-h-0 flex-1"
                />
                {localFilters.includeNearbySuburbs && localFilters.suburb && localFilters.suburb !== 'all' && (
                  <p className="text-xs text-muted-foreground">
                    Will also show listings from surrounding suburbs (±15 postcodes)
                  </p>
                )}
              </div>

              {/* Postcode */}
              <div className="space-y-2">
                <Label className="font-medium">Postcode</Label>
                <SearchableSelect
                  value={localFilters.zipCode}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, zipCode: value })}
                  options={uniqueValues.zipCodes.filter(z => z?.trim())}
                  placeholder="All postcodes"
                  allLabel="All postcodes"
                  contentClassName="flex max-h-[min(320px,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
                  optionsClassName="max-h-[min(280px,calc(var(--radix-popover-content-available-height)-44px))] min-h-0 flex-1"
                />
              </div>
            </div>

            <Separator />

            {/* Price & Features */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Price &amp; Features</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                {/* Price Range */}
                <div className="space-y-2">
                  <Label>Price Range</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      value={localFilters.priceMin}
                      onChange={(e) => setLocalFilters({ ...localFilters, priceMin: e.target.value })}
                    />
                    <Input
                      placeholder="Max"
                      type="number"
                      value={localFilters.priceMax}
                      onChange={(e) => setLocalFilters({ ...localFilters, priceMax: e.target.value })}
                    />
                  </div>
                </div>

                {/* Bedrooms */}
                <div className="space-y-2">
                  <Label>Bedrooms</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      value={localFilters.bedsMin}
                      onChange={(e) => setLocalFilters({ ...localFilters, bedsMin: e.target.value })}
                    />
                    <Input
                      placeholder="Max"
                      type="number"
                      value={localFilters.bedsMax}
                      onChange={(e) => setLocalFilters({ ...localFilters, bedsMax: e.target.value })}
                    />
                  </div>
                </div>

                {/* Bathrooms */}
                <div className="space-y-2">
                  <Label>Bathrooms</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      value={localFilters.bathsMin}
                      onChange={(e) => setLocalFilters({ ...localFilters, bathsMin: e.target.value })}
                    />
                    <Input
                      placeholder="Max"
                      type="number"
                      value={localFilters.bathsMax}
                      onChange={(e) => setLocalFilters({ ...localFilters, bathsMax: e.target.value })}
                    />
                  </div>
                </div>

                {/* Car Spaces */}
                <div className="space-y-2">
                  <Label>Car Spaces</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      value={localFilters.carsMin}
                      onChange={(e) => setLocalFilters({ ...localFilters, carsMin: e.target.value })}
                    />
                    <Input
                      placeholder="Max"
                      type="number"
                      value={localFilters.carsMax}
                      onChange={(e) => setLocalFilters({ ...localFilters, carsMax: e.target.value })}
                    />
                  </div>

                {/* Land size */}
                <div className="space-y-2">
                  <Label>Land size (m²)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      inputMode="numeric"
                      value={localFilters.landSizeMin}
                      onChange={(e) => setLocalFilters({ ...localFilters, landSizeMin: e.target.value })}
                    />
                    <Input
                      placeholder="Max"
                      type="number"
                      inputMode="numeric"
                      value={localFilters.landSizeMax}
                      onChange={(e) => setLocalFilters({ ...localFilters, landSizeMax: e.target.value })}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Hectares and acres in the source data are converted to m².
                  </p>
                </div>

                {/* Listed within */}
                <div className="space-y-2">
                  <Label>Listed within</Label>
                  <Select
                    value={localFilters.listedWithinDays}
                    onValueChange={(value) => setLocalFilters({ ...localFilters, listedWithinDays: value })}
                  >
                    <SelectTrigger>
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
                  <p className="text-[11px] text-muted-foreground">
                    Listings with no date on record are excluded from a window.
                  </p>
                </div>

                {/* Data-completeness toggles */}
                <div className="space-y-3">
                  <Label>Only show</Label>
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
                    <span className="text-sm">
                      Include undisclosed prices
                      <span className="block text-[11px] text-muted-foreground">
                        Keeps price-less listings inside a price range
                      </span>
                    </span>
                    <Switch
                      checked={localFilters.includeUndisclosedPrice}
                      onCheckedChange={(checked) =>
                        setLocalFilters({ ...localFilters, includeUndisclosedPrice: checked })
                      }
                      aria-label="Include listings with undisclosed prices in a price range"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      Flagged for review
                      <span className="block text-[11px] text-muted-foreground">
                        The pipeline was not confident about these
                      </span>
                    </span>
                    <Switch
                      checked={localFilters.needsReview}
                      onCheckedChange={(checked) => setLocalFilters({ ...localFilters, needsReview: checked })}
                      aria-label="Only listings flagged for human review"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      Conflicting location
                      <span className="block text-[11px] text-muted-foreground">
                        State and postcode disagree with each other
                      </span>
                    </span>
                    <Switch
                      checked={localFilters.localityConflict}
                      onCheckedChange={(checked) =>
                        setLocalFilters({ ...localFilters, localityConflict: checked })
                      }
                      aria-label="Only listings whose state and postcode conflict"
                    />
                  </div>
                </div>

                {/* Dimensions that only became readable once the projection was
                    pointed at the real columns. */}
                <div className="space-y-3">
                  <Label>Listing type</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      value={localFilters.intent}
                      onValueChange={(value) => setLocalFilters({ ...localFilters, intent: value })}
                    >
                      <SelectTrigger aria-label="Intent">
                        <SelectValue placeholder="Sale or rent" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Sale or rent</SelectItem>
                        {(uniqueValues.intents ?? []).map((value) => (
                          <SelectItem key={value} value={value}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={localFilters.sector}
                      onValueChange={(value) => setLocalFilters({ ...localFilters, sector: value })}
                    >
                      <SelectTrigger aria-label="Sector">
                        <SelectValue placeholder="Any sector" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any sector</SelectItem>
                        {(uniqueValues.sectors ?? []).map((value) => (
                          <SelectItem key={value} value={value}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-quality">Minimum data quality</Label>
                  <Input
                    id="min-quality"
                    inputMode="numeric"
                    placeholder="e.g. 70"
                    value={localFilters.minQuality}
                    onChange={(event) =>
                      setLocalFilters({ ...localFilters, minQuality: event.target.value })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Percentage. The pipeline scores every record; listings with no
                    score are excluded once a minimum is set.
                  </p>
                </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Agency & Source */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="space-y-2">
                <Label className="font-medium">Agency</Label>
                <Select
                  value={localFilters.agencyName}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, agencyName: value })}
                >
                  <SelectTrigger>
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
                <Label className="font-medium">Source</Label>
                <Select
                  value={localFilters.sourceHost}
                  onValueChange={(value) => setLocalFilters({ ...localFilters, sourceHost: value })}
                >
                  <SelectTrigger>
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
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Quick Filters</h4>
              <div className="flex flex-wrap gap-3">
                <label className="flex min-w-[180px] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.hasInspection}
                    onCheckedChange={(checked) => setLocalFilters({ ...localFilters, hasInspection: !!checked })}
                  />
                  <span className="text-sm font-medium">Has inspection scheduled</span>
                </label>
                <label className="flex min-w-[180px] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.lowConfidence}
                    onCheckedChange={(checked) => setLocalFilters({ ...localFilters, lowConfidence: !!checked })}
                  />
                  <span className="text-sm font-medium">Low confidence only</span>
                </label>
                <label className="flex min-w-[180px] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3 transition-all hover:-translate-y-0.5 hover:border-brand-400/50 hover:bg-brand-50/60 focus-within:ring-2 focus-within:ring-brand-400/30 dark:hover:bg-brand-400/10">
                  <Checkbox
                    checked={localFilters.offMarket}
                    onCheckedChange={(checked) => setLocalFilters({ ...localFilters, offMarket: !!checked })}
                  />
                  <span className="text-sm font-medium">Off-market properties</span>
                </label>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
