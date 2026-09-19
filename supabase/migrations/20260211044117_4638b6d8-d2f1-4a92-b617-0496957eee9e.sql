-- Add missing report category enum values
ALTER TYPE report_category_enum ADD VALUE IF NOT EXISTS 'suburb';
ALTER TYPE report_category_enum ADD VALUE IF NOT EXISTS 'postcode';
ALTER TYPE report_category_enum ADD VALUE IF NOT EXISTS 'statewide';