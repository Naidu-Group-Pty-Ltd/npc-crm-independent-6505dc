import { readFileSync, writeFileSync } from 'node:fs';
import { applyOrganisationProjection } from './supabase/functions/_shared/organisationProjection.pure';
import { renderTemplateToHtml } from './src/lib/reportTemplate/htmlRenderer';

const settingsText = readFileSync('/tmp/claude-0/-home-user-npc-property-dashbord/a6d3b316-0027-5057-869d-008361ea2423/scratchpad/disclaimer.txt','utf8');
const FALLBACK = "This report has been prepared for the named recipient only and is general in nature. It does not take into account any person's objectives, financial situation or needs, and it is not financial product, credit, tax or legal advice. Figures are estimates based on information available at the date of preparation and are not a guarantee of future performance. Obtain your own professional advice before acting on it.";

// EXACTLY as production holds it: no x/y/width/height.
const props = {
  abn: '{{org.abn}}', mark: '{{org.markMono}}', email: '{{org.email}}',
  phone: '{{org.phone}}', address: '{{org.address}}', website: '{{org.website}}',
  fontSize: '{{org.disclaimerFontSize}}', markHeight: 37,
  companyName: '{{org.name}}', disclaimerText: '{{org.disclaimer}}',
  fontSizeFallback: 'small', disclaimerFallback: FALLBACK,
};

const data = applyOrganisationProjection({}, null, null, {
  contact: { company_name: 'Naidu Property Consulting Services', abn: '12 345 678 901',
             phone: '0400 000 000', email: 'admin@npcservices.com.au', website: 'npcservices.com.au',
             address: 'Suite 1, Sydney NSW 2000' },
  disclaimer: { text: settingsText, is_enabled: true, font_size: 'medium' },
});

const schema: any = { version: 1, tokens: {}, pages: [
  { id: 'p1', name: 'Important information', size: { width: 595, height: 842 },
    blocks: [{ id: 'b1', type: 'disclaimer', props }] },
]};

const { html } = renderTemplateToHtml(schema, { data });
writeFileSync('/tmp/claude-0/-home-user-npc-property-dashbord/a6d3b316-0027-5057-869d-008361ea2423/scratchpad/prod-disclaimer.html', html);
// What wrapper did the block get?
const m = html.match(/<div[^>]*>\s*<div style="position:absolute;inset:0;background:#141414/);
console.log('wrapper before block:', html.slice(Math.max(0,(m?.index??0)-260), (m?.index??0)+60).replace(/\n/g,' '));
