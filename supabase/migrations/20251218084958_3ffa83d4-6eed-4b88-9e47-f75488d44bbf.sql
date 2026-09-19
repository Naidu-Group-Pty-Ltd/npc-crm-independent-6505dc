-- Create table for Report Q&A conversations
CREATE TABLE public.report_qa_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.custom_users(id),
  report_names TEXT[] NOT NULL DEFAULT '{}',
  report_contents TEXT[] NOT NULL DEFAULT '{}',
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

-- Create table for Q&A messages
CREATE TABLE public.report_qa_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.report_qa_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_qa_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_qa_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for conversations
CREATE POLICY "Anyone can view Q&A conversations"
  ON public.report_qa_conversations
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create Q&A conversations"
  ON public.report_qa_conversations
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update Q&A conversations"
  ON public.report_qa_conversations
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete Q&A conversations"
  ON public.report_qa_conversations
  FOR DELETE
  USING (true);

-- RLS policies for messages
CREATE POLICY "Anyone can view Q&A messages"
  ON public.report_qa_messages
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create Q&A messages"
  ON public.report_qa_messages
  FOR INSERT
  WITH CHECK (true);

-- Create index for faster message lookups
CREATE INDEX idx_report_qa_messages_conversation ON public.report_qa_messages(conversation_id);
CREATE INDEX idx_report_qa_conversations_created ON public.report_qa_conversations(created_at DESC);

-- Add trigger for updated_at
CREATE TRIGGER update_report_qa_conversations_updated_at
  BEFORE UPDATE ON public.report_qa_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();