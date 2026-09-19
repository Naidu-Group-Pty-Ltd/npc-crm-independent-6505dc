import { DESIGN_FAMILIES, resolveManifest } from './investmentCompass/family';
import { beginCompassTemplate, contentTop } from './investmentCompass/blocks';
const LH = 1.55;
let worst = { key:'', lines: 999, size: 0, avail: 0 };
for (const f of DESIGN_FAMILIES) {
  for (const v of f.variants) {
    const m = resolveManifest(f, v);
    const c = beginCompassTemplate(f, v, m);
    const avail = c.contentBottom - contentTop() - 12;         // continuation page
    const size = c.scale.body;
    const fits = Math.floor(avail / (size * LH));
    if (fits < worst.lines) worst = { key:`${f.key}/${v.key}`, lines: fits, size, avail };
  }
}
console.log('tightest family/variant:', worst.key);
console.log(`  body ${worst.size}pt x ${LH} = ${(worst.size*LH).toFixed(2)}pt per line`);
console.log(`  available ${worst.avail.toFixed(0)}pt -> ${worst.lines} lines fit`);
console.log(`  current constant: 34`);
