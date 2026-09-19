-- Back-fill clients.finance_contact_id from existing finance_portal_client_assignments
-- so the cascade is consistent for clients that were assigned before the cascade logic existed.
UPDATE clients c
SET finance_contact_id = fpu.finance_contact_id
FROM finance_portal_client_assignments a
JOIN finance_portal_users fpu ON fpu.id = a.finance_user_id
WHERE a.client_id = c.id
  AND c.finance_contact_id IS NULL
  AND fpu.finance_contact_id IS NOT NULL;