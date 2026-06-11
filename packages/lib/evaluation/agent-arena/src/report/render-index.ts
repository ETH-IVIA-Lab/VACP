import type { ArenaAnalysisSource } from './load-analysis.js';

export type ArenaReportIndexModelRow = {
  modelLabel: string;
  modelProvider: string;
  modelName: string;
  runs: number;
  experiments: number;
  okRate: number;
  plumbingOkRate: number | null;
  protocolOkRate: number | null;
  gradeableRate: number | null;
  solvedSemanticRate: number | null;
  durationMedianS: number | null;
  costTotalUsd: number | null;
  costMedianUsd: number | null;
  tokensMedianNoCache: number | null;
  tokensMedianWithCacheRead: number | null;
  tokensMedianWithCacheAll: number | null;
  href: string;
};

export type ArenaReportIndexHtmlContext = {
  analysisDir: string;
  analysisSources: ArenaAnalysisSource[];
  runId: string | null;
  generatedAt: string | null;
  scenarioDefsPath: string | null;
  models: ArenaReportIndexModelRow[];
  allHref: string | null;
};

export function renderArenaReportIndexHtml(ctx: ArenaReportIndexHtmlContext) {
  const titleParts = ['Agent Arena Reports'];
  if (ctx.runId) titleParts.push(ctx.runId);
  const title = titleParts.join(' - ');

  const sub = [
    ctx.runId ? `Run: ${ctx.runId}` : null,
    ctx.analysisSources.length > 1 ? `Sources: ${ctx.analysisSources.length} analyses` : null,
    ctx.generatedAt ? `Analyzed: ${ctx.generatedAt}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const sourceLine =
    ctx.analysisSources.length > 1
      ? `<p class="muted small">Merged analysis sources: ${escapeHtml(ctx.analysisSources.map(formatAnalysisSourceLabel).join(', '))}.</p>`
      : '';

  const tableRows = ctx.models
    .map((m) => {
      return [
        `<tr>`,
        `<td class="exp"><a href="${escapeAttr(m.href)}">${escapeHtml(m.modelLabel)}</a></td>`,
        `<td class="exp">${escapeHtml(m.modelProvider)}</td>`,
        `<td class="exp">${escapeHtml(m.modelName)}</td>`,
        `<td class="num">${fmtInt(m.runs)}</td>`,
        `<td class="num">${fmtInt(m.experiments)}</td>`,
        `<td class="num">${fmtPct(m.okRate)}</td>`,
        `<td class="num">${m.plumbingOkRate === null ? 'n/a' : fmtPct(m.plumbingOkRate)}</td>`,
        `<td class="num">${m.protocolOkRate === null ? 'n/a' : fmtPct(m.protocolOkRate)}</td>`,
        `<td class="num">${m.gradeableRate === null ? 'n/a' : fmtPct(m.gradeableRate)}</td>`,
        `<td class="num">${m.solvedSemanticRate === null ? 'n/a' : fmtPct(m.solvedSemanticRate)}</td>`,
        `<td class="num">${m.durationMedianS === null ? 'n/a' : fmtInt(Math.round(m.durationMedianS))}</td>`,
        `<td class="num">${m.costTotalUsd === null ? 'n/a' : fmtUsd(m.costTotalUsd)}</td>`,
        `<td class="num">${m.costMedianUsd === null ? 'n/a' : fmtUsd(m.costMedianUsd)}</td>`,
        `<td class="num">${m.tokensMedianWithCacheAll === null ? 'n/a' : fmtInt(Math.round(m.tokensMedianWithCacheAll))}</td>`,
        `<td class="num">${m.tokensMedianWithCacheRead === null ? 'n/a' : fmtInt(Math.round(m.tokensMedianWithCacheRead))}</td>`,
        `<td class="num">${m.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(m.tokensMedianNoCache))}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    css(),
    '  </style>',
    '</head>',
    '<body>',
    '  <main class="wrap">',
    `    <header class="header">`,
    `      <h1 class="title">Agent Arena Reports</h1>`,
    `      <div class="sub">${escapeHtml(sub)}</div>`,
    `    </header>`,
    sourceLine,
    '    <section class="section panel">',
    '      <h2>Models</h2>',
    '      <div class="tableWrap">',
    '        <table>',
    '          <thead>',
    '            <tr>',
    '              <th>Model</th>',
    '              <th>Provider</th>',
    '              <th>Name</th>',
    '              <th class="num">Runs</th>',
    '              <th class="num">Experiments</th>',
    '              <th class="num">Run OK</th>',
    '              <th class="num">Plumbing OK</th>',
    '              <th class="num">Parsed OK</th>',
    '              <th class="num">Gradeable</th>',
    '              <th class="num">Solved</th>',
    '              <th class="num">Median s</th>',
    '              <th class="num">Total $</th>',
    '              <th class="num">Median $</th>',
    '              <th class="num">Median tokens (with cache)</th>',
    '              <th class="num">Median tokens (with cache read)</th>',
    '              <th class="num">Median tokens (no cache)</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    tableRows || '<tr><td colspan="16" class="muted">No runs found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
    '  </main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function formatAnalysisSourceLabel(source: ArenaAnalysisSource) {
  return source.runId || source.analysisDir.split('/').filter(Boolean).at(-1) || 'analysis';
}

function css() {
  return `
:root {
  --bg: #f4f5f5;
  --surface: #ffffff;
  --surface-muted: #f8f9fa;
  --ink: #111827;
  --muted: #5f6774;
  --grid: #d6dce5;
  --grid-strong: #bcc5d1;
  --accent: #1d4ed8;
  --row-hover: #f2f5fa;
}

html, body {
  height: 100%;
}

body {
  margin: 0;
  padding: 28px 18px 48px;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  letter-spacing: -0.004em;
}

.wrap {
  max-width: 1180px;
  margin: 0 auto;
}

.header {
  margin-bottom: 22px;
  padding: 0 0 14px;
  border-bottom: 2px solid var(--grid-strong);
}

.title {
  margin: 0;
  font-size: 40px;
  line-height: 1.06;
  letter-spacing: -0.028em;
}

.sub {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.topActions {
  margin-top: 12px;
}

.section {
  margin-top: 30px;
  padding-top: 0;
}

.panel {
  padding: 0;
}

h2 {
  margin: 0 0 10px;
  font-size: 26px;
  line-height: 1.08;
  letter-spacing: -0.024em;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--grid-strong);
  background: transparent;
  color: var(--ink);
  padding: 6px 9px;
  font: inherit;
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}

.btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.tableWrap {
  overflow-x: auto;
  background: var(--surface);
  border: 1px solid var(--grid);
}

table {
  border-collapse: collapse;
  width: 100%;
  min-width: 1480px;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--surface-muted);
  z-index: 1;
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
}

th, td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--grid);
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover td {
  background: var(--row-hover);
}

.num {
  text-align: right;
}

.exp {
  max-width: 520px;
  word-break: normal;
  overflow-wrap: break-word;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 12px;
}

a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 900px) {
  body {
    padding: 14px 10px 30px;
  }

  .title {
    font-size: 30px;
  }
}
`;
}

function fmtInt(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function fmtUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
}

function fmtPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ESC_HTML[ch] ?? ch);
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

const ESC_HTML: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
