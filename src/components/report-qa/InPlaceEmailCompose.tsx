import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Mail, FileText, Send, Loader2, X, Paperclip, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PDFAttachment {
  url: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  conversationId?: string;
}

interface ConversationContext {
  title: string;
  reportNames: string;
  messageCount: number;
  sampleQuestions: string[];
  generatedAt: string;
}

interface InPlaceEmailComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attachment: PDFAttachment | null;
  context?: ConversationContext;
  onSuccess?: () => void;
}

interface UserMailbox {
  id: string;
  username: string;
  email: string | null;
  personal_mailbox: string | null;
}

export const InPlaceEmailCompose: React.FC<InPlaceEmailComposeProps> = ({
  open,
  onOpenChange,
  attachment,
  context,
  onSuccess,
}) => {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [isLoadingPDF, setIsLoadingPDF] = useState(false);
  const [isLoadingMailboxes, setIsLoadingMailboxes] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  // Mailbox state
  const [availableMailboxes, setAvailableMailboxes] = useState<UserMailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState('');
  
  // Email form state
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);

  // Fetch available mailboxes when modal opens
  useEffect(() => {
    if (open) {
      fetchAvailableMailboxes();
    }
  }, [open]);

  const fetchAvailableMailboxes = async () => {
    setIsLoadingMailboxes(true);
    try {
      const { data, error } = await supabase
        .from('custom_users')
        .select('id, username, email, personal_mailbox')
        .eq('is_active', true)
        .not('personal_mailbox', 'is', null);

      if (error) throw error;

      const mailboxes = (data || []).filter(u => u.personal_mailbox);
      setAvailableMailboxes(mailboxes);
      
      // Auto-select the first mailbox if available and none selected
      if (mailboxes.length > 0 && !selectedMailbox) {
        setSelectedMailbox(mailboxes[0].personal_mailbox || '');
      }
    } catch (error) {
      console.error('Error fetching mailboxes:', error);
    } finally {
      setIsLoadingMailboxes(false);
    }
  };

  // Generate default email content based on context
  useEffect(() => {
    if (open && attachment && context) {
      // Set subject
      const subject = context.reportNames 
        ? `Property Analysis: ${context.reportNames.substring(0, 50)}${context.reportNames.length > 50 ? '...' : ''}`
        : `Q&A Conversation Export - ${attachment.fileName}`;
      setEmailSubject(subject);

      // Build email body
      const bodyParts: string[] = [];
      bodyParts.push(`Hi,\n`);
      bodyParts.push(`Please find attached the Q&A conversation summary regarding ${context.reportNames || 'the property analysis'}.`);
      
      if (context.messageCount) {
        bodyParts.push(`\nThis document contains a comprehensive summary of our ${context.messageCount}-message discussion.`);
      }
      
      if (context.sampleQuestions && context.sampleQuestions.length > 0) {
        bodyParts.push(`\nKey topics covered include:`);
        context.sampleQuestions.forEach((q: string) => {
          bodyParts.push(`  • ${q.substring(0, 80)}${q.length >= 80 ? '...' : ''}`);
        });
      }
      
      bodyParts.push(`\nPlease review at your earliest convenience and let me know if you have any questions.`);
      bodyParts.push(`\nBest regards`);
      
      setEmailBody(bodyParts.join('\n'));
    }
  }, [open, attachment, context]);

  // Fetch PDF when modal opens
  useEffect(() => {
    if (open && attachment?.url && !pdfFile) {
      fetchPDF();
    }
  }, [open, attachment?.url]);

  const fetchPDF = async () => {
    if (!attachment?.url) return;
    
    setIsLoadingPDF(true);
    setPdfError(null);
    
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        throw new Error('Failed to download PDF');
      }
      
      const blob = await response.blob();
      const file = new File([blob], attachment.fileName, { type: 'application/pdf' });
      setPdfFile(file);
    } catch (error) {
      console.error('Error fetching PDF:', error);
      setPdfError('Could not download PDF. You may need to regenerate it.');
    } finally {
      setIsLoadingPDF(false);
    }
  };

  const handleSend = async () => {
    if (!emailTo || !emailBody) {
      toast({
        title: 'Missing Information',
        description: 'Please enter recipient email and message body.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedMailbox) {
      toast({
        title: 'Missing Sender',
        description: 'Please select a sender mailbox.',
        variant: 'destructive',
      });
      return;
    }

    if (!pdfFile) {
      toast({
        title: 'PDF Not Ready',
        description: 'Please wait for the PDF to finish downloading or try regenerating it.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);

    try {
      // Convert PDF to base64
      const arrayBuffer = await pdfFile.arrayBuffer();
      const base64Content = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Parse CC emails
      const ccEmails = emailCc
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0);

      // Parse BCC emails
      const bccEmails = emailBcc
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0);

      // Call send-email-reply edge function
      const { data, error } = await invokeSecureFunction('send-email-reply', {
        to: emailTo.trim(),
        subject: emailSubject,
        body: emailBody,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        bcc: bccEmails.length > 0 ? bccEmails : undefined,
        senderMailbox: selectedMailbox,
        attachments: [
          {
            name: pdfFile.name,
            contentType: 'application/pdf',
            contentBytes: base64Content,
          }
        ],
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast({
        title: 'Email Sent!',
        description: `Successfully sent to ${emailTo}`,
      });

      // Reset and close
      onOpenChange(false);
      resetForm();
      onSuccess?.();
    } catch (error) {
      console.error('Error sending email:', error);
      toast({
        title: 'Failed to Send',
        description: error instanceof Error ? error.message : 'Could not send email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const resetForm = () => {
    setEmailTo('');
    setEmailCc('');
    setEmailBcc('');
    setEmailSubject('');
    setEmailBody('');
    setSelectedMailbox('');
    setPdfFile(null);
    setPdfError(null);
    setShowCcBcc(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetForm();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Send PDF via Email
          </DialogTitle>
          <DialogDescription>
            Compose and send your Q&A conversation export directly from here.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {/* PDF Attachment Preview */}
            {attachment && (
              <div className={cn(
                "p-4 rounded-lg border",
                pdfError 
                  ? "bg-brand-50 dark:bg-brand-950/30 border-brand-200 dark:border-brand-800"
                  : "bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2.5 rounded-lg",
                    pdfError ? "bg-brand-100 dark:bg-brand-900/50" : "bg-primary/10"
                  )}>
                    {isLoadingPDF ? (
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    ) : (
                      <FileText className={cn(
                        "h-6 w-6",
                        pdfError ? "text-brand-600" : "text-primary"
                      )} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{attachment.fileName}</p>
                      {!isLoadingPDF && !pdfError && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-success/30 text-success bg-success/10">
                          <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                          Ready
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(attachment.fileSize)}
                      {isLoadingPDF && ' • Downloading...'}
                      {pdfError && ` • ${pdfError}`}
                    </p>
                  </div>
                  {pdfError && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchPDF}
                      disabled={isLoadingPDF}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Sender and Recipients */}
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              {/* From (Sender Mailbox) */}
              <div className="grid grid-cols-[50px_1fr] gap-2 items-center">
                <Label className="text-sm text-muted-foreground">From: *</Label>
                <Select value={selectedMailbox} onValueChange={setSelectedMailbox} disabled={isLoadingMailboxes}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={isLoadingMailboxes ? "Loading..." : "Select sender mailbox"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMailboxes.map((mailbox) => (
                      <SelectItem key={mailbox.id} value={mailbox.personal_mailbox || ''}>
                        {mailbox.personal_mailbox} ({mailbox.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* To */}
              <div className="grid grid-cols-[50px_1fr] gap-2 items-center">
                <Label className="text-sm text-muted-foreground">To: *</Label>
                <Input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="recipient@example.com (comma-separated for multiple)"
                  type="email"
                  className="h-9"
                />
              </div>
              
              {/* CC/BCC Toggle */}
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowCcBcc(!showCcBcc)}
              >
                {showCcBcc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showCcBcc ? 'Hide CC/BCC' : 'Add CC/BCC'}
              </button>
              
              {/* CC */}
              {showCcBcc && (
                <>
                  <div className="grid grid-cols-[50px_1fr] gap-2 items-center">
                    <Label className="text-sm text-muted-foreground">CC:</Label>
                    <Input
                      value={emailCc}
                      onChange={(e) => setEmailCc(e.target.value)}
                      placeholder="cc@example.com (comma-separated)"
                      className="h-9"
                    />
                  </div>
                  
                  {/* BCC */}
                  <div className="grid grid-cols-[50px_1fr] gap-2 items-center">
                    <Label className="text-sm text-muted-foreground">BCC:</Label>
                    <Input
                      value={emailBcc}
                      onChange={(e) => setEmailBcc(e.target.value)}
                      placeholder="bcc@example.com (comma-separated)"
                      className="h-9"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Subject</Label>
              <Input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>

            {/* Body */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Message *</Label>
              <Textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                placeholder="Type your message..."
                className="h-[200px] resize-none"
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between border-t pt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span>1 attachment • {formatFileSize(attachment?.fileSize || 0)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSend}
              disabled={isSending || isLoadingPDF || !emailTo || !emailBody || !pdfFile || !selectedMailbox}
            >
              {isSending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InPlaceEmailCompose;
