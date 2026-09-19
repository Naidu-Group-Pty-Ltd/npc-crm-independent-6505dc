INSERT INTO storage.buckets (id, name, public)
VALUES ('agency-agreements', 'agency-agreements', false)
ON CONFLICT (id) DO NOTHING;