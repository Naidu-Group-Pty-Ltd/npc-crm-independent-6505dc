import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../../supabase/functions/_shared/reports/markdown.pure';
import { packMarkdownPages } from '../../supabase/functions/_shared/reports/markdownPaging.pure';
import { buildMarketIntelligenceReport } from '../../supabase/functions/_shared/reports/marketIntelligence/normalise.pure';
const row=JSON.parse(readFileSync('/tmp/claude-0/-home-user/2d1fcc99-8bfb-51aa-8aa3-79bd8050091a/scratchpad/format-rows2.json','utf8')).market_intelligence;
const built:any=buildMarketIntelligenceReport({row,preparedOn:'2026-08-13T00:00:00.000Z',brandName:'NPC',audienceOverride:null} as any);
const src=String(built.report.prose.actionableStrategy??'');
const res=renderMarkdown(src);
const pages=packMarkdownPages(res.blocks,34);
console.log('strategy chars:',src.length,' blocks:',res.blocks.length,' pages@34:',pages.length);
for (const [i,pg] of pages.entries()){
  const lines=pg.reduce((s,b)=>s+b.lines,0);
  const kinds=pg.map(b=>b.kind).join(',');
  console.log(`  page ${i}: ${lines} est. lines, ${pg.length} blocks [${kinds.slice(0,90)}]`);
}
