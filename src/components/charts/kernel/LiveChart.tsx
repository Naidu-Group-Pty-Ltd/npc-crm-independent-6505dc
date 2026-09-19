// LiveChart — the shared primitive that renders any NormalisedChartModel.
//
// Consumers should NOT reach into Recharts directly. Feed a raw chart record
// through `normaliseChartConfig` (or pass one you already normalized) and let
// this primitive handle:
//   • Bar / horizontal bar / stacked bar
//   • Line / Area / Stacked area
//   • Pie / Donut
//   • Scatter, Radar, Combo (bar + line + area mix)
//   • Card / expanded / export variants (fonts, margins, legend density)
//
// Rendering intentionally uses `isAnimationActive={false}` so exports and
// virtualised card grids remain deterministic.

import { useId, useMemo } from 'react';
import {
  Area, AreaChart,
  Bar, BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line, LineChart,
  Pie, PieChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart,
  ResponsiveContainer,
  Scatter, ScatterChart,
  Tooltip,
  XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  normaliseChartConfig,
  type NormalisedChartModel,
} from './normaliseChartConfig';

export type LiveChartVariant = 'card' | 'expanded' | 'export';

interface LiveChartProps {
  chart?: {
    id?: string;
    chart_type?: string;
    title?: string;
    chart_config?: any;
    dataset?: any;
  };
  model?: NormalisedChartModel | null;
  variant?: LiveChartVariant;
  className?: string;
}

function tickSize(v: LiveChartVariant) { return v === 'card' ? 11 : v === 'export' ? 24 : 13; }
function titleSize(v: LiveChartVariant) { return v === 'card' ? 12 : v === 'export' ? 30 : 17; }
function legendFont(v: LiveChartVariant) { return v === 'export' ? 22 : v === 'card' ? 10 : 13; }
function marginFor(v: LiveChartVariant) {
  return v === 'card'
    ? { top: 8, right: 10, left: -6, bottom: 18 }
    : v === 'export'
      ? { top: 26, right: 72, left: 44, bottom: 76 }
      : { top: 24, right: 48, left: 18, bottom: 68 };
}

export function LiveChart({ chart, model: providedModel, variant = 'card', className }: LiveChartProps) {
  const model = useMemo(
    () => providedModel ?? (chart ? normaliseChartConfig(chart) : null),
    [providedModel, chart],
  );
  // Unique defs namespace per instance so gradients/filters never collide when
  // multiple charts share a page (Overview, Charts index, exports side by side).
  const rawId = useId();
  const defsId = useMemo(() => `lc-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
  if (!model) return null;

  const isCard = variant === 'card';
  const isExport = variant === 'export';
  const fontSize = tickSize(variant);
  const labelSize = isExport ? 22 : isCard ? 9 : 12;
  // Export variant keeps hard-coded high-contrast styles so downloaded PNGs
  // remain legible against any viewer background. Card/expanded variants
  // use semantic tokens so they inherit the app's dark-gold theme and stay
  // transparent over the parent gradient surface (Overview parity).
  const tooltipStyle = isExport
    ? { borderRadius: 14, border: '1px solid rgba(245,158,11,0.38)', background: '#0f172a', color: '#f8fafc', boxShadow: '0 18px 42px rgba(2,6,23,.32)', fontSize: 22, padding: '10px 14px' }
    : { borderRadius: 14, border: '1px solid hsl(var(--border) / 0.65)', background: 'hsl(var(--popover) / 0.92)', color: 'hsl(var(--popover-foreground))', boxShadow: '0 24px 60px hsl(var(--foreground) / 0.22), 0 0 0 1px hsl(var(--primary) / 0.08)', fontSize: 13, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', padding: '8px 12px' };
  const tooltipLabelStyle = isExport ? { color: '#fef3c7', fontWeight: 800 } : { color: 'hsl(var(--primary))', fontWeight: 700, letterSpacing: '0.01em' };
  const legendStyle = { fontSize: legendFont(variant), paddingTop: isCard ? 4 : 8, color: 'hsl(var(--muted-foreground))' };
  const margin = marginFor(variant);
  const containerKey = `${chart?.id || 'live'}-${variant}-${model.kind}`;

  // Legends removed platform-wide: chart title/subtitle + axis labels convey the series identity.
  const showLegend = false;
  const barSize = isExport ? 120 : isCard ? 56 : 88;
  const tickInterval = isCard ? Math.max(0, Math.ceil(model.data.length / 7) - 1) : Math.max(0, Math.ceil(model.data.length / 12) - 1);

  // Export mode is rasterised into PNGs that land in PDFs and printed reports, so
  // it deliberately pins fixed light colours instead of theme tokens — otherwise a
  // chart exported while the dashboard is in dark mode would bake a black surface
  // into the document. On-screen rendering uses tokens and themes normally.
  const surfaceClass = isExport
    ? 'bg-white text-slate-900'
    : 'bg-transparent text-foreground';
  const titleClass = isExport ? 'text-slate-800' : 'text-foreground';
  const subtitleClass = isExport ? 'text-slate-500' : 'text-muted-foreground';

  const ctx: InnerCtx = { model, variant, isCard, isExport, fontSize, labelSize, tooltipStyle, tooltipLabelStyle, legendStyle, margin, showLegend, barSize, tickInterval, defsId };

  return (
    <div className={`flex h-full w-full flex-col ${surfaceClass} ${className || ''}`}>
      {!isCard && <div className={`shrink-0 text-center font-bold ${titleClass}`} style={{ fontSize: titleSize(variant), lineHeight: 1.25 }}>
        {model.title}
      </div>}
      {!isCard && model.subtitle ? (
        <div className={`shrink-0 text-center ${subtitleClass}`} style={{ fontSize: Math.round(titleSize(variant) * 0.72) }}>
          {model.subtitle}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%" debounce={0} key={containerKey}>
          {renderInner(ctx)}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface InnerCtx {
  model: NormalisedChartModel;
  variant: LiveChartVariant;
  isCard: boolean;
  isExport: boolean;
  fontSize: number;
  labelSize: number;
  tooltipStyle: React.CSSProperties;
  tooltipLabelStyle: React.CSSProperties;
  legendStyle: React.CSSProperties;
  margin: { top: number; right: number; bottom: number; left: number };
  showLegend: boolean;
  barSize: number;
  tickInterval: number;
  defsId: string;
}

function renderInner(ctx: InnerCtx): React.ReactElement {
  const { model } = ctx;
  switch (model.kind) {
    case 'pie':
    case 'donut':
      return renderPie(ctx);
    case 'scatter':
      return renderScatter(ctx);
    case 'radar':
      return renderRadar(ctx);
    case 'line':
      return renderLine(ctx);
    case 'area':
    case 'area-stacked':
      return renderArea(ctx);
    case 'combo':
      return renderCombo(ctx);
    case 'bar-horizontal':
      return renderBar(ctx, { horizontal: true });
    case 'bar-stacked':
      return renderBar(ctx, { stacked: true });
    case 'bar':
    default:
      return renderBar(ctx, {});
  }
}

function axisTick(fontSize: number) {
  return { fontSize, fill: 'hsl(var(--muted-foreground))' };
}
const GRID_STROKE = 'hsl(var(--border) / 0.55)';

/**
 * Shared SVG defs for a chart instance: vertical bar-fill gradients per series,
 * area gradients (kept for kinds that use their own), and a soft glow filter
 * used by lines and active dots. On-screen only — export mode skips gradients
 * for flat colours that reproduce faithfully in raster PNGs.
 */
function SharedDefs({ ctx, kind }: { ctx: InnerCtx; kind: 'bar' | 'area' | 'line' | 'combo' }) {
  const { model, defsId, isExport } = ctx;
  if (isExport) return null;
  return (
    <defs>
      {model.series.map((s) => (
        <linearGradient key={`bar-${s.key}`} id={`${defsId}-bar-${s.key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.color} stopOpacity={0.95} />
          <stop offset="100%" stopColor={s.color} stopOpacity={0.55} />
        </linearGradient>
      ))}
      {(kind === 'area' || kind === 'combo') && model.series.map((s) => (
        <linearGradient key={`area-${s.key}`} id={`${defsId}-area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={s.color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={s.color} stopOpacity={0.04} />
        </linearGradient>
      ))}
      <filter id={`${defsId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function barFill(ctx: InnerCtx, key: string, color: string): string {
  return ctx.isExport ? color : `url(#${ctx.defsId}-bar-${key})`;
}
function areaFill(ctx: InnerCtx, key: string, color: string): string {
  return ctx.isExport ? color : `url(#${ctx.defsId}-area-${key})`;
}

function renderBar(ctx: InnerCtx, opts: { stacked?: boolean; horizontal?: boolean }) {
  const { model, isCard, isExport, fontSize, labelSize, tooltipStyle, legendStyle, margin, showLegend, barSize } = ctx;
  const stacked = opts.stacked || model.stacked;
  const horizontal = opts.horizontal || model.horizontal;
  const layout = horizontal ? 'vertical' : 'horizontal';

  return (
    <BarChart data={model.data} margin={margin} layout={layout} barCategoryGap={isCard ? '22%' : '14%'}>
      <SharedDefs ctx={ctx} kind="bar" />
      <CartesianGrid strokeDasharray="3 4" stroke={GRID_STROKE} vertical={horizontal} horizontal={!horizontal} />
      {horizontal ? (
        <>
          <XAxis type="number" tick={axisTick(fontSize)} allowDecimals={false} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={axisTick(fontSize)} width={isExport ? 220 : isCard ? 132 : 170} axisLine={false} tickLine={false} />
        </>
      ) : (
        <>
          <XAxis dataKey="name" interval={ctx.tickInterval} angle={isCard ? -28 : -26} textAnchor="end" height={isCard ? 50 : isExport ? 102 : 82} tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
          <YAxis tick={axisTick(fontSize)} width={isExport ? 72 : 46} allowDecimals={false} axisLine={false} tickLine={false} />
        </>
      )}
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ fill: 'hsl(var(--primary) / 0.08)', radius: 8 }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          fill={barFill(ctx, s.key, s.color)}
          stroke={isExport ? undefined : s.color}
          strokeOpacity={isExport ? 0 : 0.35}
          strokeWidth={isExport ? 0 : 1}
          stackId={stacked ? 'stack' : undefined}
          radius={stacked ? 0 : horizontal ? [0, 8, 8, 0] : [10, 10, 2, 2]}
          maxBarSize={barSize}
          isAnimationActive={false}
        >
          {/* Per-slice recolor for single-series pie-like bar palettes */}
          {model.series.length === 1 && model.pieSlices
            ? model.pieSlices.map((slice, idx) => <Cell key={idx} fill={isExport ? slice.fill : `url(#${ctx.defsId}-bar-${s.key})`} />)
            : null}
          {!isCard && model.series.length === 1 && !stacked && !horizontal ? (
            <LabelList dataKey={s.key} position="top" style={{ fontSize: labelSize, fill: isExport ? '#111827' : 'hsl(var(--foreground))', fontWeight: 700 }} />
          ) : null}
        </Bar>
      ))}
    </BarChart>
  );
}

function renderLine(ctx: InnerCtx) {
  const { model, fontSize, tooltipStyle, legendStyle, margin, showLegend, isCard, isExport, defsId } = ctx;
  return (
    <LineChart data={model.data} margin={margin}>
      <SharedDefs ctx={ctx} kind="line" />
      <CartesianGrid strokeDasharray="3 4" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="name" interval={ctx.tickInterval} angle={isCard ? -24 : -22} textAnchor="end" height={isCard ? 38 : isExport ? 92 : 74} tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
      <YAxis tick={axisTick(fontSize)} width={isExport ? 72 : 44} axisLine={false} tickLine={false} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ stroke: 'hsl(var(--primary) / 0.35)', strokeWidth: 1, strokeDasharray: '4 4' }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.label}
          stroke={s.color}
          strokeWidth={isExport ? 6 : isCard ? 2.4 : 3}
          dot={{ r: isExport ? 7 : isCard ? 3 : 5, fill: s.color, strokeWidth: 0 }}
          activeDot={{ r: isExport ? 9 : 7, fill: s.color, stroke: 'hsl(var(--background))', strokeWidth: 2, filter: isExport ? undefined : `url(#${defsId}-glow)` }}
          filter={isExport ? undefined : `url(#${defsId}-glow)`}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

function renderArea(ctx: InnerCtx) {
  const { model, fontSize, tooltipStyle, legendStyle, margin, showLegend, isCard, isExport } = ctx;
  const stacked = model.kind === 'area-stacked' || model.stacked;
  return (
    <AreaChart data={model.data} margin={margin}>
      <SharedDefs ctx={ctx} kind="area" />
      <CartesianGrid strokeDasharray="3 4" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="name" interval={ctx.tickInterval} angle={isCard ? -24 : -22} textAnchor="end" height={isCard ? 38 : isExport ? 92 : 74} tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
      <YAxis tick={axisTick(fontSize)} width={isExport ? 72 : 44} axisLine={false} tickLine={false} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ stroke: 'hsl(var(--primary) / 0.35)', strokeWidth: 1, strokeDasharray: '4 4' }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.label}
          stroke={s.color}
          strokeWidth={isExport ? 4 : 2.4}
          fill={areaFill(ctx, s.key, s.color)}
          stackId={stacked ? 'stack' : undefined}
          activeDot={{ r: isExport ? 8 : 6, fill: s.color, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      ))}
    </AreaChart>
  );
}

function renderPie(ctx: InnerCtx) {
  const { model, isCard, isExport, tooltipStyle, legendStyle, defsId } = ctx;
  const slices = model.pieSlices || [];
  const isDonut = model.kind === 'donut';
  const innerRadius = isDonut ? (isCard ? '52%' : '58%') : 0;
  const paddingAngle = slices.length > 1 ? (isCard ? 1.5 : 2) : 0;
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <PieChart margin={isCard ? { top: 4, right: 4, bottom: 4, left: 4 } : { top: 8, right: 20, bottom: 8, left: 20 }}>
      {!isExport && (
        <defs>
          <filter id={`${defsId}-pieShadow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000" floodOpacity="0.28" />
          </filter>
        </defs>
      )}
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} formatter={(value: number, name: string, item: any) => { const percent = total ? ` (${((Number(value) / total) * 100).toFixed(1)}%)` : ""; return [`${value}${percent}`, item?.payload?.name || name]; }} />
      {false && (
        <Legend
          layout={isExport ? 'vertical' : 'horizontal'}
          verticalAlign={isExport ? 'middle' : 'bottom'}
          align={isExport ? 'right' : 'center'}
          wrapperStyle={legendStyle}
        />
      )}
      <Pie
        data={slices}
        dataKey="value"
        nameKey="name"
        cx={isExport ? '43%' : '50%'}
        cy="50%"
        outerRadius={isCard ? '74%' : isExport ? '82%' : '80%'}
        innerRadius={innerRadius}
        paddingAngle={paddingAngle}
        cornerRadius={isDonut ? (isCard ? 4 : 6) : 0}
        label={!isCard ? ({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%` : false}
        labelLine={!isCard}
        stroke={isExport ? '#fff' : 'hsl(var(--background))'}
        strokeWidth={isExport ? 2 : 2}
        filter={isExport ? undefined : `url(#${defsId}-pieShadow)`}
        isAnimationActive={false}
      >
        {slices.map((entry, i) => <Cell key={`${entry.name}-${i}`} fill={entry.fill} />)}
      </Pie>
    </PieChart>
  );
}

function renderScatter(ctx: InnerCtx) {
  const { model, fontSize, tooltipStyle, legendStyle, margin, showLegend } = ctx;
  return (
    <ScatterChart margin={margin}>
      <SharedDefs ctx={ctx} kind="line" />
      <CartesianGrid strokeDasharray="3 4" stroke={GRID_STROKE} />
      <XAxis dataKey="name" tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
      <YAxis tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
      <ZAxis range={[60, 260]} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--primary) / 0.35)' }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => (
        <Scatter key={s.key} name={s.label} data={model.data.map((row) => ({ name: row.name, [s.key]: row[s.key] }))} fill={s.color} fillOpacity={0.85} dataKey={s.key} isAnimationActive={false} />
      ))}
    </ScatterChart>
  );
}

function renderRadar(ctx: InnerCtx) {
  const { model, tooltipStyle, legendStyle, showLegend, fontSize, isExport } = ctx;
  return (
    <RadarChart data={model.data} outerRadius="74%">
      <SharedDefs ctx={ctx} kind="area" />
      <PolarGrid stroke={GRID_STROKE} />
      <PolarAngleAxis dataKey="name" tick={axisTick(fontSize)} />
      <PolarRadiusAxis tick={axisTick(fontSize)} stroke={GRID_STROKE} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ fill: 'hsl(var(--primary) / 0.08)' }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => (
        <Radar
          key={s.key}
          name={s.label}
          dataKey={s.key}
          stroke={s.color}
          strokeWidth={isExport ? 3 : 2}
          fill={areaFill(ctx, s.key, s.color)}
          fillOpacity={isExport ? 0.32 : 0.55}
          isAnimationActive={false}
        />
      ))}
    </RadarChart>
  );
}

function renderCombo(ctx: InnerCtx) {
  const { model, fontSize, tooltipStyle, legendStyle, margin, showLegend, isCard, isExport, barSize, defsId } = ctx;
  return (
    <ComposedChart data={model.data} margin={margin}>
      <SharedDefs ctx={ctx} kind="combo" />
      <CartesianGrid strokeDasharray="3 4" stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey="name" interval={ctx.tickInterval} angle={isCard ? -24 : -22} textAnchor="end" height={isCard ? 38 : isExport ? 92 : 74} tick={axisTick(fontSize)} axisLine={false} tickLine={false} />
      <YAxis tick={axisTick(fontSize)} width={isExport ? 72 : 44} axisLine={false} tickLine={false} />
      <Tooltip contentStyle={tooltipStyle} labelStyle={ctx.tooltipLabelStyle} cursor={{ fill: 'hsl(var(--primary) / 0.08)', radius: 8 }} />
      {showLegend && <Legend wrapperStyle={legendStyle} />}
      {model.series.map((s) => {
        const type = s.type || 'bar';
        if (type === 'line') {
          return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={isExport ? 5 : 2.8}
              dot={{ r: isCard ? 3 : 5, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: isExport ? 9 : 7, fill: s.color, stroke: 'hsl(var(--background))', strokeWidth: 2 }}
              filter={isExport ? undefined : `url(#${defsId}-glow)`}
              isAnimationActive={false}
            />
          );
        }
        if (type === 'area') {
          return <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={isExport ? 3 : 2} fill={areaFill(ctx, s.key, s.color)} isAnimationActive={false} />;
        }
        return (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={barFill(ctx, s.key, s.color)}
            stroke={isExport ? undefined : s.color}
            strokeOpacity={isExport ? 0 : 0.35}
            strokeWidth={isExport ? 0 : 1}
            maxBarSize={barSize}
            radius={[10, 10, 2, 2]}
            isAnimationActive={false}
          />
        );
      })}
    </ComposedChart>
  );
}
