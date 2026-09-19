/**
 * htmlExporter — standalone interactive HTML report download.
 * Uses the same `renderTemplateToHtml` engine as PDF export so output is
 * pixel-identical to the WeasyPrint result, but ships as a single .html file
 * the client can open in a browser.
 */
import { renderTemplateToHtml } from './htmlRenderer';
import type { ReportTemplate } from './templateSchema';

export interface HtmlExportOptions {
  data?: Record<string, any>;
  customCss?: string;
  title?: string;
}

/** Returns a self-contained HTML document string. */
export function exportTemplateAsHtml(
  template: ReportTemplate,
  opts: HtmlExportOptions = {},
): string {
  const { html } = renderTemplateToHtml(template, {
    data: opts.data ?? {},
    title: opts.title ?? 'Report',
    customCss: opts.customCss,
  });
  return html;
}

/** Trigger a browser download of the rendered HTML. */
export function downloadTemplateAsHtml(
  template: ReportTemplate,
  filename: string,
  opts: HtmlExportOptions = {},
) {
  const html = exportTemplateAsHtml(template, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
