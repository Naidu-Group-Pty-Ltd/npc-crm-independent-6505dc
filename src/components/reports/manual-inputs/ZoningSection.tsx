import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MapPin, Info, Building, Layers, Ruler } from 'lucide-react';
import { useCallback } from 'react';

interface ZoningSectionProps {
  zoningCode: string;
  setZoningCode: (value: string) => void;
  zoningDescription: string;
  setZoningDescription: (value: string) => void;
  permittedUses: string;
  setPermittedUses: (value: string) => void;
  developmentPotential: string;
  setDevelopmentPotential: (value: string) => void;
  zoningOverlays: string;
  setZoningOverlays: (value: string) => void;
  minimumLotSize: string;
  setMinimumLotSize: (value: string) => void;
  maximumHeight: string;
  setMaximumHeight: (value: string) => void;
  floorSpaceRatio: string;
  setFloorSpaceRatio: (value: string) => void;
  disabled?: boolean;
}

export function ZoningSection({
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
}: ZoningSectionProps) {
  const handleNumberChange = useCallback((setter: (value: string) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value === '' || /^\d*\.?\d*$/.test(value)) {
        setter(value);
      }
    };
  }, []);

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-primary" />
          Zoning & Planning
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Zoning information affects development potential and investment value. Check your local council's planning portal for accurate zoning details.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h3>

        {/* Zoning Classification Row */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="zoningCode" className="text-sm font-medium flex items-center gap-1">
              <Building className="h-3 w-3" />
              Zoning Code
            </Label>
            <Select 
              value={zoningCode} 
              onValueChange={setZoningCode}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select zoning code" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50 max-h-60">
                <SelectItem value="R1">R1 - General Residential</SelectItem>
                <SelectItem value="R2">R2 - Low Density Residential</SelectItem>
                <SelectItem value="R3">R3 - Medium Density Residential</SelectItem>
                <SelectItem value="R4">R4 - High Density Residential</SelectItem>
                <SelectItem value="R5">R5 - Large Lot Residential</SelectItem>
                <SelectItem value="RU1">RU1 - Primary Production</SelectItem>
                <SelectItem value="RU2">RU2 - Rural Landscape</SelectItem>
                <SelectItem value="RU5">RU5 - Village</SelectItem>
                <SelectItem value="B1">B1 - Neighbourhood Centre</SelectItem>
                <SelectItem value="B2">B2 - Local Centre</SelectItem>
                <SelectItem value="B4">B4 - Mixed Use</SelectItem>
                <SelectItem value="IN1">IN1 - General Industrial</SelectItem>
                <SelectItem value="IN2">IN2 - Light Industrial</SelectItem>
                <SelectItem value="SP1">SP1 - Special Activities</SelectItem>
                <SelectItem value="SP2">SP2 - Infrastructure</SelectItem>
                <SelectItem value="RE1">RE1 - Public Recreation</SelectItem>
                <SelectItem value="E1">E1 - National Parks</SelectItem>
                <SelectItem value="E2">E2 - Environmental Conservation</SelectItem>
                <SelectItem value="E3">E3 - Environmental Management</SelectItem>
                <SelectItem value="E4">E4 - Environmental Living</SelectItem>
                <SelectItem value="other">Other (Specify in Description)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="zoningDescription" className="text-sm font-medium">
              Zoning Category
            </Label>
            <Select 
              value={zoningDescription} 
              onValueChange={setZoningDescription}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="rural_residential">Rural Residential</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="mixed_use">Mixed Use</SelectItem>
                <SelectItem value="industrial">Industrial</SelectItem>
                <SelectItem value="rural">Rural/Agricultural</SelectItem>
                <SelectItem value="environmental">Environmental</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Permitted Uses & Development Row */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="permittedUses" className="text-sm font-medium">
              Permitted Uses
            </Label>
            <Select 
              value={permittedUses} 
              onValueChange={setPermittedUses}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select permitted uses" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50 max-h-60">
                <SelectItem value="dwelling_only">Dwelling House Only</SelectItem>
                <SelectItem value="dual_occupancy">Dual Occupancy Permitted</SelectItem>
                <SelectItem value="multi_dwelling">Multi-Dwelling Housing</SelectItem>
                <SelectItem value="attached_dwelling">Attached Dwelling</SelectItem>
                <SelectItem value="secondary_dwelling">Secondary Dwelling (Granny Flat)</SelectItem>
                <SelectItem value="home_business">Home Business</SelectItem>
                <SelectItem value="boarding_house">Boarding House</SelectItem>
                <SelectItem value="group_home">Group Home</SelectItem>
                <SelectItem value="childcare">Childcare Centre</SelectItem>
                <SelectItem value="mixed">Mixed Residential/Commercial</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="developmentPotential" className="text-sm font-medium flex items-center gap-1">
              Development Potential
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Future development possibilities based on zoning</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Select 
              value={developmentPotential} 
              onValueChange={setDevelopmentPotential}
              disabled={disabled}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select potential" />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="none">No Development Potential</SelectItem>
                <SelectItem value="subdivision">Subdivision Possible</SelectItem>
                <SelectItem value="dual_occ">Dual Occupancy Potential</SelectItem>
                <SelectItem value="townhouses">Townhouse Development</SelectItem>
                <SelectItem value="apartments">Apartment Development</SelectItem>
                <SelectItem value="granny_flat">Granny Flat Addition</SelectItem>
                <SelectItem value="mixed_use">Mixed Use Development</SelectItem>
                <SelectItem value="stca">STCA (Subject to Council Approval)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Planning Overlays */}
        <div className="space-y-2 mb-4">
          <Label htmlFor="zoningOverlays" className="text-sm font-medium flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Planning Overlays
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Overlays may restrict development (e.g., heritage, flood, bushfire zones)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <Select 
            value={zoningOverlays} 
            onValueChange={setZoningOverlays}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select overlays" />
            </SelectTrigger>
            <SelectContent className="bg-background z-50">
              <SelectItem value="none">No Significant Overlays</SelectItem>
              <SelectItem value="heritage">Heritage Conservation</SelectItem>
              <SelectItem value="flood">Flood Planning Area</SelectItem>
              <SelectItem value="bushfire">Bushfire Prone Land</SelectItem>
              <SelectItem value="environmental">Environmental Protection</SelectItem>
              <SelectItem value="airport">Airport/Flight Path</SelectItem>
              <SelectItem value="acid_sulfate">Acid Sulfate Soils</SelectItem>
              <SelectItem value="coastal">Coastal Zone</SelectItem>
              <SelectItem value="contaminated">Contaminated Land</SelectItem>
              <SelectItem value="multiple">Multiple Overlays Apply</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Development Controls Row */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="minimumLotSize" className="text-sm font-medium flex items-center gap-1">
              <Ruler className="h-3 w-3" />
              Min Lot Size
            </Label>
            <div className="relative">
              <Input
                id="minimumLotSize"
                type="text"
                inputMode="decimal"
                value={minimumLotSize}
                onChange={handleNumberChange(setMinimumLotSize)}
                placeholder="450"
                disabled={disabled}
                className="pr-12"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">m²</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maximumHeight" className="text-sm font-medium">
              Max Height
            </Label>
            <div className="relative">
              <Input
                id="maximumHeight"
                type="text"
                inputMode="decimal"
                value={maximumHeight}
                onChange={handleNumberChange(setMaximumHeight)}
                placeholder="8.5"
                disabled={disabled}
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">m</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="floorSpaceRatio" className="text-sm font-medium flex items-center gap-1">
              FSR
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Floor Space Ratio (e.g., 0.5 = 50% of land area)</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              id="floorSpaceRatio"
              type="text"
              inputMode="decimal"
              value={floorSpaceRatio}
              onChange={handleNumberChange(setFloorSpaceRatio)}
              placeholder="0.5"
              disabled={disabled}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
