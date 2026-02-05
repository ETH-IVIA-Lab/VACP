import type { ArenaFigure } from './charts/types.js';
import type { NormalizedRun } from './stats.js';

export type ArenaReportSummaryRow = {
  experiment: string;
  n: number;
  okRate: number;
  plumbingOkRate: number | null;
  protocolOkRate: number | null;
  gradeableRate: number | null;
  solvedStrictRate: number | null;
  solvedSemanticRate: number | null;
  durationMedianS: number | null;
  tokensMedianNoCache: number | null;
  toolCallsMean: number | null;
  toolErrorsMean: number | null;
};

export type ArenaReportTaskIndexRow = {
  index: number;
  scenarioId: string;
  app: string | null;
  tags: string[];
  task: string | null;
  responseFormat: string | null;
};

export type ArenaReportTaskSummaryRow = {
  scenarioId: string;
  experiment: string;
  n: number;
  okRate: number;
  solvedStrictRate: number | null;
  solvedSemanticRate: number | null;
  durationMedianS: number | null;
  tokensMedianNoCache: number | null;
};

export type ArenaReportHtmlContext = {
  analysisDir: string;
  runId: string | null;
  generatedAt: string | null;
  modelLabel: string | null;
  indexHref: string | null;
  scenarioDefsPath: string | null;
  figureWidthPx: number;
  runs: NormalizedRun[];
  summaries: ArenaReportSummaryRow[];
  figures: ArenaFigure[];
  taskIndex: ArenaReportTaskIndexRow[];
  experiments: string[];
  taskSummaries: ArenaReportTaskSummaryRow[];
};

export type ArenaReportSection = {
  id: string;
  render: (ctx: ArenaReportHtmlContext) => string;
};

export const DEFAULT_REPORT_SECTIONS: ArenaReportSection[] = [
  {
    id: 'summary',
    render: renderSummarySection,
  },
  {
    id: 'figures',
    render: renderFiguresSection,
  },
  {
    id: 'task-breakdown',
    render: renderTaskBreakdownSection,
  },
  {
    id: 'model-responses',
    render: renderModelResponsesSection,
  },
  {
    id: 'task-index',
    render: renderTaskIndexSection,
  },
  {
    id: 'footer',
    render: renderFooter,
  },
];

export function renderArenaReportHtml(
  ctx: ArenaReportHtmlContext,
  sections: ArenaReportSection[] = DEFAULT_REPORT_SECTIONS,
) {
  const titleParts = ['Agent Arena Report'];
  if (ctx.runId) titleParts.push(ctx.runId);
  if (ctx.modelLabel) titleParts.push(ctx.modelLabel);
  const title = titleParts.join(' - ');
  const sub = [
    ctx.runId ? `Run: ${ctx.runId}` : null,
    ctx.generatedAt ? `Analyzed: ${ctx.generatedAt}` : null,
    `Source: ${ctx.analysisDir}`,
    ctx.scenarioDefsPath ? `Tasks: ${ctx.scenarioDefsPath}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    css({ figureWidthPx: ctx.figureWidthPx }),
    '  </style>',
    '</head>',
    '<body>',
    '  <main class="wrap">',
    `    <header class="header">`,
    ctx.indexHref ? `      <a class="home" href="${escapeAttr(ctx.indexHref)}">Index</a>` : '',
    `      <h1 class="title">Agent Arena Report</h1>`,
    ctx.modelLabel ? `      <div class="modelTitle">${escapeHtml(ctx.modelLabel)}</div>` : '',
    `      <div class="sub">${escapeHtml(sub)}</div>`,
    `    </header>`,
    ...sections.map((s) => s.render(ctx)),
    '  </main>',
    `  <script id="__agent_arena_figure_data" type="application/json">`,
    safeJsonForScript(
      Object.fromEntries(
        ctx.figures.map((f) => [f.id, Array.isArray((f as any).data) ? ((f as any).data as unknown[]) : []] as const),
      ),
    ),
    `  </script>`,
    '  <script>',
    js(),
    '  </script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderSummarySection(ctx: ArenaReportHtmlContext) {
  const tableRows = ctx.summaries
    .map((s) => {
      return [
        `<tr>`,
        `<td class="exp">${escapeHtml(s.experiment)}</td>`,
        `<td class="num">${fmtInt(s.n)}</td>`,
        `<td class="num">${fmtPct(s.okRate)}</td>`,
        `<td class="num">${s.plumbingOkRate === null ? 'n/a' : fmtPct(s.plumbingOkRate)}</td>`,
        `<td class="num">${s.protocolOkRate === null ? 'n/a' : fmtPct(s.protocolOkRate)}</td>`,
        `<td class="num">${s.gradeableRate === null ? 'n/a' : fmtPct(s.gradeableRate)}</td>`,
        `<td class="num">${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}</td>`,
        `<td class="num">${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}</td>`,
        `<td class="num">${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS))}</td>`,
        `<td class="num">${s.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianNoCache))}</td>`,
        `<td class="num">${s.toolCallsMean === null ? 'n/a' : fmt1(s.toolCallsMean)}</td>`,
        `<td class="num">${s.toolErrorsMean === null ? 'n/a' : fmt2(s.toolErrorsMean)}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section">',
    '      <h2>Summary</h2>',
    '      <div class="muted small">Solved rates are computed over gradeable runs (plumbing OK + parsed OK + judge available).</div>',
    '      <div class="tableWrap">',
    '        <table>',
    '          <thead>',
    '            <tr>',
    '              <th>Experiment</th>',
    '              <th class="num">n</th>',
    '              <th class="num">Run OK</th>',
    '              <th class="num">Plumbing OK</th>',
    '              <th class="num">Parsed OK</th>',
    '              <th class="num">Gradeable</th>',
    '              <th class="num">Solved (strict)</th>',
    '              <th class="num">Solved (semantic)</th>',
    '              <th class="num">Median s</th>',
    '              <th class="num">Median tokens</th>',
    '              <th class="num">Mean tool calls</th>',
    '              <th class="num">Mean tool errors</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    tableRows || '<tr><td colspan="12" class="muted">No runs found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderFiguresSection(ctx: ArenaReportHtmlContext) {
  return ctx.figures
    .map((f) => {
      return [
        `<section class="section">`,
        `<div class="sectionHead">`,
        `<h2 id="${escapeAttr(f.id)}">${escapeHtml(f.title)}</h2>`,
        `<div class="actions" aria-label="Export chart">`,
        `<a class="btn" href="figures/${escapeAttr(f.id)}.svg" download="${escapeAttr(f.id)}.svg">SVG</a>`,
        `<button class="btn" type="button" data-export="png" data-figure="${escapeAttr(f.id)}">PNG</button>`,
        `<button class="btn" type="button" data-export="data" data-figure="${escapeAttr(f.id)}">Data</button>`,
        `</div>`,
        `</div>`,
        `<figure class="figure" data-figure-id="${escapeAttr(f.id)}">`,
        `<div class="svgWrap" role="img" aria-label="${escapeAttr(f.title)}">`,
        f.svg,
        `</div>`,
        `<figcaption>${escapeHtml(f.caption)}</figcaption>`,
        `</figure>`,
        `</section>`,
      ].join('\n');
    })
    .join('\n');
}

function renderTaskBreakdownSection(ctx: ArenaReportHtmlContext) {
  const byTaskKey = new Map<string, (typeof ctx.taskSummaries)[number]>();
  for (const row of ctx.taskSummaries) byTaskKey.set(`${row.scenarioId}__${row.experiment}`, row);

  const taskColgroup = [
    `<colgroup>`,
    `<col style="width: 44px" />`,
    `<col style="width: 320px" />`,
    `<col style="width: 560px" />`,
    ...ctx.experiments.flatMap(() => [
      `<col style="width: 96px" />`,
      `<col style="width: 96px" />`,
      `<col style="width: 88px" />`,
      `<col style="width: 110px" />`,
    ]),
    `</colgroup>`,
  ].join('\n');

  const taskTableHeader = [
    `<thead>`,
    `<tr>`,
    `<th rowspan="2" class="num">#</th>`,
    `<th rowspan="2">Scenario</th>`,
    `<th rowspan="2">Task</th>`,
    ...ctx.experiments.map((exp) => `<th colspan="4" class="group">${escapeHtml(exp)}</th>`),
    `</tr>`,
    `<tr>`,
    ...ctx.experiments.flatMap(() => [
      `<th class="num">Solved (strict)</th>`,
      `<th class="num">Solved (semantic)</th>`,
      `<th class="num">Median s</th>`,
      `<th class="num">Median tokens</th>`,
    ]),
    `</tr>`,
    `</thead>`,
  ].join('\n');

  const taskTableRows = ctx.taskIndex
    .map((t) => {
      const cells = ctx.experiments
        .flatMap((exp) => {
          const s = byTaskKey.get(`${t.scenarioId}__${exp}`) ?? null;
          if (!s) {
            return [
              `<td class="num muted" title="Not run">—</td>`,
              `<td class="num muted" title="Not run">—</td>`,
              `<td class="num muted" title="Not run">—</td>`,
              `<td class="num muted" title="Not run">—</td>`,
            ];
          }

          const title = [
            `${exp} × ${t.scenarioId}`,
            `n=${s.n}`,
            `Solved (strict): ${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}`,
            `Solved (semantic): ${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}`,
            `Median duration: ${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS)) + 's'}`,
            `Median tokens: ${s.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianNoCache))}`,
          ].join('\n');

          return [
            `<td class="num" title="${escapeAttr(title)}">${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS))}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianNoCache))}</td>`,
          ];
        })
        .join('');

      return [
        `<tr>`,
        `<td class="num">${fmtInt(t.index)}</td>`,
        `<td class="exp">${escapeHtml(t.scenarioId)}</td>`,
        `<td class="taskText">${t.task ? escapeHtml(t.task) : '<span class="muted">n/a</span>'}</td>`,
        cells,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section">',
    '      <h2>Task Breakdown</h2>',
    '      <div class="tableWrap">',
    '        <table class="tasks">',
    taskColgroup,
    taskTableHeader,
    '          <tbody>',
    taskTableRows || '<tr><td colspan="3" class="muted">No tasks found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderModelResponsesSection(ctx: ArenaReportHtmlContext) {
  if (!ctx.modelLabel) {
    return [
      '    <section class="section">',
      '      <h2>Model Responses</h2>',
      '      <div class="muted small">Open a per-model report to see extracted JSON answers per task × mode.</div>',
      '    </section>',
    ].join('\n');
  }

  const byKey = new Map<string, NormalizedRun[]>();
  for (const r of ctx.runs) {
    const key = `${r.scenarioId}__${r.experiment}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const colgroup = [
    `<colgroup>`,
    `<col style="width: 44px" />`,
    `<col style="width: 320px" />`,
    `<col style="width: 560px" />`,
    ...ctx.experiments.map(() => `<col style="width: 420px" />`),
    `</colgroup>`,
  ].join('\n');

  const tableHead = [
    `<thead>`,
    `<tr>`,
    `<th class="num">#</th>`,
    `<th>Scenario</th>`,
    `<th>Task</th>`,
    ...ctx.experiments.map((exp) => `<th class="group">${escapeHtml(exp)}</th>`),
    `</tr>`,
    `</thead>`,
  ].join('\n');

  const rows = ctx.taskIndex
    .map((t) => {
      const taskHtml = t.task ? escapeHtml(t.task) : '<span class="muted">n/a</span>';

      const cells = ctx.experiments
        .map((exp) => {
          const runs = byKey.get(`${t.scenarioId}__${exp}`) ?? [];
          if (!runs.length) return `<td class="muted">—</td>`;
          return `<td class="jsonCell">${renderJsonCell(runs)}</td>`;
        })
        .join('');

      return [
        `<tr>`,
        `<td class="num">${fmtInt(t.index)}</td>`,
        `<td class="exp">${escapeHtml(t.scenarioId)}</td>`,
        `<td class="taskText">${taskHtml}</td>`,
        cells,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section">',
    '      <h2>Model Responses</h2>',
    '      <div class="muted small">Extracted from the final assistant message JSON fence (when present). If multiple runs exist, all are included.</div>',
    '      <div class="tableWrap">',
    '        <table class="responses">',
    colgroup,
    tableHead,
    '          <tbody>',
    rows || `<tr><td colspan="${3 + ctx.experiments.length}" class="muted">No tasks found.</td></tr>`,
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderJsonCell(runs: NormalizedRun[]) {
  const summary = runs.length > 1 ? `View JSON (${runs.length})` : 'View JSON';
  const bodies = runs
    .map((r, i) => {
      const metaParts = [
        r.runId ? `run: ${r.runId}` : null,
        r.answerParseStatus ? `parse: ${r.answerParseStatus}` : null,
        typeof r.solvedSemantic === 'boolean' ? `semantic: ${r.solvedSemantic ? 'yes' : 'no'}` : null,
        typeof r.solvedStrict === 'boolean' ? `strict: ${r.solvedStrict ? 'yes' : 'no'}` : null,
      ].filter(Boolean);

      const header = metaParts.length
        ? `<div class="jsonMeta">${escapeHtml(`${runs.length > 1 ? `#${i + 1} · ` : ''}${metaParts.join(' · ')}`)}</div>`
        : '';

      const text = formatAnswerJson(r);
      const pre =
        text === null
          ? `<pre class="jsonPre muted">n/a</pre>`
          : `<pre class="jsonPre">${escapeHtml(text)}</pre>`;
      return `${header}${pre}`;
    })
    .join('');

  return `<details class="jsonDetails"><summary>${escapeHtml(summary)}</summary>${bodies}</details>`;
}

function formatAnswerJson(run: NormalizedRun) {
  if (run.answerJson !== null) {
    try {
      return JSON.stringify(run.answerJson, null, 2);
    } catch {
      return String(run.answerJson);
    }
  }
  if (typeof run.answerJsonRaw === 'string' && run.answerJsonRaw.trim()) return run.answerJsonRaw;
  return null;
}

function renderTaskIndexSection(ctx: ArenaReportHtmlContext) {
  const scenarioRows = ctx.taskIndex
    .map((row) => {
      return [
        `<tr>`,
        `<td class="num">${fmtInt(row.index)}</td>`,
        `<td class="exp">${escapeHtml(row.scenarioId)}</td>`,
        `<td class="exp">${escapeHtml(row.app ?? 'n/a')}</td>`,
        `<td class="taskText">${row.task ? escapeHtml(row.task) : '<span class="muted">n/a</span>'}</td>`,
        `<td class="exp">${row.responseFormat ? escapeHtml(row.responseFormat) : '<span class="muted">n/a</span>'}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section">',
    '      <h2>Task Index</h2>',
    '      <div class="tableWrap">',
    '        <table class="scenarios">',
    '          <thead>',
    '            <tr>',
    '              <th class="num">#</th>',
    '              <th>Scenario</th>',
    '              <th>App</th>',
    '              <th>Task</th>',
    '              <th>Response format</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    scenarioRows || '<tr><td colspan="5" class="muted">No tasks found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderFooter(ctx: ArenaReportHtmlContext) {
  void ctx;
  return [
    '    <footer class="footer">',
    `      <div class="muted">Generated from \`agent-arena analyze\` outputs using Observable Plot (static SVG).</div>`,
    '    </footer>',
  ].join('\n');
}

function css(args: { figureWidthPx: number }) {
  return `
:root {
  --bg: #ffffff;
  --ink: #111827;
  --muted: #6b7280;
  --grid: #e5e7eb;
  --card: #ffffff;
  --card2: #f9fafb;
  --figure-min: ${args.figureWidthPx}px;
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
  max-width: 1040px;
  margin: 0 auto;
}

.header {
  margin-bottom: 18px;
}

.home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 12px;
  margin-bottom: 6px;
}

.home:hover {
  color: var(--ink);
  text-decoration: underline;
}

.title {
  margin: 0;
  font-size: 28px;
  letter-spacing: -0.03em;
}

.modelTitle {
  margin-top: 6px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.sub {
  margin-top: 6px;
  color: var(--muted);
  font-size: 13px;
}

.section {
  margin-top: 20px;
}

.sectionHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 18px 0 10px;
  font-size: 16px;
  letter-spacing: -0.02em;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--grid);
  background: var(--card2);
  color: var(--ink);
  border-radius: 10px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
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
  min-width: 860px;
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

.group {
  text-align: center;
  font-weight: 600;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.num {
  text-align: right;
}

.exp {
  max-width: 360px;
  word-break: normal;
  overflow-wrap: break-word;
}

.taskText {
  max-width: 520px;
  word-break: normal;
  overflow-wrap: break-word;
}

.figure {
  margin: 0;
  background: var(--card);
  border: 1px solid var(--grid);
  border-radius: 12px;
  padding: 12px 12px 10px;
  overflow-x: auto;
}

.svgWrap {
  min-width: var(--figure-min);
}

.svgWrap svg {
  display: block;
  width: 100%;
  height: auto;
}

figcaption {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 12px;
}

table.scenarios {
  min-width: 1160px;
}

table.tasks {
  min-width: 1920px;
}

table.responses {
  min-width: 2520px;
}

.jsonCell {
  min-width: 360px;
}

.jsonDetails summary {
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.jsonDetails summary:hover {
  text-decoration: underline;
}

.jsonMeta {
  margin: 8px 0 4px;
  color: var(--muted);
  font-size: 12px;
}

.jsonPre {
  margin: 0 0 10px;
  padding: 10px;
  background: var(--card2);
  border: 1px solid var(--grid);
  border-radius: 10px;
  overflow: auto;
  max-height: 260px;
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.footer {
  margin-top: 28px;
}

@media print {
  body {
    padding: 0;
  }

  .actions {
    display: none;
  }

  .tableWrap,
  .figure {
    break-inside: avoid;
  }
}
`;
}

function js() {
  return `
(() => {
  function getFigureData() {
    const el = document.getElementById('__agent_arena_figure_data');
    if (!(el instanceof HTMLScriptElement)) return {};
    try {
      const raw = String(el.textContent || '').trim();
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function parseSvgSize(svg) {
    const vb = svg.getAttribute('viewBox');
    if (vb) {
      const parts = vb.trim().split(/\\s+/g).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) return { width: parts[2], height: parts[3] };
    }
    const w = Number(String(svg.getAttribute('width') ?? '').replace(/px$/g, ''));
    const h = Number(String(svg.getAttribute('height') ?? '').replace(/px$/g, ''));
    return { width: Number.isFinite(w) && w > 0 ? w : 800, height: Number.isFinite(h) && h > 0 ? h : 400 };
  }

  async function exportPng(figureId) {
    const fig = document.querySelector('figure[data-figure-id="' + figureId + '"]');
    if (!fig) throw new Error('Figure not found: ' + figureId);
    const svg = fig.querySelector('svg');
    if (!svg) throw new Error('SVG not found for: ' + figureId);

    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svg);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    const { width, height } = parseSvgSize(svg);
    const scale = Math.max(2, Math.min(4, Math.round(window.devicePixelRatio || 2)));

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    // Plot SVGs are rendered on a white page; match that in PNG exports so
    // transparency doesn't show up as black in some viewers.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, width, height);

    URL.revokeObjectURL(url);

    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('PNG export failed');
    downloadBlob(pngBlob, figureId + '.png');
  }

  async function exportData(figureId) {
    const data = getFigureData();
    const rows = data && typeof data === 'object' ? data[figureId] : null;
    if (!Array.isArray(rows)) throw new Error('Data not found for: ' + figureId);
    const blob = new Blob([JSON.stringify(rows, null, 2) + '\\n'], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, figureId + '.json');
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const mode = t.getAttribute('data-export');
    if (mode !== 'png' && mode !== 'data') return;
    const figureId = t.getAttribute('data-figure');
    if (!figureId) return;
    if (mode === 'png') exportPng(figureId).catch((err) => console.error(err));
    else exportData(figureId).catch((err) => console.error(err));
  });
})();
`.trim();
}

function fmtInt(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function fmt1(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function fmt2(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
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

function safeJsonForScript(value: unknown) {
  // Avoid `<script>` parsing edge cases inside the script tag body.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const ESC_HTML: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
