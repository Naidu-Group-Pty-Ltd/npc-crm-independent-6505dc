import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Building2, Info, Car, Ruler, BedDouble, Bath } from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { useCallback } from 'react';
import { BuildTypeSelector } from '../shared/BuildTypeSelector';
import { ZoningSection } from './ZoningSection';

import { BuildType } from '@/types/overrideFields';

interface PropertyTabProps {
  buildType: BuildType;
  onBuildTypeChange?: (value: BuildType) => void;
  /** The Reports page owns the property-type choice at the top of the page. */
  showBuildTypeSelector?: boolean;
  purchasePrice: string;
  setPurchasePrice: (value: string) => void;
  propertyValue: string;
  setPropertyValue: (value: string) => void;
  landPrice: string;
  setLandPrice: (value: string) => void;
  buildPrice: string;
  setBuildPrice: (value: string) => void;
  // Consolidated primary property details (previously a separate panel above)
  weeklyRent?: string;
  setWeeklyRent?: (value: string) => void;
  beds?: string;
  setBeds?: (value: string) => void;
  baths?: string;
  setBaths?: (value: string) => void;
  // New fields for feature parity
  propertyType?: string;
  setPropertyType?: (value: string) => void;
  carSpaces?: string;
  setCarSpaces?: (value: string) => void;
  landSizeSqm?: string;
  setLandSizeSqm?: (value: string) => void;
  buildSizeSqm?: string;
  setBuildSizeSqm?: (value: string) => void;
  // Zoning fields
  zoningCode?: string;
  setZoningCode?: (value: string) => void;
  zoningDescription?: string;
  setZoningDescription?: (value: string) => void;
  permittedUses?: string;
  setPermittedUses?: (value: string) => void;
  developmentPotential?: string;
  setDevelopmentPotential?: (value: string) => void;
  zoningOverlays?: string;
  setZoningOverlays?: (value: string) => void;
  minimumLotSize?: string;
  setMinimumLotSize?: (value: string) => void;
  maximumHeight?: string;
  setMaximumHeight?: (value: string) => void;
  floorSpaceRatio?: string;
  setFloorSpaceRatio?: (value: string) => void;
  disabled?: boolean;
}

export function PropertyTab({
  buildType,
  onBuildTypeChange,
  showBuildTypeSelector = true,
  purchasePrice,
  setPurchasePrice,
  propertyValue,
  setPropertyValue,
  landPrice,
  setLandPrice,
  buildPrice,
  setBuildPrice,
  weeklyRent,
  setWeeklyRent,
  beds,
  setBeds,
  baths,
  setBaths,
  propertyType,
  setPropertyType,
  carSpaces,
  setCarSpaces,
  landSizeSqm,
  setLandSizeSqm,
  buildSizeSqm,
  setBuildSizeSqm,
  zoningCode,
  setZoningCode,
  zoningDescription,
  setZoningDescription,
  permittedUses,
  setPermittedUses,
  developmentPotential,
  setDevelopmentPotential,
  zoningOverlays,
  setZoningOverlays,
  minimumLotSize,
  setMinimumLotSize,
  maximumHeight,
  setMaximumHeight,
  floorSpaceRatio,
  setFloorSpaceRatio,
  disabled = false
}: PropertyTabProps) {
  const isNewBuild = buildType === 'new_build';
  const isLandOnly = buildType === 'land_only';
  const handleCurrencyChange = useCallback((setter: (value: string) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = removeCommas(e.target.value);
      if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
        setter(rawValue);
      }
    };
  }, []);

  const handleNumberChange = useCallback((setter: (value: string) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value === '' || /^\d*$/.test(value)) {
        setter(value);
      }
    };
  }, []);

  const formatForDisplay = useCallback((value: string) => {
    return formatNumberWithCommas(value);
  }, []);

  return (
    <div className="reports-overrides-property-tab space-y-6 animate-fade-in">
      {/* Build Type Selection — rendered only when the host page does not
          already present it at the top of the workflow. */}
      {showBuildTypeSelector && onBuildTypeChange && (
        <BuildTypeSelector
          value={buildType}
          onChange={onBuildTypeChange}
          disabled={disabled}
        />
      )}

      {/* Pricing Section */}
      <Card className="reports-overrides-section-card">
        <CardContent className="reports-overrides-section-content pt-6">
          <div className="reports-overrides-section-heading mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="reports-overrides-section-title text-lg font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Pricing
            </h3>
            <Badge variant="default" className="reports-required-scoring-badge text-xs">Required for Scoring</Badge>
          </div>
          <p className="reports-overrides-section-helper mb-4 text-sm text-muted-foreground">
            Purchase price is required for investment scoring. Everything else is optional and
            overrides any value collected from a listing URL, uploaded document or stored record.
          </p>

          <div className="reports-overrides-field-grid grid grid-cols-2 gap-4 mb-4">
            <div className="reports-overrides-field space-y-2">
              <Label htmlFor="purchasePrice" className="reports-overrides-label text-sm font-medium flex items-center gap-1">
                Purchase Price <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="purchasePrice"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(purchasePrice)}
                  onChange={handleCurrencyChange(setPurchasePrice)}
                  placeholder="750,000"
                  disabled={disabled}
                  className="reports-overrides-input pl-7"
                />
              </div>
            </div>
            <div className="reports-overrides-field space-y-2">
              <Label htmlFor="propertyValue" className="reports-overrides-label text-sm font-medium flex items-center gap-1">
                Property Value
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Current market value (may differ from purchase price)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="propertyValue"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(propertyValue)}
                  onChange={handleCurrencyChange(setPropertyValue)}
                  placeholder="800,000"
                  disabled={disabled}
                  className="reports-overrides-input pl-7"
                />
              </div>
            </div>
            {setWeeklyRent && (
              <div className="reports-overrides-field space-y-2">
                <Label htmlFor="weeklyRent" className="reports-overrides-label text-sm font-medium">Weekly Rent</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="weeklyRent"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(weeklyRent || '')}
                    onChange={handleCurrencyChange(setWeeklyRent)}
                    placeholder="550"
                    disabled={disabled}
                    className="reports-overrides-input pl-7"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Land Price - shown for New Builds AND Land Only */}
          {(isNewBuild || isLandOnly) && (
            <div className="reports-overrides-field-grid grid grid-cols-2 gap-4 mb-4">
              <div className="reports-overrides-field space-y-2">
                <Label htmlFor="landPrice" className="reports-overrides-label text-sm font-medium">Land Price</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="landPrice"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(landPrice)}
                    onChange={handleCurrencyChange(setLandPrice)}
                    placeholder="350,000"
                    disabled={disabled}
                    className="reports-overrides-input pl-7"
                  />
                </div>
              </div>
              {/* Build Price - only shown for New Builds */}
              {isNewBuild && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="buildPrice" className="reports-overrides-label text-sm font-medium">Build Price</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      id="buildPrice"
                      type="text"
                      inputMode="numeric"
                      value={formatForDisplay(buildPrice)}
                      onChange={handleCurrencyChange(setBuildPrice)}
                      placeholder="400,000"
                      disabled={disabled}
                      className="reports-overrides-input pl-7"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Property Specifications - Show Property Type always, hide other fields for Land Only */}
      {(setPropertyType || setCarSpaces || setLandSizeSqm || setBuildSizeSqm || setBeds || setBaths) && (
        <Card className="reports-overrides-section-card">
          <CardContent className="reports-overrides-section-content pt-6">
            <h3 className="reports-overrides-section-title text-lg font-semibold flex items-center gap-2 mb-4">
              <Ruler className="h-5 w-5 text-primary" />
              Property Specifications
            </h3>

            <div className="reports-overrides-field-grid grid grid-cols-2 gap-4">
              {/* Property Type - Always visible, auto-set to 'land' for Land Only */}
              {setPropertyType && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="propertyType" className="reports-overrides-label text-sm font-medium">Property Type</Label>
                  <Select 
                    value={isLandOnly ? 'land' : (propertyType || 'house')} 
                    onValueChange={setPropertyType}
                    disabled={disabled || isLandOnly}
                  >
                    <SelectTrigger className="reports-overrides-select-trigger">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="reports-overrides-select-content bg-background z-50">
                      <SelectItem value="house">House</SelectItem>
                      <SelectItem value="apartment">Apartment/Unit</SelectItem>
                      <SelectItem value="townhouse">Townhouse</SelectItem>
                      <SelectItem value="villa">Villa</SelectItem>
                      <SelectItem value="duplex">Duplex</SelectItem>
                      <SelectItem value="terrace">Terrace</SelectItem>
                      <SelectItem value="acreage">Acreage/Rural</SelectItem>
                      <SelectItem value="land">Vacant Land</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Bedrooms / Bathrooms - Hide for Land Only */}
              {setBeds && !isLandOnly && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="beds" className="reports-overrides-label text-sm font-medium flex items-center gap-1">
                    <BedDouble className="h-3 w-3" />
                    Bedrooms
                  </Label>
                  <Input
                    id="beds"
                    className="reports-overrides-input"
                    type="text"
                    inputMode="numeric"
                    value={beds || ''}
                    onChange={handleNumberChange(setBeds)}
                    placeholder="3"
                    disabled={disabled}
                  />
                </div>
              )}

              {setBaths && !isLandOnly && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="baths" className="reports-overrides-label text-sm font-medium flex items-center gap-1">
                    <Bath className="h-3 w-3" />
                    Bathrooms
                  </Label>
                  <Input
                    id="baths"
                    className="reports-overrides-input"
                    type="text"
                    inputMode="numeric"
                    value={baths || ''}
                    onChange={handleNumberChange(setBaths)}
                    placeholder="2"
                    disabled={disabled}
                  />
                </div>
              )}

              {/* Car Spaces - Hide for Land Only */}
              {setCarSpaces && !isLandOnly && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="carSpaces" className="reports-overrides-label text-sm font-medium flex items-center gap-1">
                    <Car className="h-3 w-3" />
                    Car Spaces
                  </Label>
                  <Input
                    id="carSpaces"
                    className="reports-overrides-input"
                    type="text"
                    inputMode="numeric"
                    value={carSpaces || ''}
                    onChange={handleNumberChange(setCarSpaces)}
                    placeholder="2"
                    disabled={disabled}
                  />
                </div>
              )}

              {/* Land Size */}
              {setLandSizeSqm && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="landSizeSqm" className="reports-overrides-label text-sm font-medium">Land Size</Label>
                  <div className="relative">
                    <Input
                      id="landSizeSqm"
                      type="text"
                      inputMode="numeric"
                      value={landSizeSqm || ''}
                      onChange={handleNumberChange(setLandSizeSqm)}
                      placeholder="450"
                      disabled={disabled}
                      className="reports-overrides-input pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">m²</span>
                  </div>
                </div>
              )}

              {/* Build Size - Hide for Land Only */}
              {setBuildSizeSqm && !isLandOnly && (
                <div className="reports-overrides-field space-y-2">
                  <Label htmlFor="buildSizeSqm" className="reports-overrides-label text-sm font-medium">Build Size</Label>
                  <div className="relative">
                    <Input
                      id="buildSizeSqm"
                      type="text"
                      inputMode="numeric"
                      value={buildSizeSqm || ''}
                      onChange={handleNumberChange(setBuildSizeSqm)}
                      placeholder="180"
                      disabled={disabled}
                      className="reports-overrides-input pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">m²</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Zoning Section */}
      {setZoningCode && setZoningDescription && (
        <ZoningSection
          zoningCode={zoningCode || ''}
          setZoningCode={setZoningCode}
          zoningDescription={zoningDescription || ''}
          setZoningDescription={setZoningDescription}
          permittedUses={permittedUses || ''}
          setPermittedUses={setPermittedUses || (() => {})}
          developmentPotential={developmentPotential || ''}
          setDevelopmentPotential={setDevelopmentPotential || (() => {})}
          zoningOverlays={zoningOverlays || ''}
          setZoningOverlays={setZoningOverlays || (() => {})}
          minimumLotSize={minimumLotSize || ''}
          setMinimumLotSize={setMinimumLotSize || (() => {})}
          maximumHeight={maximumHeight || ''}
          setMaximumHeight={setMaximumHeight || (() => {})}
          floorSpaceRatio={floorSpaceRatio || ''}
          setFloorSpaceRatio={setFloorSpaceRatio || (() => {})}
          disabled={disabled}
        />
      )}
    </div>
  );
}
