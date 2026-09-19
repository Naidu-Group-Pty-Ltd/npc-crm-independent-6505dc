import { useMemo } from 'react';
import { AdditionalContact } from '../AdditionalContactCard';

export interface ContactInfo {
  id: string; // 'primary', 'secondary', or the additional_contact uuid
  label: string; // Display name like "Primary - John Smith"
  contactType: 'primary' | 'secondary' | 'additional';
  additionalContactId?: string; // Only for additional contacts
  name: string; // Full name
}

/**
 * Builds a unified list of all contacts on a client profile.
 * Used to dynamically generate tabs for employment, income, address/ID, etc.
 */
export function useClientContacts(
  clientData?: {
    primary_first_name?: string;
    primary_surname?: string;
    secondary_first_name?: string | null;
    secondary_surname?: string | null;
  },
  additionalContacts: AdditionalContact[] = []
): ContactInfo[] {
  return useMemo(() => {
    const contacts: ContactInfo[] = [];

    // Primary contact (always exists)
    const primaryName = [clientData?.primary_first_name, clientData?.primary_surname].filter(Boolean).join(' ') || 'Primary';
    contacts.push({
      id: 'primary',
      label: `Primary`,
      contactType: 'primary',
      name: primaryName,
    });

    // Secondary contact (only if has a name)
    if (clientData?.secondary_first_name || clientData?.secondary_surname) {
      const secondaryName = [clientData?.secondary_first_name, clientData?.secondary_surname].filter(Boolean).join(' ') || 'Secondary';
      contacts.push({
        id: 'secondary',
        label: `Secondary`,
        contactType: 'secondary',
        name: secondaryName,
      });
    }

    // Additional contacts
    additionalContacts.forEach((c) => {
      if (!c.id) return; // Skip unsaved contacts
      const name = [c.first_name, c.surname].filter(Boolean).join(' ') || c.relationship;
      contacts.push({
        id: c.id,
        label: c.relationship || `Contact`,
        contactType: 'additional',
        additionalContactId: c.id,
        name,
      });
    });

    return contacts;
  }, [clientData?.primary_first_name, clientData?.primary_surname, clientData?.secondary_first_name, clientData?.secondary_surname, additionalContacts]);
}

/**
 * Gets the ordinal label for a contact index (1-based).
 */
export function getContactTabLabel(contact: ContactInfo): string {
  if (contact.contactType === 'primary') return 'Primary';
  if (contact.contactType === 'secondary') return 'Secondary';
  return contact.name || contact.label;
}
