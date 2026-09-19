import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { calculateIndustrialBc } from '@/utils/industrial';
import { useApplyPrefill } from '@/contexts/CalculatorPrefillContext';
import { SaveBackButton } from '@/components/commercial/SaveBackButton';

const fmt = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (v: string) => v === '' ? 0 : Number(v);

const bandVariant = (b: string) => b === 'green' ? 'default' : b === 'amber' ? 'secondary' : 'destructive';
const bindingLabel: Record<string, string> = {
  icr: 'ICR (Interest Coverage)',
  dscr: 'DSCR (Debt Service Coverage)',
  lvr: 'LVR ceiling',
  liquidity: 'Sponsor liquidity',
  none: 'None — no loan supportable',
};

export function IndustrialBcCard() {
  const [noi, setNoi] = useState('480000');
  const [propertyValue, setPropertyValue] = useState('7500000');
  const [rate, setRate] = useState('7.25');
  const [buffer, setBuffer] = useState('1.0');
  const [term, setTerm] = useState('20');
  const [maxLvr, setMaxLvr] = useState('0.60');
  const [minIcr, setMinIcr] = useState('1.75');
  const [minDscr, setMinDscr] = useState('1.35');
  const [liquidity, setLiquidity] = useState('0');
  const [liquidityMult, setLiquidityMult] = useState('0');

  useApplyPrefill((p) => {
    const px = p.purchasePrice ?? p.valuation;
    if (px != null) setPropertyValue(String(px));
    if (p.passingNoi != null) setNoi(String(p.passingNoi));
  });

  const result = useMemo(() => calculateIndustrialBc({
    noi: num(noi),
    propertyValue: num(propertyValue),
    interestRatePct: num(rate),
    bufferPct: num(buffer),
    loanTermYears: num(term),
    maxLvr: num(maxLvr),
    minIcr: num(minIcr),
    minDscr: num(minDscr),
    sponsorLiquidity: num(liquidity),
    sponsorLiquidityMultiplier: num(liquidityMult),
  }), [noi, propertyValue, rate, buffer, term, maxLvr, minIcr, minDscr, liquidity, liquidityMult]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Industrial Borrowing Capacity</CardTitle>
        <CardDescription>
          Sizes industrial loans with tighter LVR (60–65%) and stronger coverage (ICR ≥ 1.75x, DSCR ≥ 1.35x).
        </CardDescription>
        <div className="pt-2"><SaveBackButton build={() => ({ purchase_price: num(propertyValue), current_valuation: num(propertyValue) })} /></div>
      </CardHeader>
      <CardContent className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>NOI (PA)</Label><Input type="number" value={noi} onChange={e => setNoi(e.target.value)} /></div>
            <div><Label>Property value</Label><Input type="number" value={propertyValue} onChange={e => setPropertyValue(e.target.value)} /></div>
            <div><Label>Contract rate %</Label><Input type="number" step="0.05" value={rate} onChange={e => setRate(e.target.value)} /></div>
            <div><Label>Buffer %</Label><Input type="number" step="0.05" value={buffer} onChange={e => setBuffer(e.target.value)} /></div>
            <div><Label>Term (years)</Label><Input type="number" value={term} onChange={e => setTerm(e.target.value)} /></div>
            <div><Label>Max LVR (0–1)</Label><Input type="number" step="0.01" value={maxLvr} onChange={e => setMaxLvr(e.target.value)} /></div>
            <div><Label>Min ICR (x)</Label><Input type="number" step="0.05" value={minIcr} onChange={e => setMinIcr(e.target.value)} /></div>
            <div><Label>Min DSCR (x)</Label><Input type="number" step="0.05" value={minDscr} onChange={e => setMinDscr(e.target.value)} /></div>
            <div><Label>Sponsor liquidity</Label><Input type="number" value={liquidity} onChange={e => setLiquidity(e.target.value)} /></div>
            <div><Label>Liquidity multiplier</Label><Input type="number" step="0.5" value={liquidityMult} onChange={e => setLiquidityMult(e.target.value)} /></div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Maximum supportable loan</div>
              <div className="text-3xl font-bold text-primary">{fmt(result.maxLoan)}</div>
            </div>
            <Badge variant={bandVariant(result.band) as any} className="text-base px-3 py-1 capitalize">{result.band}</Badge>
          </div>

          <Separator />

          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Binding constraint</span><span className="font-medium">{bindingLabel[result.bindingConstraint]}</span></div>
            <div className="flex justify-between"><span>Implied LVR</span><span className="font-medium">{pct(result.impliedLvr)}</span></div>
            <div className="flex justify-between"><span>Assessment rate</span><span className="font-medium">{result.assessmentRatePct.toFixed(2)}%</span></div>
          </div>

          <Separator />

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Component caps</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>ICR cap</span><span>{fmt(result.caps.icrCap)}</span></div>
              <div className="flex justify-between"><span>DSCR cap</span><span>{fmt(result.caps.dscrCap)}</span></div>
              <div className="flex justify-between"><span>LVR cap</span><span>{fmt(result.caps.lvrCap)}</span></div>
              {result.caps.liquidityCap != null && (
                <div className="flex justify-between"><span>Liquidity cap</span><span>{fmt(result.caps.liquidityCap)}</span></div>
              )}
            </div>
          </div>

          <Separator />

          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Coverage at max loan</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>ICR</span><span>{result.coverageAtMax.icr.toFixed(2)}x</span></div>
              <div className="flex justify-between"><span>DSCR</span><span>{result.coverageAtMax.dscr.toFixed(2)}x</span></div>
              <div className="flex justify-between"><span>Annual interest</span><span>{fmt(result.coverageAtMax.annualInterest)}</span></div>
              <div className="flex justify-between"><span>Annual debt service</span><span>{fmt(result.coverageAtMax.annualDebtService)}</span></div>
            </div>
          </div>

          {result.notes.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              {result.notes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
