
-- Function to recalculate client portfolio totals from their properties
CREATE OR REPLACE FUNCTION public.recalculate_client_portfolio_totals()
RETURNS TRIGGER AS $$
DECLARE
  target_client_id uuid;
  calc_portfolio_value numeric;
  calc_total_debt numeric;
  calc_net_cashflow numeric;
  calc_monthly_rental numeric;
  calc_monthly_expenditure numeric;
BEGIN
  -- Determine the affected client_id
  IF TG_OP = 'DELETE' THEN
    target_client_id := OLD.client_id;
  ELSE
    target_client_id := NEW.client_id;
  END IF;

  -- Calculate totals from properties, excluding 'rental' type from portfolio totals
  SELECT
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(value, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(loan_remaining, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(net_monthly_cashflow, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN property_type NOT IN ('rental', 'owner_occupied', 'Owner Occupied') THEN COALESCE(monthly_rental_income, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(total_monthly_expenditure, 0) ELSE 0 END), 0)
  INTO calc_portfolio_value, calc_total_debt, calc_net_cashflow, calc_monthly_rental, calc_monthly_expenditure
  FROM public.client_properties
  WHERE client_id = target_client_id;

  -- Update the client record
  UPDATE public.clients
  SET
    total_portfolio_value = calc_portfolio_value,
    total_debt = calc_total_debt,
    net_monthly_cash_flow = calc_net_cashflow,
    total_monthly_rental_income = calc_monthly_rental,
    total_monthly_expenditure = calc_monthly_expenditure,
    updated_at = now()
  WHERE id = target_client_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on client_properties
DROP TRIGGER IF EXISTS recalculate_client_totals_trigger ON public.client_properties;
CREATE TRIGGER recalculate_client_totals_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.client_properties
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_client_portfolio_totals();

-- Backfill: recalculate totals for ALL existing clients based on their current properties
UPDATE public.clients c
SET
  total_portfolio_value = sub.calc_portfolio_value,
  total_debt = sub.calc_total_debt,
  net_monthly_cash_flow = sub.calc_net_cashflow,
  total_monthly_rental_income = sub.calc_monthly_rental,
  total_monthly_expenditure = sub.calc_monthly_expenditure,
  updated_at = now()
FROM (
  SELECT
    client_id,
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(value, 0) ELSE 0 END), 0) AS calc_portfolio_value,
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(loan_remaining, 0) ELSE 0 END), 0) AS calc_total_debt,
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(net_monthly_cashflow, 0) ELSE 0 END), 0) AS calc_net_cashflow,
    COALESCE(SUM(CASE WHEN property_type NOT IN ('rental', 'owner_occupied', 'Owner Occupied') THEN COALESCE(monthly_rental_income, 0) ELSE 0 END), 0) AS calc_monthly_rental,
    COALESCE(SUM(CASE WHEN property_type != 'rental' THEN COALESCE(total_monthly_expenditure, 0) ELSE 0 END), 0) AS calc_monthly_expenditure
  FROM public.client_properties
  GROUP BY client_id
) sub
WHERE c.id = sub.client_id;
