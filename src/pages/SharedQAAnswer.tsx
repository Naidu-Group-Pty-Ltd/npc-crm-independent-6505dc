import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, AlertCircle, MessageSquare } from 'lucide-react';

interface SharedAnswer {
  message_id: string;
  conversation_id: string;
  conversation_title: string;
  role: string;
  content: string;
  created_at: string;
  model_provider: string | null;
}

export default function SharedQAAnswer() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState<SharedAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError('Missing share token');
        setLoading(false);
        return;
      }
      try {
        const { data, error: invErr } = await supabase.functions.invoke('report-qa', {
          body: { action: 'get-shared-answer-public', shareToken: token },
        });
        if (cancelled) return;
        if (invErr) throw invErr;
        if (data?.error) throw new Error(data.error);
        setAnswer(data?.answer || null);
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load answer');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <MessageSquare className="h-4 w-4" />
            <span>Shared Q&amp;A Answer</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold">
            {answer?.conversation_title || 'Loading...'}
          </h1>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading answer...
          </div>
        )}

        {error && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                Unavailable
              </CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The link may have been revoked or never existed.
              </p>
            </CardContent>
          </Card>
        )}

        {answer && !error && (
          <Card>
            <CardHeader>
              <CardDescription>
                {new Date(answer.created_at).toLocaleString('en-AU')}
                {answer.model_provider ? ` · ${answer.model_provider}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <article className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer.content}</ReactMarkdown>
              </article>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
