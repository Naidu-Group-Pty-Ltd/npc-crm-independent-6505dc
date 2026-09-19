
-- Clean up duplicate client_income records (keep most recent per client_id + contact_type)
DELETE FROM client_income
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, contact_type ORDER BY created_at DESC) as rn
    FROM client_income
  ) ranked
  WHERE rn > 1
);

-- Clean up duplicate client_employment records (keep most recent per client_id + contact_type)
DELETE FROM client_employment
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, contact_type ORDER BY created_at DESC) as rn
    FROM client_employment
  ) ranked
  WHERE rn > 1
);

-- Clean up duplicate client_assets records (keep most recent per client_id + asset_type + description)
DELETE FROM client_assets
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, asset_type, COALESCE(description, ''), COALESCE(make_model, '') ORDER BY created_at DESC) as rn
    FROM client_assets
  ) ranked
  WHERE rn > 1
);

-- Clean up duplicate client_liabilities records (keep most recent per client_id + liability_type + provider)
DELETE FROM client_liabilities
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, liability_type, COALESCE(provider_name, '') ORDER BY created_at DESC) as rn
    FROM client_liabilities
  ) ranked
  WHERE rn > 1
);

-- Clean up duplicate client_properties records (keep most recent per client_id + address)
DELETE FROM client_properties
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, address ORDER BY created_at DESC) as rn
    FROM client_properties
  ) ranked
  WHERE rn > 1
);

-- Clean up duplicate client_additional_contacts records (keep most recent per client_id + first_name + surname)
DELETE FROM client_additional_contacts
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY client_id, first_name, surname ORDER BY created_at DESC) as rn
    FROM client_additional_contacts
  ) ranked
  WHERE rn > 1
);
