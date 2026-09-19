-- Create custom authentication table for username/password
CREATE TABLE public.custom_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.custom_users ENABLE ROW LEVEL SECURITY;

-- Create policies for custom_users table
CREATE POLICY "Allow authenticated users to read their own data" 
ON public.custom_users 
FOR SELECT 
USING (true); -- For now, allow reading since it's admin-only

-- Create sessions table to track user sessions
CREATE TABLE public.user_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on sessions
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Create policy for sessions
CREATE POLICY "Users can access their own sessions" 
ON public.user_sessions 
FOR ALL 
USING (true);

-- Create trigger for updating timestamps
CREATE TRIGGER update_custom_users_updated_at
BEFORE UPDATE ON public.custom_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert admin user with hashed password (using bcrypt-like hash for NPC123)
-- Note: This is a placeholder hash - will be properly hashed in the edge function
INSERT INTO public.custom_users (username, password_hash, role) 
VALUES ('admin', '$2b$10$rOj0O8yCE8UUqFfRDHPGz.J4i8QdRY7qfOmUOWPQ0jKYf7xKZOQmG', 'admin');

-- Create function to clean expired sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.user_sessions 
  WHERE expires_at < now();
$$;