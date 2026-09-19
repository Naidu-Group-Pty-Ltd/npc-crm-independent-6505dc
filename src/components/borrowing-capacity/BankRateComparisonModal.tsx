import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import { 
  RefreshCw, 
  TrendingDown, 
  Building2, 
  CheckCircle2,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { useBankLendingRates, LendingRate, LenderSummary } from '@/hooks/useBankLendingRates';

interface BankRateComparisonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectRate?: (rate: number, lenderName: string, productName: string) => void;
  defaultLoanPurpose?: 'OWNER_OCCUPIED' | 'INVESTMENT';
  defaultRepaymentType?: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY';
  defaultLvr?: number;
}

export function BankRateComparisonModal({
  open,
  onOpenChange,
  onSelectRate,
  defaultLoanPurpose = 'INVESTMENT',
  defaultRepaymentType = 'PRINCIPAL_AND_INTEREST',
  defaultLvr = 80,
}: BankRateComparisonModalProps) {
  const isMobile = useIsMobile();
  const [loanPurpose, setLoanPurpose] = useState<'OWNER_OCCUPIED' | 'INVESTMENT'>(defaultLoanPurpose);
  const [repaymentType, setRepaymentType] = useState<'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY'>(defaultRepaymentType);
  const [lvr, setLvr] = useState(defaultLvr);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'rate' | 'lender'>('rate');
  const [expandedLenders, setExpandedLenders] = useState<Set<string>>(new Set());
  const [loadingLenders, setLoadingLenders] = useState<Set<string>>(new Set());
  const [lenderProducts, setLenderProducts] = useState<Record<string, LendingRate[]>>({});

  const {
    lenders,
    ratesSummary,
    isLoadingSummary,
    bestRates,
    isLoadingBestRates,
    refetchBestRates,
    refreshAll,
    isRefreshing,
    fetchLenderRates,
  } = useBankLendingRates({ loanPurpose, repaymentType, lvr });

  // Filter and sort best rates
  const filteredRates = bestRates?.filter(rate => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      rate.lenderName.toLowerCase().includes(query) ||
      rate.productName.toLowerCase().includes(query)
    );
  }).sort((a, b) => {
    if (sortBy === 'rate') return a.rate - b.rate;
    return a.lenderName.localeCompare(b.lenderName);
  }) || [];

  // Filter lender summary
  const filteredSummary = ratesSummary?.filter(lender => {
    if (!searchQuery) return true;
    return lender.lenderName.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => {
    if (sortBy === 'rate') {
      return (a.lowestRate || 999) - (b.lowestRate || 999);
    }
    return a.lenderName.localeCompare(b.lenderName);
  }) || [];

  const handleSelectRate = (rate: LendingRate) => {
    onSelectRate?.(rate.rate, rate.lenderName, rate.productName);
    onOpenChange(false);
  };

  const toggleLenderExpanded = async (lenderId: string) => {
    const newExpanded = new Set(expandedLenders);
    
    if (newExpanded.has(lenderId)) {
      newExpanded.delete(lenderId);
      setExpandedLenders(newExpanded);
    } else {
      newExpanded.add(lenderId);
      setExpandedLenders(newExpanded);
      
      // Fetch products if not already loaded
      if (!lenderProducts[lenderId]) {
        setLoadingLenders(prev => new Set(prev).add(lenderId));
        try {
          const rates = await fetchLenderRates(lenderId);
          setLenderProducts(prev => ({ ...prev, [lenderId]: rates }));
        } catch (error) {
          console.error('Failed to fetch lender rates:', error);
        } finally {
          setLoadingLenders(prev => {
            const newSet = new Set(prev);
            newSet.delete(lenderId);
            return newSet;
          });
        }
      }
    }
  };

  // Filter products within expanded lenders
  const getFilteredProducts = (products: LendingRate[]) => {
    if (!searchQuery) return products;
    const query = searchQuery.toLowerCase();
    return products.filter(p => 
      p.productName.toLowerCase().includes(query) ||
      p.lenderName.toLowerCase().includes(query)
    );
  };

  const modalContent = (
    <>
      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 py-4 border-b">
          <div className="space-y-1">
            <Label className="text-xs">Loan Purpose</Label>
            <Select value={loanPurpose} onValueChange={(v: any) => setLoanPurpose(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OWNER_OCCUPIED">Owner Occupied</SelectItem>
                <SelectItem value="INVESTMENT">Investment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Repayment Type</Label>
            <Select value={repaymentType} onValueChange={(v: any) => setRepaymentType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PRINCIPAL_AND_INTEREST">P&I</SelectItem>
                <SelectItem value="INTEREST_ONLY">Interest Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">LVR (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={lvr}
              onChange={(e) => setLvr(Number(e.target.value))}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search lender or product..."
              iconClassName="left-2"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortBy(sortBy === 'rate' ? 'lender' : 'rate')}
            >
              <ArrowUpDown className="h-4 w-4 mr-1" />
              Sort by {sortBy === 'rate' ? 'Lender' : 'Rate'}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshAll()}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh All Rates
          </Button>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="best-rates" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="best-rates">
              <TrendingDown className="h-4 w-4 mr-2" />
              Best Rates
            </TabsTrigger>
            <TabsTrigger value="by-lender">
              <Building2 className="h-4 w-4 mr-2" />
              By Lender
            </TabsTrigger>
          </TabsList>

          <TabsContent value="best-rates" className="flex-1 mt-4">
            <ScrollArea className="h-[400px]">
              {isLoadingBestRates ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredRates.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No rates found matching your criteria.</p>
                  <p className="text-sm">Try adjusting filters or refresh rates.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lender</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Comparison</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRates.map((rate, index) => (
                      <TableRow key={`${rate.lenderId}-${rate.productId}-${index}`}>
                        <TableCell className="font-medium">
                          {rate.lenderName}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                          {rate.productName}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold text-primary">
                            {rate.rate.toFixed(2)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {rate.comparisonRate ? `${rate.comparisonRate.toFixed(2)}%` : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {rate.rateType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectRate(rate)}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Select
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="by-lender" className="flex-1 mt-4">
            <ScrollArea className="h-[400px]">
              {isLoadingSummary ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredSummary.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No cached lender data available.</p>
                  <p className="text-sm">Click "Refresh All Rates" to fetch latest data.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSummary.map((lender) => {
                    const isExpanded = expandedLenders.has(lender.lenderId);
                    const isLoading = loadingLenders.has(lender.lenderId);
                    const products = lenderProducts[lender.lenderId] || [];
                    const filteredProducts = getFilteredProducts(products);

                    return (
                      <Collapsible
                        key={lender.lenderId}
                        open={isExpanded}
                        onOpenChange={() => toggleLenderExpanded(lender.lenderId)}
                      >
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <div>
                                <p className="font-medium">{lender.lenderName}</p>
                                <p className="text-xs text-muted-foreground">
                                  Last updated: {lender.fetchedAt ? new Date(lender.fetchedAt).toLocaleDateString('en-AU') : 'Never'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              {lender.lowestRate !== null && (
                                <div className="text-right">
                                  <p className="text-xs text-muted-foreground">From</p>
                                  <p className="font-bold text-primary">{lender.lowestRate.toFixed(2)}%</p>
                                </div>
                              )}
                              <Badge variant="secondary" className="min-w-[60px] justify-center">
                                {lender.rateCount} products
                              </Badge>
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="ml-7 mt-2 border rounded-lg overflow-hidden">
                            {isLoading ? (
                              <div className="flex items-center justify-center p-6">
                                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                <span className="text-sm text-muted-foreground">Loading products...</span>
                              </div>
                            ) : filteredProducts.length === 0 ? (
                              <div className="p-6 text-center text-muted-foreground text-sm">
                                No products match current filters.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[40%]">Product Name</TableHead>
                                    <TableHead className="text-right">Rate</TableHead>
                                    <TableHead className="text-right">Comparison</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead className="text-right">LVR Range</TableHead>
                                    <TableHead className="w-[80px]"></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {filteredProducts.sort((a, b) => a.rate - b.rate).map((product, idx) => (
                                    <TableRow key={`${product.productId}-${idx}`}>
                                      <TableCell className="font-medium text-sm">
                                        {product.productName}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <span className="font-bold text-primary">
                                          {product.rate.toFixed(2)}%
                                        </span>
                                      </TableCell>
                                      <TableCell className="text-right text-sm text-muted-foreground">
                                        {product.comparisonRate ? `${product.comparisonRate.toFixed(2)}%` : '-'}
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className="text-xs">
                                          {product.rateType}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right text-xs text-muted-foreground">
                                        {product.lvrMin !== null && product.lvrMax !== null
                                          ? `${product.lvrMin}% - ${product.lvrMax}%`
                                          : product.lvrMax !== null
                                          ? `≤ ${product.lvrMax}%`
                                          : '-'}
                                      </TableCell>
                                      <TableCell>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSelectRate(product);
                                          }}
                                          className="h-8 px-2"
                                        >
                                          <CheckCircle2 className="h-4 w-4" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="pt-4 border-t text-xs text-muted-foreground text-center">
          Rates sourced from Australia's Consumer Data Right (CDR) Open Banking APIs.
          Data is cached for 24 hours. Click on a lender to view all products.
        </div>
      </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="p-4 pb-3 border-b flex-shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Bank Rate Comparison
            </SheetTitle>
            <SheetDescription className="text-xs">
              Compare live rates from major Australian lenders
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-auto p-4">
            {modalContent}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Bank Rate Comparison
          </DialogTitle>
          <DialogDescription>
            Compare live interest rates from major Australian lenders via CDR Open Banking API
          </DialogDescription>
        </DialogHeader>
        {modalContent}
      </DialogContent>
    </Dialog>
  );
}
