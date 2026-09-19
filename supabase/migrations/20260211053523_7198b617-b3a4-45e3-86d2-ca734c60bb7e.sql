-- Fix misclassified suburb reports that were saved as 'address' scope
-- These reports have suburb-style addresses (no street number/name) ending in ", Australia"
UPDATE investment_reports 
SET report_scope = 'suburb' 
WHERE id IN (
  'f58dc3ae-6fef-4940-b01d-c83e6ab82d82',
  'e0da0f83-8be0-4fea-881d-3fc150ffe22a',
  'f1e8b99c-2076-4dfd-b2f1-e9d3d321c829',
  'd440e90c-42d8-4ced-ba42-8c8cd590ad32',
  '0a621666-046d-4955-a0bd-e780e84c77ed'
);