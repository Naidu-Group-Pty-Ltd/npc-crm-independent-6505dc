DO $$
DECLARE
  ghost RECORD;
  real_id UUID;
  new_id TEXT;
BEGIN
  -- Phase 1: For each ghost (placeholder) client, move its new_ghl_id onto the matching real client
  FOR ghost IN
    SELECT g.id AS ghost_id, g.ghl_contact_id AS new_ghl_id, r.id AS real_id
    FROM clients g
    JOIN ghl_id_mapping m
      ON m.resource_type='contact' AND m.new_ghl_id = g.ghl_contact_id
    JOIN clients r
      ON r.id <> g.id AND r.ghl_contact_id = m.old_ghl_id
    WHERE g.primary_email LIKE 'legacy-%@migrated.placeholder.local'
  LOOP
    -- Free the new_ghl_id from the ghost first (unique constraint)
    UPDATE clients SET ghl_contact_id = NULL WHERE id = ghost.ghost_id;
    -- Assign it to the real client
    UPDATE clients
       SET ghl_contact_id = ghost.new_ghl_id,
           ghl_sync_status = 'synced',
           ghl_last_synced_at = now()
     WHERE id = ghost.real_id;
  END LOOP;

  -- Phase 2: Delete all placeholder ghost rows (already verified to have zero attached data)
  DELETE FROM clients WHERE primary_email LIKE 'legacy-%@migrated.placeholder.local';

  -- Phase 3: Backfill the remaining mapped clients (old_id -> new_id)
  UPDATE clients c
     SET ghl_contact_id = m.new_ghl_id,
         ghl_sync_status = 'synced',
         ghl_last_synced_at = now()
    FROM ghl_id_mapping m
   WHERE m.resource_type = 'contact'
     AND m.new_ghl_id IS NOT NULL
     AND m.old_ghl_id = c.ghl_contact_id
     AND c.ghl_contact_id <> m.new_ghl_id
     AND NOT EXISTS (
       SELECT 1 FROM clients c2 WHERE c2.ghl_contact_id = m.new_ghl_id AND c2.id <> c.id
     );
END $$;