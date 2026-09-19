import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSecureInvestmentReports } from '@/hooks/useSecureInvestmentReports';
import { format } from 'date-fns';
import { Save, Eye, MapPin, Calendar, FileText, AlertCircle, CheckCircle, Type, Link } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logActivityDirect } from '@/hooks/useActivityLogger';

interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  report_content: string;
  sources_content?: string | null;
  created_at: string;
  [key: string]: any;
}

interface InvestmentReportEditorProps {
  report: InvestmentReport | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (updatedReport: InvestmentReport) => void;
}

export function InvestmentReportEditor({ report, isOpen, onClose, onSave }: InvestmentReportEditorProps) {
  const [editedContent, setEditedContent] = useState('');
  const [editedSources, setEditedSources] = useState('');
  const [editedPropertyAddress, setEditedPropertyAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState('content');
  const { toast } = useToast();
  const { updateReport } = useSecureInvestmentReports();

  useEffect(() => {
    if (report) {
      setEditedContent(report.report_content);
      setEditedSources(report.sources_content || '');
      setEditedPropertyAddress(report.property_address);
      setHasChanges(false);
    }
  }, [report]);

  if (!report) return null;

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasChanges(
      value !== report.report_content || 
      editedSources !== (report.sources_content || '') ||
      editedPropertyAddress !== report.property_address
    );
  };

  const handleSourcesChange = (value: string) => {
    setEditedSources(value);
    setHasChanges(
      editedContent !== report.report_content || 
      value !== (report.sources_content || '') ||
      editedPropertyAddress !== report.property_address
    );
  };

  const handlePropertyAddressChange = (value: string) => {
    setEditedPropertyAddress(value);
    setHasChanges(
      editedContent !== report.report_content || 
      editedSources !== (report.sources_content || '') ||
      value !== report.property_address
    );
  };

  const handleSave = async () => {
    if (!hasChanges || !report) {
      toast({
        title: "No changes to save",
        description: "The report content hasn't been modified.",
      });
      return;
    }

    setIsSaving(true);
    try {
      // Use the secure hook to update via edge function (bypasses RLS)
      const updatedReport = await updateReport(report.id, { 
        property_address: editedPropertyAddress,
        report_content: editedContent,
        sources_content: editedSources || null,
      });

      if (!updatedReport) {
        throw new Error('Failed to update report');
      }

      toast({
        title: "Report saved successfully",
        description: "Your changes have been saved to the database.",
      });
      
      // Log activity
      logActivityDirect({
        actionType: 'report_edited',
        entityType: 'investment_report',
        entityId: report.id,
        entityName: editedPropertyAddress,
        metadata: { contentChanged: editedContent !== report.report_content, sourcesChanged: editedSources !== (report.sources_content || '') }
      });
      
      setHasChanges(false);
      
      // Notify parent of the update with the full updated report
      if (onSave) {
        onSave(updatedReport as InvestmentReport);
      }
      
    } catch (error) {
      console.error('Error saving report:', error);
      toast({
        title: "Failed to save report",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to close without saving?")) {
        setEditedContent(report.report_content);
        setEditedSources(report.sources_content || '');
        setEditedPropertyAddress(report.property_address);
        setHasChanges(false);
        onClose();
      }
    } else {
      onClose();
    }
  };

  // Custom markdown components for consistent styling with viewer
  const markdownComponents = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-bold mt-8 mb-4 text-foreground border-b pb-2">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold mt-6 mb-3 text-primary">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-medium mt-4 mb-2 text-foreground">
        {children}
      </h3>
    ),
    p: ({ children }: any) => (
      <p className="mb-4 leading-relaxed text-foreground">
        {children}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className="mb-4 space-y-2 list-disc list-inside">
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className="mb-4 space-y-2 list-decimal list-inside">
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="text-foreground leading-relaxed pl-2">
        {children}
      </li>
    ),
    table: ({ children }: any) => (
      <div className="not-prose overflow-x-auto my-8">
        <table className="min-w-full border-collapse border-2 border-border shadow-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-gradient-to-r from-primary/10 to-primary/5 border-b-2 border-border">
        {children}
      </thead>
    ),
    tbody: ({ children }: any) => (
      <tbody className="divide-y divide-border">
        {children}
      </tbody>
    ),
    tr: ({ children, isHeader }: any) => (
      <tr className={isHeader ? "" : "hover:bg-muted/50 transition-colors"}>
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="border border-border px-6 py-3 text-left font-bold text-foreground bg-muted/50">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border border-border px-6 py-3 text-foreground">
        {children}
      </td>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-foreground">
        {children}
      </strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-muted-foreground">
        {children}
      </em>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children }: any) => (
      <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">
        {children}
      </code>
    ),
    pre: ({ children }: any) => (
      <pre className="bg-muted p-4 rounded-lg my-4 overflow-x-auto">
        {children}
      </pre>
    ),
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[calc(100vw-1rem)] h-[92dvh] max-h-[92dvh] overflow-hidden flex flex-col gap-0 p-0 sm:w-[min(94vw,1580px)] sm:max-w-none sm:h-[min(90dvh,980px)] sm:max-h-[calc(100dvh-40px)] sm:p-0">
        <DialogHeader className="flex-shrink-0 border-b border-border/70 px-4 py-4 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Edit Investment Report
          </DialogTitle>
          <div className="space-y-2 mt-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <Input
                value={editedPropertyAddress}
                onChange={(e) => handlePropertyAddressChange(e.target.value)}
                placeholder="Property address / Report title"
                className="flex-1"
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {format(new Date(report.created_at), 'PPp')}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col overflow-hidden min-h-0 px-4 py-4 sm:px-6">
          {hasChanges && (
            <Alert className="mb-4 flex-shrink-0">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                You have unsaved changes. Don't forget to save before closing.
              </AlertDescription>
            </Alert>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
            <TabsList className="grid w-full grid-cols-3 mb-4 flex-shrink-0 lg:max-w-3xl">
              <TabsTrigger value="content" className="flex items-center gap-2">
                <Type className="h-4 w-4" />
                Edit Content
              </TabsTrigger>
              <TabsTrigger value="sources" className="flex items-center gap-2">
                <Link className="h-4 w-4" />
                Edit Sources
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Preview
              </TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="flex-1 overflow-hidden mt-0 min-h-0 data-[state=active]:flex flex-col">
              <div className="flex-shrink-0 mb-4">
                <p className="text-sm font-medium mb-1">Report Content Editor</p>
                <p className="text-xs text-muted-foreground">
                  Edit the main investment analysis report using markdown syntax.
                </p>
              </div>
              <Textarea
                value={editedContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Enter your investment analysis report content..."
                className="flex-1 min-h-0 w-full resize-none overflow-auto rounded-md border p-4 font-mono text-sm leading-6 focus-visible:ring-1"
              />
            </TabsContent>

            <TabsContent value="sources" className="flex-1 overflow-hidden mt-0 min-h-0 data-[state=active]:flex flex-col">
              <div className="flex-shrink-0 mb-4">
                <p className="text-sm font-medium mb-1">Sources & Citations Editor</p>
                <p className="text-xs text-muted-foreground">
                  Edit the sources and citations section that will be appended to the report.
                </p>
              </div>
              <Textarea
                value={editedSources}
                onChange={(e) => handleSourcesChange(e.target.value)}
                placeholder="Enter sources and citations here..."
                className="flex-1 min-h-0 w-full resize-none overflow-auto rounded-md border p-4 font-mono text-sm leading-6 focus-visible:ring-1"
              />
            </TabsContent>

            <TabsContent value="preview" className="flex-1 overflow-hidden mt-0 min-h-0 data-[state=active]:flex flex-col">
              <div className="flex-shrink-0 mb-4">
                <p className="text-sm font-medium mb-1">Formatted Preview</p>
                <p className="text-xs text-muted-foreground">
                  See how your markdown will appear when rendered with proper formatting.
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
                <div className="p-4 sm:p-6 lg:p-8">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {editedContent}
                  </ReactMarkdown>
                  
                  {editedSources && (
                    <div className="mt-8 border-t pt-6">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {editedSources}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="flex-shrink-0 items-stretch justify-between gap-3 border-t border-border/70 px-4 py-4 sm:flex-row sm:items-center sm:px-6 sm:space-x-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {hasChanges ? (
              <Badge variant="outline" className="text-warning border-warning/30">
                <AlertCircle className="h-3 w-3 mr-1" />
                Unsaved changes
              </Badge>
            ) : (
              <Badge variant="outline" className="text-success border-success/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                All changes saved
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Content: {editedContent.length} chars • Sources: {editedSources.length} chars
            </span>
          </div>
          
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={!hasChanges || isSaving}
              className="min-w-[100px]"
            >
              {isSaving ? (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                  Saving...
                </div>
              ) : (
                <>
                  <Save className="h-3 w-3 mr-1" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}