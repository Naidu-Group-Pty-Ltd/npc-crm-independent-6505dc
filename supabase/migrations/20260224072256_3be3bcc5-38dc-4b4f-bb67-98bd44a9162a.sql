INSERT INTO public.dashboard_modules (module_key, module_name, description, is_active)
VALUES ('cloudflare', 'Cloudflare', 'Cloudflare CDN, analytics, Workers, and firewall management', true)
ON CONFLICT (module_key) DO NOTHING;