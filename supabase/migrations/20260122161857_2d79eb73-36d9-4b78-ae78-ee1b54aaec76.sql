-- Remove remaining permissive "Anyone can..." policies

-- client_assets (different naming from earlier)
DROP POLICY IF EXISTS "Anyone can create client assets" ON public.client_assets;
DROP POLICY IF EXISTS "Anyone can delete client assets" ON public.client_assets;
DROP POLICY IF EXISTS "Anyone can update client assets" ON public.client_assets;
DROP POLICY IF EXISTS "Anyone can view client assets" ON public.client_assets;

-- client_employment
DROP POLICY IF EXISTS "Anyone can create client employment" ON public.client_employment;
DROP POLICY IF EXISTS "Anyone can delete client employment" ON public.client_employment;
DROP POLICY IF EXISTS "Anyone can update client employment" ON public.client_employment;
DROP POLICY IF EXISTS "Anyone can view client employment" ON public.client_employment;

-- client_expenses  
DROP POLICY IF EXISTS "Authenticated users can create client expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Authenticated users can delete client expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Authenticated users can update client expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Authenticated users can view client expenses" ON public.client_expenses;

-- client_import_logs
DROP POLICY IF EXISTS "Anyone can create import logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "Anyone can update import logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "Anyone can view import logs" ON public.client_import_logs;

-- client_income
DROP POLICY IF EXISTS "Anyone can create client income" ON public.client_income;
DROP POLICY IF EXISTS "Anyone can delete client income" ON public.client_income;
DROP POLICY IF EXISTS "Anyone can update client income" ON public.client_income;
DROP POLICY IF EXISTS "Anyone can view client income" ON public.client_income;

-- client_liabilities
DROP POLICY IF EXISTS "Anyone can create client liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Anyone can delete client liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Anyone can update client liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Anyone can view client liabilities" ON public.client_liabilities;