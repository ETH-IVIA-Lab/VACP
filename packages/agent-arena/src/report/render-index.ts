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
  solvedStrictRate: number | null;
  durationMedianS: number | null;
  tokensMedianNoCache: number | null;
  href: string;
};

export type ArenaReportIndexHtmlContext = {
  analysisDir: string;
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
    ctx.generatedAt ? `Analyzed: ${ctx.generatedAt}` : null,
    `Source: ${ctx.analysisDir}`,
    ctx.scenarioDefsPath ? `Tasks: ${ctx.scenarioDefsPath}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

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
        `<td class="num">${m.solvedStrictRate === null ? 'n/a' : fmtPct(m.solvedStrictRate)}</td>`,
        `<td class="num">${m.durationMedianS === null ? 'n/a' : fmtInt(Math.round(m.durationMedianS))}</td>`,
        `<td class="num">${m.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(m.tokensMedianNoCache))}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  const allLink = ctx.allHref
    ? `<a class="btn" href="${escapeAttr(ctx.allHref)}">All models report</a>`
    : '<span class="muted">No combined report.</span>';

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
    `      <div class="topActions">${allLink}</div>`,
    `    </header>`,
    '    <section class="section">',
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
    '              <th class="num">Solved (strict)</th>',
    '              <th class="num">Median s</th>',
    '              <th class="num">Median tokens</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    tableRows || '<tr><td colspan="12" class="muted">No runs found.</td></tr>',
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

function css() {
  return `
:root {
  --bg: #ffffff;
  --ink: #111827;
  --muted: #6b7280;
  --grid: #e5e7eb;
  --card: #ffffff;
  --card2: #f9fafb;
}

html, body {
  height: 100%;
}

body {
  margin: 0;
  padding: 32px 20px 64px;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  letter-spacing: -0.01em;
}

.wrap {
  max-width: 1120px;
  margin: 0 auto;
}

.header {
  margin-bottom: 18px;
}

.title {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.03em;
}

.sub {
  margin-top: 6px;
  color: var(--muted);
  font-size: 13px;
}

.topActions {
  margin-top: 12px;
}

.section {
  margin-top: 20px;
}

h2 {
  margin: 18px 0 10px;
  font-size: 16px;
  letter-spacing: -0.02em;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--grid);
  background: var(--card2);
  color: var(--ink);
  border-radius: 10px;
  padding: 8px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}

.btn:hover {
  background: #eef2ff;
}

.tableWrap {
  overflow-x: auto;
  background: var(--card);
  border: 1px solid var(--grid);
  border-radius: 12px;
}

table {
  border-collapse: collapse;
  width: 100%;
  min-width: 1240px;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--card2);
  z-index: 1;
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
`;
}

function fmtInt(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
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
