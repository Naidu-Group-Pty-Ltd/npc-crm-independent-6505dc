import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bot, User, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatKnowledgeBaseForAI } from '@/lib/userGuideKnowledge';
import { describeAuthError, isAuthFailureResponse, resolveAuthBearer } from '@/lib/secureInvoke';
import { usePlanEntitlements } from '@/hooks/usePlanEntitlements';
import ReactMarkdown from 'react-markdown';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UserGuideAssistantProps {
  onNavigateToSection: (sectionId: string) => void;
}


// Parse section links from AI response
function parseSectionLinks(content: string): { text: string; sectionId: string; label: string }[] {
  const linkRegex = /\[\[section:([a-z-]+)\|([^\]]+)\]\]/g;
  const links: { text: string; sectionId: string; label: string }[] = [];
  let match;
  
  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      text: match[0],
      sectionId: match[1],
      label: match[2],
    });
  }
  
  return links;
}

// Render message content with clickable section links
function MessageContent({ 
  content, 
  onNavigateToSection 
}: { 
  content: string; 
  onNavigateToSection: (sectionId: string) => void;
}) {
  // Replace section links with clickable buttons
  const processedContent = content.replace(
    /\[\[section:([a-z-]+)\|([^\]]+)\]\]/g,
    '**[$2](#section-$1)**'
  );

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#section-')) {
              const sectionId = href.replace('#section-', '');
              return (
                <button
                  onClick={() => onNavigateToSection(sectionId)}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                >
                  {children}
                  <ArrowRight className="h-3 w-3" />
                </button>
              );
            }
            return <a href={href}>{children}</a>;
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

export function UserGuideAssistant({ onNavigateToSection }: UserGuideAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const knowledgeBaseRef = useRef<string>('');
  // The assistant needs the plan to answer "can I use X", not just "what is X".
  const { planSlug, addonSlugs, loading: planLoading } = usePlanEntitlements();

  // Rebuilt when the plan resolves. Building it once on mount would bake in
  // the pre-load "plan unknown" state and the assistant would answer
  // availability questions blind for the rest of the session.
  useEffect(() => {
    // Populated immediately with the plan-unknown variant so a question asked
    // before the plan resolves still gets the full feature documentation — it
    // just tells the assistant to ask which plan the user is on rather than
    // assume. Refined the moment the real plan lands.
    knowledgeBaseRef.current = formatKnowledgeBaseForAI(
      planLoading ? null : planSlug,
      planLoading ? undefined : addonSlugs,
    );
  }, [planSlug, addonSlugs, planLoading]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Prepare messages for API
    const apiMessages = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      // Cookie-authenticated path (ES256 remediation). Reading
      // `supabase_access_token` straight out of storage bypassed the shared
      // resolver, so a missing token silently became `Bearer <anon>` with no
      // refresh attempt and no way to tell a real 401 from a server fault.
      // `resolveAuthBearer` tries storage, then the native session, then
      // re-mints from the HttpOnly cookie.
      //
      // Authority still rests with the server: the browser cannot read an
      // HttpOnly cookie, so it cannot know it is signed in. We send the
      // request and let a 401 be a 401 — which is also why this stays correct
      // once the access token is retired and the cookie is the sole carrier.
      const { token: bearer } = await resolveAuthBearer({ refreshIfMissing: true });

      const response = await fetch(`${SUPABASE_URL}/functions/v1/user-guide-assistant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${bearer}`,
        },
        credentials: 'include', // Sends the HttpOnly session cookie
        body: JSON.stringify({
          messages: apiMessages,
          knowledgeBase: knowledgeBaseRef.current,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Turn an auth failure into the one instruction that resolves it,
        // rather than surfacing a bare HTTP code to the user.
        const authGuidance = isAuthFailureResponse(response.status, errorData?.error)
          ? describeAuthError(errorData?.error) ?? 'Your sign-in session has expired. Sign out, sign back in, and try again.'
          : null;
        throw new Error(authGuidance || errorData.error || `HTTP ${response.status}`);
      }

      // Stream the response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantId = crypto.randomUUID();

      // Add empty assistant message to update progressively
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }]);

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              setMessages(prev => 
                prev.map(m => 
                  m.id === assistantId 
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            }
          } catch {
            // Incomplete JSON, put back in buffer
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

    } catch (error) {
      console.error('Assistant error:', error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `I'm sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQuestions = [
    "How do I generate an investment report?",
    "What is the Email Copilot?",
    "How do I import clients?",
    "How do I set up integrations?",
  ];

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl",
          isOpen && "hidden"
        )}
      >
        <Sparkles className="h-5 w-5" />
        <span className="font-medium">Ask AI Guide</span>
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                <Bot className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">User Guide Assistant</h3>
                <p className="text-xs text-muted-foreground">Ask me anything about the dashboard</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="space-y-4">
                <div className="text-center text-muted-foreground">
                  <Bot className="mx-auto h-12 w-12 text-primary/50 mb-3" />
                  <p className="text-sm font-medium">Welcome! I'm here to help you navigate the dashboard.</p>
                  <p className="text-xs mt-1">Ask me anything about features, how-tos, or best practices.</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Try asking:</p>
                  {suggestedQuestions.map((question, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(question);
                        textareaRef.current?.focus();
                      }}
                      className="block w-full rounded-lg border bg-muted/50 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3",
                      message.role === 'user' && "flex-row-reverse"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        message.role === 'user'
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      {message.role === 'user' ? (
                        <User className="h-4 w-4" />
                      ) : (
                        <Bot className="h-4 w-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-2",
                        message.role === 'user'
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      {message.role === 'user' ? (
                        <p className="text-sm">{message.content}</p>
                      ) : message.content ? (
                        <MessageContent 
                          content={message.content} 
                          onNavigateToSection={(sectionId) => {
                            onNavigateToSection(sectionId);
                            setIsOpen(false);
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Thinking...</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about any feature..."
                className="min-h-[44px] max-h-[120px] resize-none"
                rows={1}
                disabled={isLoading}
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                size="icon"
                className="shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </div>
      )}
    </>
  );
}
