import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface FinanceContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  is_default: boolean;
  is_active: boolean;
  contact_type: string;
  notes: string | null;
}

export function useFinanceContacts() {
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['finance-agent-contacts'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'finance_agent_contacts',
        listOptions: {
          filters: { is_active: true },
          orderBy: 'is_default',
          orderAsc: false
        }
      });
      
      if (error) throw new Error(error.message);
      return (data?.records || []) as FinanceContact[];
    },
  });

  const defaultContact = contacts.find(c => c.is_default) || contacts[0];

  return {
    contacts,
    defaultContact,
    isLoading,
    hasContacts: contacts.length > 0,
  };
}