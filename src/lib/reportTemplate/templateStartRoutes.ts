/**
 * The three ways a template comes into existence, said once.
 *
 * ## Why this is data and not three buttons
 *
 * The Template Builder header used to offer `Import PDF`, `Converter` and
 * `New template` as three equal buttons with no explanation, and the honest
 * feedback was "I have no idea where the converter is or what it does". The
 * count was never really the problem — it was that nothing said what you get
 * from each, and the two that sound alike do very different things:
 *
 * - **Import** keeps the layout. It reconstructs a PDF as editable pages.
 * - **Convert** throws the layout away and keeps the argument — which sections
 *   exist, in what order — and re-sets that on the report design system.
 *
 * That distinction is the whole reason they cannot collapse into one "bring in
 * a PDF" action, so it lives here, once, and is rendered wherever somebody is
 * choosing: the split-button menu, the zero-template empty state, and the
 * Templates page.
 *
 * `outcome` is the field that was missing. "What do I end up with?" is the
 * question, and each route now answers it in four words.
 *
 * A module rather than part of the component, so a spec can assert the copy
 * without rendering, and so the component file exports only components.
 */
import { FilePlus2, Upload, Wand2 } from 'lucide-react';

export type TemplateStartKey = 'blank' | 'import' | 'convert';

export interface TemplateStartRoute {
  key: TemplateStartKey;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  /** One sentence on what happens. */
  body: string;
  /** What you are left holding. The sentence people actually need. */
  outcome: string;
  cta: string;
  /** Where it goes, when it is a route rather than a dialog. */
  href?: string;
}

export const TEMPLATE_START_ROUTES: readonly TemplateStartRoute[] = [
  {
    key: 'blank',
    icon: FilePlus2,
    title: 'Start blank',
    body: 'An empty A4 page in the visual editor. Drag, drop and bind blocks to live report data.',
    outcome: 'An editable template',
    cta: 'New template',
  },
  {
    key: 'import',
    icon: Upload,
    title: 'Import a PDF',
    body: 'Reconstructs an existing PDF as pages you can edit, keeping its original layout as '
      + 'closely as it can.',
    outcome: 'An editable template',
    cta: 'Import PDF',
  },
  {
    key: 'convert',
    icon: Wand2,
    title: 'Convert an existing template',
    body: 'Keeps the structure of a template you already send clients — its sections and their '
      + 'order — and re-sets it on the report design system, bound to a report format. The old '
      + 'layout is deliberately not carried across.',
    outcome: 'A finished PDF, and an editable template',
    cta: 'Open the converter',
    href: '/admin/template-builder/converter',
  },
] as const;

/** Where the converter lives. One string, so a move is one edit. */
export const TEMPLATE_CONVERTER_PATH = '/admin/template-builder/converter';
export const TEMPLATE_BUILDER_PATH = '/admin/template-builder';
/** Where design systems are managed, imported and previewed. */
export const BRAND_SYSTEMS_PATH = '/admin/template-builder/brand-systems';
