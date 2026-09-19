ALTER TABLE public.whitelabel_settings
  ADD COLUMN IF NOT EXISTS theme_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logo_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS theme_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.whitelabel_settings.theme_config IS 'Structured raw brand theme inputs used to derive semantic tokens.';
COMMENT ON COLUMN public.whitelabel_settings.logo_config IS 'Structured brand asset metadata and slot configuration.';
COMMENT ON COLUMN public.whitelabel_settings.theme_version IS 'Version number for the brand theme/config contract.';

UPDATE public.whitelabel_settings
SET
  theme_config = jsonb_strip_nulls(jsonb_build_object(
    'primaryColor', primary_color,
    'accentColor', accent_color,
    'darkModeDefault', dark_mode_default,
    'emailSignature', jsonb_build_object(
      'banner', email_signature_banner,
      'name', email_signature_name,
      'title', email_signature_title,
      'phone', email_signature_phone,
      'email', email_signature_email,
      'website', email_signature_website,
      'address', email_signature_address,
      'disclaimer', email_signature_disclaimer
    )
  )),
  logo_config = jsonb_strip_nulls(jsonb_build_object(
    'auth', auth_logo,
    'sidebar', sidebar_logo,
    'sidebarIcon', sidebar_icon,
    'favicon', favicon
  )),
  theme_version = COALESCE(theme_version, 1)
WHERE
  theme_config = '{}'::jsonb
  OR logo_config = '{}'::jsonb
  OR theme_version IS NULL;

CREATE OR REPLACE FUNCTION public.validate_whitelabel_settings_payload()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  color_pattern constant text := '^([0-9]{1,3}\s+[0-9]{1,3}%\s+[0-9]{1,3}%|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})$';
  derived_primary text;
  derived_accent text;
  derived_theme_mode text;
BEGIN
  IF NEW.dark_mode_default NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'dark_mode_default must be one of light, dark, or system';
  END IF;

  IF NEW.primary_color IS NOT NULL AND NEW.primary_color !~ color_pattern THEN
    RAISE EXCEPTION 'primary_color must be a valid HSL token string or hex color';
  END IF;

  IF NEW.accent_color IS NOT NULL AND NEW.accent_color !~ color_pattern THEN
    RAISE EXCEPTION 'accent_color must be a valid HSL token string or hex color';
  END IF;

  IF jsonb_typeof(NEW.theme_config) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'theme_config must be a JSON object';
  END IF;

  IF jsonb_typeof(NEW.logo_config) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'logo_config must be a JSON object';
  END IF;

  derived_primary := COALESCE(NEW.theme_config->>'primaryColor', NEW.primary_color);
  derived_accent := COALESCE(NEW.theme_config->>'accentColor', NEW.accent_color);
  derived_theme_mode := COALESCE(NEW.theme_config->>'darkModeDefault', NEW.dark_mode_default);

  IF derived_primary IS NOT NULL AND derived_primary !~ color_pattern THEN
    RAISE EXCEPTION 'theme_config.primaryColor must be a valid HSL token string or hex color';
  END IF;

  IF derived_accent IS NOT NULL AND derived_accent !~ color_pattern THEN
    RAISE EXCEPTION 'theme_config.accentColor must be a valid HSL token string or hex color';
  END IF;

  IF derived_theme_mode IS NOT NULL AND derived_theme_mode NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'theme_config.darkModeDefault must be one of light, dark, or system';
  END IF;

  IF NEW.theme_version < 1 THEN
    RAISE EXCEPTION 'theme_version must be greater than or equal to 1';
  END IF;

  IF NEW.theme_version >= 2 THEN
    IF COALESCE(NEW.logo_config->>'auth', NEW.auth_logo) IS NULL
       OR COALESCE(NEW.logo_config->>'sidebar', NEW.sidebar_logo) IS NULL
       OR COALESCE(NEW.logo_config->>'sidebarIcon', NEW.sidebar_icon) IS NULL
       OR COALESCE(NEW.logo_config->>'favicon', NEW.favicon) IS NULL THEN
      RAISE EXCEPTION 'theme_version 2+ requires auth, sidebar, sidebar icon, and favicon assets';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_whitelabel_settings_payload ON public.whitelabel_settings;
CREATE TRIGGER validate_whitelabel_settings_payload
BEFORE INSERT OR UPDATE ON public.whitelabel_settings
FOR EACH ROW
EXECUTE FUNCTION public.validate_whitelabel_settings_payload();