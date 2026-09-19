import { readFileSync } from 'node:fs';
import { buildCapacitySnapshot } from '../../supabase/functions/_shared/reports/commercialCapacity/normalise.pure';
import { applyCommercialCapacityProjection } from '../../supabase/functions/_shared/commercialCapacityProjection.pure';
const R=JSON.parse(readFileSync('/tmp/claude-0/-home-user/2d1fcc99-8bfb-51aa-8aa3-79bd8050091a/scratchpad/format-rows2.json','utf8')).commercial_capacity;
const snap=buildCapacitySnapshot({assessment:R.assessment,outputs:R.run?.outputs,inputs:R.run?.inputs_snapshot,clientName:'A Client Pty Ltd',analysis:(R.run?.analysis??null) as never} as any);
const d:any={}; applyCommercialCapacityProjection(d,snap as any);
const a=d.capacity?.analysis??{};
for (const k of ['scenarios','questions']) {
  const list=a[k]??[];
  console.log(`${k}: ${list.length}`);
  for (const [i,x] of list.entries()) {
    const vals=Object.entries(x).map(([kk,v])=>`${kk}=${String(v).length}`).join(' ');
    console.log(`   [${i}] ${vals}`);
    for (const [kk,v] of Object.entries(x)) if (String(v).length>60) console.log(`        ${kk}: ${String(v).slice(0,150)}`);
  }
}
