import { useState, useMemo } from 'react';
import { Search, FileText, ChevronDown, Check, X, BookOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface UploadedReport {
  name: string;
  content: string;
  uploadedAt: Date;
}

interface ReportSwitcherProps {
  reports: UploadedReport[];
  activeReportIndex: number | null;
  onSelectReport: (index: number | null) => void;
  className?: string;
}

export function ReportSwitcher({ 
  reports, 
  activeReportIndex, 
  onSelectReport,
  className 
}: ReportSwitcherProps) {
  if (reports.length <= 1) return null;
  
  const activeReport = activeReportIndex !== null ? reports[activeReportIndex] : null;
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2 max-w-[200px]", className)}>
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">
            {activeReport ? activeReport.name.replace('.pdf', '') : 'All Reports'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Focus on report</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => onSelectReport(null)}
          className="gap-2"
        >
          <div className={cn(
            "h-4 w-4 rounded-full border flex items-center justify-center",
            activeReportIndex === null && "bg-primary border-primary"
          )}>
            {activeReportIndex === null && <Check className="h-3 w-3 text-primary-foreground" />}
          </div>
          <span>All Reports (Compare)</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {reports.map((report, index) => (
          <DropdownMenuItem 
            key={report.name}
            onClick={() => onSelectReport(index)}
            className="gap-2"
          >
            <div className={cn(
              "h-4 w-4 rounded-full border flex items-center justify-center",
              activeReportIndex === index && "bg-primary border-primary"
            )}>
              {activeReportIndex === index && <Check className="h-3 w-3 text-primary-foreground" />}
            </div>
            <span className="truncate">{report.name.replace('.pdf', '')}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ReportSearchProps {
  reports: UploadedReport[];
  onResultClick?: (reportIndex: number, snippet: string) => void;
  className?: string;
}

interface SearchResult {
  reportIndex: number;
  reportName: string;
  snippet: string;
  matchIndex: number;
}

export function ReportSearch({ reports, onResultClick, className }: ReportSearchProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return [];
    
    const searchResults: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();
    
    reports.forEach((report, reportIndex) => {
      const content = report.content.toLowerCase();
      let searchStart = 0;
      let matchCount = 0;
      
      while (matchCount < 3) { // Max 3 results per report
        const matchIndex = content.indexOf(lowerQuery, searchStart);
        if (matchIndex === -1) break;
        
        // Extract snippet with context
        const snippetStart = Math.max(0, matchIndex - 50);
        const snippetEnd = Math.min(report.content.length, matchIndex + query.length + 100);
        let snippet = report.content.substring(snippetStart, snippetEnd);
        
        // Clean up snippet
        if (snippetStart > 0) snippet = '...' + snippet;
        if (snippetEnd < report.content.length) snippet = snippet + '...';
        snippet = snippet.replace(/\n+/g, ' ').trim();
        
        searchResults.push({
          reportIndex,
          reportName: report.name,
          snippet,
          matchIndex: searchStart
        });
        
        searchStart = matchIndex + query.length;
        matchCount++;
      }
    });
    
    return searchResults.slice(0, 10); // Max 10 total results
  }, [query, reports]);
  
  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <mark key={i} className="bg-brand-200 dark:bg-brand-800 px-0.5 rounded">
          {part}
        </mark>
      ) : part
    );
  };
  
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={cn("gap-2", className)}
          disabled={reports.length === 0}
        >
          <Search className="h-3.5 w-3.5" />
          Search Reports
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search within reports..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 pr-8"
              autoFocus
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => setQuery('')}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        
        <ScrollArea className="max-h-[300px]">
          {query.length < 2 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Type at least 2 characters to search</p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No results found for "{query}"
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {results.map((result, idx) => (
                <button
                  key={idx}
                  className="w-full text-left p-2 rounded-lg hover:bg-muted transition-colors"
                  onClick={() => {
                    onResultClick?.(result.reportIndex, result.snippet);
                    setIsOpen(false);
                    setQuery('');
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
                    <span className="text-xs font-medium truncate">
                      {result.reportName.replace('.pdf', '')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {highlightMatch(result.snippet, query)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        
        {results.length > 0 && (
          <div className="p-2 border-t bg-muted/50">
            <p className="text-xs text-muted-foreground text-center">
              {results.length} result{results.length !== 1 ? 's' : ''} found
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface ReportContextIndicatorProps {
  reportName: string;
  className?: string;
}

export function ReportContextIndicator({ reportName, className }: ReportContextIndicatorProps) {
  return (
    <Badge 
      variant="outline" 
      className={cn(
        "gap-1.5 text-xs bg-primary/5 border-primary/20 text-primary",
        className
      )}
    >
      <FileText className="h-3 w-3" />
      <span className="truncate max-w-[150px]">{reportName.replace('.pdf', '')}</span>
    </Badge>
  );
}
