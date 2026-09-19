import { useState, useEffect } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface ContactDetails {
  company_name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  abn: string;
}

export interface ProfessionalDisclaimer {
  text: string;
  is_enabled: boolean;
  font_size?: 'small' | 'medium' | 'large';
}

export interface GlobalReportSettings {
  contactDetails: ContactDetails;
  disclaimer: ProfessionalDisclaimer;
}

const defaultContactDetails: ContactDetails = {
  company_name: '',
  phone: '',
  email: '',
  website: '',
  address: '',
  abn: ''
};

/**
 * The disclaimer nobody has written yet.
 *
 * This used to hold the prime's own wording verbatim — *"AS A PROFESSIONAL
 * PROPERTY CONSULTANT & BUYERS AGENT, WE PROVIDE INFORMATION AND ADVICE BASED
 * ON OUR EXPERTISE…"* — which every deployment inherited whenever this read
 * failed or the settings row was absent. That put one business's trading
 * identity, and its description of a licensed service, on another business's
 * document.
 *
 * It is empty now, and the text is resolved where the document is issued:
 * `_shared/reports/issuerIdentity.pure.ts` picks the wording from WHO is
 * issuing, because a disclaimer is a statement by the issuer about the issuer.
 * An unbranded deployment gets the platform's; a named one gets its own, or a
 * neutral default written for nobody in particular.
 */
const defaultDisclaimer: ProfessionalDisclaimer = {
  text: '',
  is_enabled: true,
  font_size: 'small'
};

export function useGlobalReportSettings() {
  const [settings, setSettings] = useState<GlobalReportSettings>({
    contactDetails: defaultContactDetails,
    disclaimer: defaultDisclaimer
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error: fetchError } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'global_report_settings'
      });

      if (fetchError) throw new Error(fetchError.message);

      const records = data?.records || [];

      let contactDetails = defaultContactDetails;
      let disclaimer = defaultDisclaimer;

      records?.forEach((setting: any) => {
        if (setting.setting_key === 'contact_details') {
          contactDetails = setting.setting_value as unknown as ContactDetails;
        } else if (setting.setting_key === 'professional_disclaimer') {
          disclaimer = setting.setting_value as unknown as ProfessionalDisclaimer;
        }
      });

      setSettings({ contactDetails, disclaimer });
    } catch (err) {
      console.error('Error fetching global report settings:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch settings'));
    } finally {
      setIsLoading(false);
    }
  };

  return { settings, isLoading, error, refetch: fetchSettings };
}

// Standalone function to fetch settings (for use in non-hook contexts)
export async function fetchGlobalReportSettings(): Promise<GlobalReportSettings> {
  try {
    const { data, error } = await invokeSecureFunction('manage-templates', {
      operation: 'list',
      table: 'global_report_settings'
    });

    if (error) throw new Error(error.message);

    const records = data?.records || [];

    let contactDetails = defaultContactDetails;
    let disclaimer = defaultDisclaimer;

    records?.forEach((setting: any) => {
      if (setting.setting_key === 'contact_details') {
        contactDetails = setting.setting_value as unknown as ContactDetails;
      } else if (setting.setting_key === 'professional_disclaimer') {
        disclaimer = setting.setting_value as unknown as ProfessionalDisclaimer;
      }
    });

    return { contactDetails, disclaimer };
  } catch (err) {
    console.error('Error fetching global report settings:', err);
    return {
      contactDetails: defaultContactDetails,
      disclaimer: defaultDisclaimer
    };
  }
}