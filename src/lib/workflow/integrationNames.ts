/**
 * Integration id → display name, for messages that name an integration the user
 * has to go and configure. Falls back to the id so a missing entry reads as an
 * unfamiliar name rather than an empty string.
 */

import { INTEGRATIONS } from '@/lib/integrations/registry';

const NAMES = new Map(INTEGRATIONS.map((integration) => [integration.id, integration.name]));

export const getIntegrationName = (id: string): string => NAMES.get(id) ?? id;
