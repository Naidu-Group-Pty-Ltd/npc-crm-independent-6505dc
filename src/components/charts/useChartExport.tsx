import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { renderChartImage, getChartTypeConfig } from './ChartCard';
import { LiveChart, canNormaliseChartConfig } from './kernel';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { ChartData } from './ChartCard';

export type ChartExportFormat = 'png' | 'svg';
export interface ChartExportOptions {
  format?: ChartExportFormat;
  /** Only applies to PNG. When true, wraps the chart in the full report-style composition (title, meta, analysis). */
  includeAnalysis?: boolean;
}

export const MAX_EXPORT_ANALYSIS_LENGTH = 10_000;
export const MAX_EXPORT_HEIGHT = 12_000;

function normalizeOptions(opts?: ChartExportOptions | boolean): Required<ChartExportOptions> {
  if (typeof opts === 'boolean') return { format: 'png', includeAnalysis: opts };
  return { format: opts?.format ?? 'png', includeAnalysis: opts?.includeAnalysis ?? true };
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function prepareSvgForExport(svgContent: string): string {
  let svg = svgContent;
  if (!svg.includes('font-family')) {
    svg = svg.replace(/<svg([^>]*)>/, '<svg$1><style>text, tspan { font-family: Arial, Helvetica, sans-serif; }</style>');
  }
  if (!svg.includes('width=') || !svg.includes('height=')) {
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    if (viewBoxMatch) {
      const [, , , w, h] = viewBoxMatch[1].split(/\s+/);
      if (!svg.includes('width=')) svg = svg.replace('<svg', `<svg width="${w}"`);
      if (!svg.includes('height=')) svg = svg.replace('<svg', `<svg height="${h}"`);
    } else {
      svg = svg.replace('<svg', '<svg width="1600" height="1000"');
    }
  }
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

function svgToCanvas(svgContent: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const prepared = prepareSvgForExport(svgContent);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas not supported'));
    const img = new Image();
    const blob = new Blob([prepared], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = 2;
      const w = img.naturalWidth || 1600;
      const h = img.naturalHeight || 1000;
      canvas.width = w * scale;
      canvas.height = h * scale;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load SVG')); };
    img.src = url;
  });
}

async function chartToDataUrl(chart: ChartData): Promise<string> {
  if (!chart.image_data) throw new Error('No image data');
  if (chart.image_data.startsWith('data:image/svg+xml;base64,')) {
    const svgContent = atob(chart.image_data.replace('data:image/svg+xml;base64,', ''));
    const canvas = await svgToCanvas(svgContent);
    return canvas.toDataURL('image/png');
  }
  if (chart.image_data.startsWith('data:image/')) return chart.image_data;
  const response = await fetch(chart.image_data);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Mount a React node in an off-screen host and await two rAFs so Recharts can settle. */
async function mountOffscreen(node: React.ReactNode, width: number, height: number) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;background:#ffffff;z-index:-1;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(node as any);
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Extra beat for ResponsiveContainer measurement
  await new Promise((r) => setTimeout(r, 60));
  return {
    host,
    cleanup: () => { root.unmount(); host.remove(); },
  };
}

/** Render a live-renderable chart offscreen and extract its inner Recharts <svg>. */
async function chartToLiveSvg(chart: ChartData): Promise<string> {
  const width = 1600;
  const height = 1000;
  const { host, cleanup } = await mountOffscreen(
    <div style={{ width, height, background: '#ffffff' }}>
      <LiveChart chart={chart} variant="export" />
    </div>,
    width,
    height,
  );
  try {
    const svgEl = host.querySelector('svg');
    if (!svgEl) throw new Error('LiveChart did not produce an <svg>');
    const cloned = svgEl.cloneNode(true) as SVGSVGElement;
    // Inline title text at top for standalone viewers
    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    cloned.setAttribute('width', String(width));
    cloned.setAttribute('height', String(height));
    if (!cloned.getAttribute('viewBox')) {
      cloned.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    // Ensure a white background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', '#ffffff');
    cloned.insertBefore(bg, cloned.firstChild);
    const serializer = new XMLSerializer();
    return `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(cloned)}`;
  } finally {
    cleanup();
  }
}

/** Best-effort SVG export for a chart record. Falls back to embedding the saved bitmap when no live config exists. */
async function chartToSvg(chart: ChartData): Promise<string> {
  if (canNormaliseChartConfig(chart)) {
    try { return await chartToLiveSvg(chart); } catch (e) { console.warn('Live SVG export failed, falling back', e); }
  }
  if (chart.image_data?.startsWith('data:image/svg+xml;base64,')) {
    return prepareSvgForExport(atob(chart.image_data.replace('data:image/svg+xml;base64,', '')));
  }
  if (chart.image_data?.startsWith('data:image/')) {
    // Wrap the raster in an SVG shell so downstream tools still get a .svg
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="100%" height="100%" fill="#ffffff"/><image href="${chart.image_data}" width="1600" height="1000" preserveAspectRatio="xMidYMid meet"/></svg>`;
  }
  throw new Error('Chart cannot be exported as SVG');
}

async function renderFullExportComposition(chart: ChartData): Promise<string> {
  const cfg = getChartTypeConfig(chart.chart_type);
  const exportAnalysis = chart.analysis_text?.slice(0, MAX_EXPORT_ANALYSIS_LENGTH);
  const { host, cleanup } = await mountOffscreen(
    <div style={{ width: 1800, maxHeight: MAX_EXPORT_HEIGHT, overflow: 'hidden', background: '#ffffff', color: '#0f172a', fontFamily: 'Arial, Helvetica, sans-serif', padding: 72, boxSizing: 'border-box' }}>
      <div style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: 28, marginBottom: 36 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 999, padding: '8px 16px', fontSize: 18, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 18 }}>
          <span>{cfg.emoji}</span><span>{cfg.label}</span>
        </div>
        <h1 style={{ margin: 0, fontSize: 46, lineHeight: 1.12, fontWeight: 900, letterSpacing: -1.2 }}>{chart.title}</h1>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 18, color: '#475569', fontSize: 20, fontWeight: 600 }}>
          {chart.generated_reports?.title && <span>Report: {chart.generated_reports.title}</span>}
          <span>Generated: {format(new Date(chart.created_at), 'PPp')}</span>
        </div>
      </div>
      <div style={{ height: 900, border: '1px solid #e2e8f0', borderRadius: 28, padding: 34, boxSizing: 'border-box', background: '#ffffff', boxShadow: '0 18px 44px rgba(15,23,42,0.10)' }}>
        {renderChartImage(chart, 'export')}
      </div>
      {exportAnalysis && (
        <section style={{ marginTop: 40, border: '1px solid #f3d08a', borderRadius: 28, background: 'linear-gradient(135deg,#fffbeb,#ffffff)', padding: 34 }}>
          <h2 style={{ margin: '0 0 18px', fontSize: 28, lineHeight: 1.2, fontWeight: 900, letterSpacing: 2, textTransform: 'uppercase', color: '#92400e' }}>Analysis</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 23, lineHeight: 1.62, color: '#334155' }}>{exportAnalysis}</p>
        </section>
      )}
    </div>,
    1800,
    0,
  );
  try {
    const target = host.firstElementChild as HTMLElement;
    if (!target || target.offsetHeight <= 0) throw new Error('Export layout did not render');
    const canvas = await html2canvas(target, {
      backgroundColor: '#ffffff',
      scale: target.offsetHeight >= MAX_EXPORT_HEIGHT ? 1 : 1.5,
      useCORS: true,
      logging: false,
      windowWidth: 1800,
      windowHeight: Math.min(target.offsetHeight, MAX_EXPORT_HEIGHT),
    });
    return canvas.toDataURL('image/png');
  } finally {
    cleanup();
  }
}

function sanitizeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_').substring(0, 50);
}

export function useChartExport() {
  const [exporting, setExporting] = useState(false);

  const exportSingle = useCallback(async (chart: ChartData, options?: ChartExportOptions | boolean) => {
    if (exporting) return;
    const { format: fmt, includeAnalysis } = normalizeOptions(options);
    setExporting(true);
    try {
      if (fmt === 'svg') {
        const svg = await chartToSvg(chart);
        downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${sanitizeFilename(chart.title)}_${chart.chart_type}.svg`);
        toast.success(`Exported "${chart.title}" as SVG`);
        return;
      }
      const dataUrl = includeAnalysis ? await renderFullExportComposition(chart) : await chartToDataUrl(chart);
      downloadDataUrl(dataUrl, `${sanitizeFilename(chart.title)}_${chart.chart_type}.png`);
      toast.success(`Exported "${chart.title}"`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export chart. Refresh the chart gallery, then try exporting again.');
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const exportBulk = useCallback(async (charts: ChartData[], options?: ChartExportOptions | boolean) => {
    if (charts.length === 0) {
      toast.error('No charts selected. Select at least one chart to export.');
      return;
    }
    const { format: fmt, includeAnalysis } = normalizeOptions(options);

    if (charts.length === 1) return exportSingle(charts[0], { format: fmt, includeAnalysis });

    toast.info(`Exporting ${charts.length} charts as ${fmt.toUpperCase()}…`);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (let i = 0; i < charts.length; i++) {
        try {
          const idx = String(i + 1).padStart(2, '0');
          const base = sanitizeFilename(charts[i].title);
          if (fmt === 'svg') {
            const svg = await chartToSvg(charts[i]);
            zip.file(`${idx}_${base}.svg`, svg);
          } else {
            const dataUrl = includeAnalysis ? await renderFullExportComposition(charts[i]) : await chartToDataUrl(charts[i]);
            zip.file(`${idx}_${base}.png`, dataUrl.split(',')[1], { base64: true });
          }
        } catch (e) {
          console.error(`Failed to process chart: ${charts[i].title}`, e);
        }
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `charts_export_${fmt}_${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success(`Exported ${charts.length} charts as ${fmt.toUpperCase()} ZIP`);
    } catch (e) {
      console.error('Bulk export failed, falling back to sequential downloads', e);
      for (const chart of charts) {
        await exportSingle(chart, { format: fmt, includeAnalysis });
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }, [exportSingle]);

  return { exportSingle, exportBulk, exporting };
}
