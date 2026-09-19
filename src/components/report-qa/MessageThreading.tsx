import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Reply, X, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ThreadReply {
  id: string;
  content: string;
  timestamp: Date;
  role: 'user' | 'assistant';
}

interface MessageThreadingProps {
  messageId: string;
  messageContent: string;
  onReply: (messageId: string, reply: string) => void;
  replies?: ThreadReply[];
}

export function MessageThreading({ 
  messageId, 
  messageContent, 
  onReply,
  replies = []
}: MessageThreadingProps) {
  const [isReplying, setIsReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [showThread, setShowThread] = useState(false);

  const handleSubmitReply = () => {
    if (replyContent.trim()) {
      onReply(messageId, replyContent.trim());
      setReplyContent('');
      setIsReplying(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          onClick={() => setIsReplying(!isReplying)}
        >
          <Reply className="h-3 w-3" />
          Reply
        </Button>
        {replies.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] gap-1"
            onClick={() => setShowThread(!showThread)}
          >
            <MessageSquare className="h-3 w-3" />
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </Button>
        )}
      </div>

      {/* Reply input */}
      {isReplying && (
        <div className="ml-4 pl-3 border-l-2 border-primary/30 space-y-2">
          <div className="text-[10px] text-muted-foreground italic line-clamp-1">
            Replying to: "{messageContent.substring(0, 100)}..."
          </div>
          <Textarea
            placeholder="Write a follow-up question..."
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            className="min-h-[60px] text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleSubmitReply}
              disabled={!replyContent.trim()}
            >
              <Send className="h-3 w-3" />
              Send
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => {
                setIsReplying(false);
                setReplyContent('');
              }}
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Thread replies */}
      {showThread && replies.length > 0 && (
        <div className="ml-4 pl-3 border-l-2 border-muted space-y-2">
          {replies.map((reply) => (
            <div
              key={reply.id}
              className={cn(
                "p-2 rounded text-sm",
                reply.role === 'user' ? 'bg-primary/10' : 'bg-muted'
              )}
            >
              <div className="text-[10px] text-muted-foreground mb-1">
                {reply.role === 'user' ? 'You' : 'Assistant'} • {reply.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
              <p className="whitespace-pre-wrap">{reply.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Hook to manage thread state
export function useMessageThreads() {
  const [threads, setThreads] = useState<Map<string, ThreadReply[]>>(new Map());

  const addReply = (messageId: string, content: string, role: 'user' | 'assistant' = 'user') => {
    setThreads(prev => {
      const newThreads = new Map(prev);
      const existing = newThreads.get(messageId) || [];
      newThreads.set(messageId, [
        ...existing,
        {
          id: `reply-${Date.now()}`,
          content,
          timestamp: new Date(),
          role,
        },
      ]);
      return newThreads;
    });
  };

  const getReplies = (messageId: string): ThreadReply[] => {
    return threads.get(messageId) || [];
  };

  return { addReply, getReplies };
}
