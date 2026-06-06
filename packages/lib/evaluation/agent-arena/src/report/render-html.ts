import type { ArenaFigure } from './charts/types.js';
import type { NormalizedRun } from './stats.js';
import { deriveEvalOutcome } from '../eval/outcome.js';

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
  costTotalUsd: number | null;
  costMedianUsd: number | null;
  tokensMedianNoCache: number | null;
  tokensMedianWithCacheRead: number | null;
  tokensMedianWithCacheAll: number | null;
  tokensMedianCacheRead: number | null;
  tokensMedianCacheWrite: number | null;
  tokensReadMultiplierMedian: number | null;
  tokensAllMultiplierMedian: number | null;
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
  costTotalUsd: number | null;
  costMedianUsd: number | null;
  tokensMedianNoCache: number | null;
  tokensMedianWithCacheRead: number | null;
  tokensMedianWithCacheAll: number | null;
  tokensMedianCacheRead: number | null;
  tokensMedianCacheWrite: number | null;
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
  opencodeLogSource: string | null;
  opencodeExportManifest: string | null;
  opencodeExportCounts: Record<string, unknown> | null;
};

export type ArenaReportSection = {
  id: string;
  render: (ctx: ArenaReportHtmlContext) => string;
};

type ChartGroupDef = {
  id: string;
  title: string;
  subtitle: string;
  chartIds: string[];
};

const CHART_GROUPS: ChartGroupDef[] = [
  {
    id: 'charts-outcomes',
    title: 'Outcome Overview',
    subtitle:
      'Strict asks for exact values and format. Semantic accepts meaning-equivalent answers. Both are shown here, along with total run outcomes.',
    chartIds: ['solved-semantic', 'solved-strict', 'eval-outcomes'],
  },
  {
    id: 'charts-task-outcomes',
    title: 'Task-Level Outcome Matrix',
    subtitle:
      'Task-by-task outcomes, time, and token usage across experiments. Token heatmaps are split by explicit accounting basis.',
    chartIds: [
      'scenario-heatmap',
      'scenario-heatmap-semantic',
      'scenario-duration-heatmap',
      'scenario-tokens-heatmap-with-cache-all',
      'scenario-tokens-heatmap-with-cache-read',
      'scenario-tokens-heatmap-no-cache',
    ],
  },
  {
    id: 'charts-efficiency',
    title: 'Efficiency & Token Accounting',
    subtitle:
      'Speed and token cost by experiment. With-cache is the primary lens, with no-cache as supporting context.',
    chartIds: ['pareto', 'duration', 'tokens', 'tokens-median-with-cache', 'tokens-median-no-cache'],
  },
  {
    id: 'charts-tools',
    title: 'Tools & Reliability',
    subtitle: 'Tool usage patterns and reliability signals across runs. Tool heatmaps are normalized as calls per run.',
    chartIds: ['tool-calls', 'flags-heatmap', 'tools-heatmap', 'tools-heatmap-by-task'],
  },
];

export const DEFAULT_REPORT_SECTIONS: ArenaReportSection[] = [
  {
    id: 'overview',
    render: renderOverviewSection,
  },
  {
    id: 'summary',
    render: renderSummarySection,
  },
  {
    id: 'figures',
    render: renderFiguresSection,
  },
  {
    id: 'token-accounting',
    render: renderTokenAccountingSection,
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
  const enabledSections = new Set(sections.map((s) => s.id));
  const chartGroups = groupFigures(ctx.figures);
  const titleParts = ['Agent Arena Report'];
  if (ctx.runId) titleParts.push(ctx.runId);
  if (ctx.modelLabel) titleParts.push(ctx.modelLabel);
  const title = titleParts.join(' - ');
  const sub = [ctx.runId ? `Run: ${ctx.runId}` : null, ctx.generatedAt ? `Analyzed: ${ctx.generatedAt}` : null]
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
    renderFloatingNav({ enabledSections, chartGroups }),
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

function renderOverviewSection(ctx: ArenaReportHtmlContext) {
  const totalRuns = ctx.runs.length;
  const experiments = ctx.experiments.length;
  const durationMedian = medianNumber(ctx.runs.flatMap((r) => (typeof r.durationS === 'number' ? [r.durationS] : [])));
  const withCacheMedian = medianNumber(
    ctx.runs.flatMap((r) =>
      typeof r.tokensTotalWithCacheAll === 'number'
        ? [r.tokensTotalWithCacheAll]
        : typeof r.tokensTotalWithCacheRead === 'number'
          ? [r.tokensTotalWithCacheRead]
          : typeof r.tokensTotalNoCache === 'number'
            ? [r.tokensTotalNoCache]
            : [],
    ),
  );
  const costMedian = medianNumber(ctx.runs.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : [])));
  const costTotal = sumNumber(ctx.runs.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : [])));

  const semanticUsable = ctx.runs.filter((r) => typeof r.solvedSemantic === 'boolean');
  const semanticSolved = semanticUsable.filter((r) => r.solvedSemantic === true).length;
  const semanticRate = semanticUsable.length ? semanticSolved / semanticUsable.length : null;

  const strictUsable = ctx.runs.filter((r) => typeof r.solvedStrict === 'boolean');
  const strictSolved = strictUsable.filter((r) => r.solvedStrict === true).length;
  const strictRate = strictUsable.length ? strictSolved / strictUsable.length : null;

  const cards = [
    {
      label: 'Runs',
      value: fmtInt(totalRuns),
      meta: `${fmtInt(experiments)} experiments`,
    },
    {
      label: 'Median Tokens',
      value: withCacheMedian === null ? 'n/a' : fmtInt(Math.round(withCacheMedian)),
      meta: 'Primary: with cache',
    },
    {
      label: 'Median Duration',
      value: durationMedian === null ? 'n/a' : `${fmtInt(Math.round(durationMedian))}s`,
      meta: 'Per run',
    },
    {
      label: 'Median Cost',
      value: costMedian === null ? 'n/a' : fmtUsd(costMedian),
      meta: 'USD per run',
    },
    {
      label: 'Total Cost',
      value: costTotal === null ? 'n/a' : fmtUsd(costTotal),
      meta: 'USD across selected runs',
    },
    {
      label: 'Solved Semantic',
      value: semanticRate === null ? 'n/a' : fmtPct(semanticRate),
      meta: `${fmtInt(semanticSolved)}/${fmtInt(semanticUsable.length)} gradeable`,
    },
    {
      label: 'Solved Strict',
      value: strictRate === null ? 'n/a' : fmtPct(strictRate),
      meta: `${fmtInt(strictSolved)}/${fmtInt(strictUsable.length)} gradeable`,
    },
  ];

  const exportLine =
    ctx.opencodeLogSource === null
      ? 'OpenCode export metadata is unavailable for this analysis.'
      : [
          `OpenCode logs: ${ctx.opencodeLogSource}.`,
          ctx.opencodeExportManifest ? `Manifest: ${ctx.opencodeExportManifest}.` : null,
          ctx.opencodeExportCounts ? `Messages: ${fmtInt(Number(ctx.opencodeExportCounts.messages ?? 0))}.` : null,
          ctx.opencodeExportCounts ? `Parts: ${fmtInt(Number(ctx.opencodeExportCounts.parts ?? 0))}.` : null,
        ]
          .filter(Boolean)
          .join(' ');

  return [
    '    <section class="section overviewSection" id="section-overview">',
    '      <div class="sectionKicker">Overview</div>',
    '      <h2 class="overviewTitle">Arena Snapshot</h2>',
    '      <p class="sectionIntro muted small">Primary token lens is with-cache. Full no-cache, cache-read, and cache-write accounting remains in dedicated sections below.</p>',
    '      <div class="overviewGrid">',
    ...cards.map((card) =>
      [
        '        <article class="metricCard">',
        `          <div class="metricLabel">${escapeHtml(card.label)}</div>`,
        `          <div class="metricValue">${escapeHtml(card.value)}</div>`,
        `          <div class="metricMeta">${escapeHtml(card.meta)}</div>`,
        '        </article>',
      ].join('\n'),
    ),
    '      </div>',
    '      <ul class="overviewCaveats muted small">',
    '        <li>Charts use the preferred-run view: one selected run per model, run_id, experiment, and scenario group.</li>',
    '        <li>Flag rates are computed over runs with available telemetry for each flag. Missing values are excluded and shown as n/a.</li>',
    '        <li>Tool heatmaps report calls per run, not raw call totals.</li>',
    `        <li>${escapeHtml(exportLine)}</li>`,
    '      </ul>',
    '    </section>',
  ].join('\n');
}

function medianNumber(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sumNumber(values: number[]) {
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0);
}

function groupFigures(figures: ArenaFigure[]) {
  const byId = new Map(figures.map((f) => [f.id, f] as const));
  const used = new Set<string>();
  const grouped: Array<{
    id: string;
    title: string;
    subtitle: string;
    figures: ArenaFigure[];
  }> = [];

  for (const group of CHART_GROUPS) {
    const groupFigures = group.chartIds.flatMap((chartId) => {
      const figure = byId.get(chartId);
      return figure ? [figure] : [];
    });
    if (!groupFigures.length) continue;
    grouped.push({
      id: group.id,
      title: group.title,
      subtitle: group.subtitle,
      figures: groupFigures,
    });
    for (const figure of groupFigures) used.add(figure.id);
  }

  const uncategorized = figures.filter((figure) => !used.has(figure.id));
  if (uncategorized.length) {
    grouped.push({
      id: 'charts-other',
      title: 'Additional Charts',
      subtitle: 'Other chart outputs from this analysis.',
      figures: uncategorized,
    });
  }

  return grouped;
}

function renderFloatingNav(args: {
  enabledSections: Set<string>;
  chartGroups: Array<{ id: string; title: string; subtitle: string; figures: ArenaFigure[] }>;
}) {
  const links: Array<{ href: string; label: string }> = [];

  if (args.enabledSections.has('overview')) links.push({ href: '#section-overview', label: 'Overview' });
  if (args.enabledSections.has('summary')) links.push({ href: '#section-summary', label: 'Summary' });

  if (args.enabledSections.has('figures')) {
    for (const group of args.chartGroups) links.push({ href: `#${group.id}`, label: group.title });
  }
  if (args.enabledSections.has('token-accounting'))
    links.push({ href: '#section-token-accounting', label: 'Token Accounting' });

  if (args.enabledSections.has('task-breakdown'))
    links.push({ href: '#section-task-breakdown', label: 'Task Breakdown' });
  if (args.enabledSections.has('model-responses'))
    links.push({ href: '#section-model-responses', label: 'Model Responses' });
  if (args.enabledSections.has('task-index')) links.push({ href: '#section-task-index', label: 'Task Index' });

  if (!links.length) return '';

  return [
    '  <aside class="floatingNav" aria-label="Report navigation">',
    '    <div class="floatingNavTitle">Jump To</div>',
    '    <ul class="floatingNavList">',
    ...links.map((link) => `      <li><a href="${escapeAttr(link.href)}">${escapeHtml(link.label)}</a></li>`),
    '    </ul>',
    '  </aside>',
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
        `<td class="num">${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}</td>`,
        `<td class="num">${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}</td>`,
        `<td class="num">${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS))}</td>`,
        `<td class="num">${s.costTotalUsd === null ? 'n/a' : fmtUsd(s.costTotalUsd)}</td>`,
        `<td class="num">${s.costMedianUsd === null ? 'n/a' : fmtUsd(s.costMedianUsd)}</td>`,
        `<td class="num">${s.tokensMedianWithCacheAll === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianWithCacheAll))}</td>`,
        `<td class="num">${s.toolCallsMean === null ? 'n/a' : fmt1(s.toolCallsMean)}</td>`,
        `<td class="num">${s.toolErrorsMean === null ? 'n/a' : fmt2(s.toolErrorsMean)}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section panelSection" id="section-summary">',
    '      <h2>Summary</h2>',
    '      <p class="sectionIntro muted small">Solved rates are computed only on gradeable runs: plumbing OK, parsed OK, and judge output available.</p>',
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
    '              <th class="num">Solved semantic</th>',
    '              <th class="num">Solved strict</th>',
    '              <th class="num">Median s</th>',
    '              <th class="num">Total $</th>',
    '              <th class="num">Median $</th>',
    '              <th class="num">Median tokens with cache</th>',
    '              <th class="num">Mean tool calls</th>',
    '              <th class="num">Mean tool errors</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    tableRows || '<tr><td colspan="14" class="muted">No runs found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderTokenAccountingSection(ctx: ArenaReportHtmlContext) {
  const tableRows = ctx.summaries
    .map((s) =>
      [
        `<tr>`,
        `<td class="exp">${escapeHtml(s.experiment)}</td>`,
        `<td class="num">${fmtInt(s.n)}</td>`,
        `<td class="num">${s.costTotalUsd === null ? 'n/a' : fmtUsd(s.costTotalUsd)}</td>`,
        `<td class="num">${s.costMedianUsd === null ? 'n/a' : fmtUsd(s.costMedianUsd)}</td>`,
        `<td class="num">${s.tokensMedianWithCacheAll === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianWithCacheAll))}</td>`,
        `<td class="num">${s.tokensMedianWithCacheRead === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianWithCacheRead))}</td>`,
        `<td class="num">${s.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianNoCache))}</td>`,
        `<td class="num">${s.tokensMedianCacheRead === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianCacheRead))}</td>`,
        `<td class="num">${s.tokensMedianCacheWrite === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianCacheWrite))}</td>`,
        `<td class="num">${s.tokensAllMultiplierMedian === null ? 'n/a' : `${fmt2(s.tokensAllMultiplierMedian)}×`}</td>`,
        `<td class="num">${s.tokensReadMultiplierMedian === null ? 'n/a' : `${fmt2(s.tokensReadMultiplierMedian)}×`}</td>`,
        `</tr>`,
      ].join(''),
    )
    .join('\n');

  return [
    '    <section class="section panelSection" id="section-token-accounting">',
    '      <h2>Token Accounting</h2>',
    '      <p class="sectionIntro muted small">Main metric is with-cache read + write. Supporting columns show with-cache read-only and no-cache totals. Both total and median cost are shown. Ratios are explicit formulas: with-cache(all)/no-cache and with-cache(read)/no-cache.</p>',
    '      <div class="tableWrap">',
    '        <table>',
    '          <thead>',
    '            <tr>',
    '              <th>Experiment</th>',
    '              <th class="num">n</th>',
    '              <th class="num">Total cost (USD)</th>',
    '              <th class="num">Median cost (USD)</th>',
    '              <th class="num">Median with-cache read + write</th>',
    '              <th class="num">Median with-cache read</th>',
    '              <th class="num">Median no-cache</th>',
    '              <th class="num">Median cache read</th>',
    '              <th class="num">Median cache write</th>',
    '              <th class="num">With-cache (all) / No-cache</th>',
    '              <th class="num">With-cache (read) / No-cache</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    tableRows || '<tr><td colspan="11" class="muted">No runs found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderFiguresSection(ctx: ArenaReportHtmlContext) {
  const groups = groupFigures(ctx.figures);
  return groups
    .map((group) => {
      return [
        `<section class="section chartGroup" id="${escapeAttr(group.id)}">`,
        `<div class="chartGroupHeader">`,
        `<h2>${escapeHtml(group.title)}</h2>`,
        `<p class="sectionIntro muted small">${escapeHtml(group.subtitle)}</p>`,
        `</div>`,
        ...group.figures.map((figure) =>
          [
            `<article class="chartCard">`,
            `<div class="sectionHead">`,
            `<h3 id="${escapeAttr(figure.id)}">${escapeHtml(figure.title)}</h3>`,
            `<div class="actions" aria-label="Export chart">`,
            `<a class="btn" href="figures/${escapeAttr(figure.id)}.svg" download="${escapeAttr(figure.id)}.svg">SVG</a>`,
            `<button class="btn" type="button" data-export="png" data-figure="${escapeAttr(figure.id)}">PNG</button>`,
            `<button class="btn" type="button" data-export="data" data-figure="${escapeAttr(figure.id)}">Data</button>`,
            `</div>`,
            `</div>`,
            `<figure class="figure" data-figure-id="${escapeAttr(figure.id)}">`,
            `<div class="svgWrap" role="img" aria-label="${escapeAttr(figure.title)}">`,
            figure.svg,
            `</div>`,
            `<figcaption>${escapeHtml(figure.caption)}</figcaption>`,
            `</figure>`,
            `</article>`,
          ].join('\n'),
        ),
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
    `<col style="width: 680px" />`,
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
    `<th rowspan="2">Task</th>`,
    ...ctx.experiments.map((exp) => `<th colspan="4" class="group">${escapeHtml(exp)}</th>`),
    `</tr>`,
    `<tr>`,
    ...ctx.experiments.flatMap(() => [
      `<th class="num">Solved semantic</th>`,
      `<th class="num">Solved strict</th>`,
      `<th class="num">Median s</th>`,
      `<th class="num">Median tokens with cache</th>`,
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
            `Solved semantic: ${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}`,
            `Solved strict: ${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}`,
            `Median duration: ${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS)) + 's'}`,
            `Median tokens with cache: ${s.tokensMedianWithCacheAll === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianWithCacheAll))}`,
            `Median tokens no cache: ${s.tokensMedianNoCache === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianNoCache))}`,
          ].join('\n');

          return [
            `<td class="num" title="${escapeAttr(title)}">${s.solvedSemanticRate === null ? 'n/a' : fmtPct(s.solvedSemanticRate)}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.solvedStrictRate === null ? 'n/a' : fmtPct(s.solvedStrictRate)}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.durationMedianS === null ? 'n/a' : fmtInt(Math.round(s.durationMedianS))}</td>`,
            `<td class="num" title="${escapeAttr(title)}">${s.tokensMedianWithCacheAll === null ? 'n/a' : fmtInt(Math.round(s.tokensMedianWithCacheAll))}</td>`,
          ];
        })
        .join('');

      return [
        `<tr>`,
        `<td class="num">${fmtInt(t.index)}</td>`,
        `<td class="taskText">${t.task ? escapeHtml(t.task) : '<span class="muted">n/a</span>'}</td>`,
        cells,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  const taskCostColgroup = [
    `<colgroup>`,
    `<col style="width: 44px" />`,
    `<col style="width: 680px" />`,
    ...ctx.experiments.flatMap(() => [`<col style="width: 116px" />`, `<col style="width: 116px" />`]),
    `</colgroup>`,
  ].join('\n');

  const taskCostHeader = [
    `<thead>`,
    `<tr>`,
    `<th rowspan="2" class="num">#</th>`,
    `<th rowspan="2">Task</th>`,
    ...ctx.experiments.map((exp) => `<th colspan="2" class="group">${escapeHtml(exp)}</th>`),
    `</tr>`,
    `<tr>`,
    ...ctx.experiments.flatMap(() => [`<th class="num">Total $</th>`, `<th class="num">Median $</th>`]),
    `</tr>`,
    `</thead>`,
  ].join('\n');

  const taskCostRows = ctx.taskIndex
    .map((t) => {
      const cells = ctx.experiments
        .flatMap((exp) => {
          const s = byTaskKey.get(`${t.scenarioId}__${exp}`) ?? null;
          if (!s) return [`<td class="num muted">—</td>`, `<td class="num muted">—</td>`];
          return [
            `<td class="num">${s.costTotalUsd === null ? 'n/a' : fmtUsd(s.costTotalUsd)}</td>`,
            `<td class="num">${s.costMedianUsd === null ? 'n/a' : fmtUsd(s.costMedianUsd)}</td>`,
          ];
        })
        .join('');

      return [
        `<tr>`,
        `<td class="num">${fmtInt(t.index)}</td>`,
        `<td class="taskText">${t.task ? escapeHtml(t.task) : '<span class="muted">n/a</span>'}</td>`,
        cells,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section panelSection" id="section-task-breakdown">',
    '      <h2>Task Breakdown</h2>',
    '      <p class="sectionIntro muted small">Each row is one benchmark task. Columns show solved rates, median time, and median with-cache tokens per experiment.</p>',
    '      <div class="tableWrap">',
    '        <table class="tasks">',
    taskColgroup,
    taskTableHeader,
    '          <tbody>',
    taskTableRows || `<tr><td colspan="${2 + ctx.experiments.length * 4}" class="muted">No tasks found.</td></tr>`,
    '          </tbody>',
    '        </table>',
    '      </div>',
    '      <h3 class="subsectionTitle">Per-Setup × Per-Task Cost</h3>',
    '      <p class="sectionIntro muted small">Cost analysis by task and experiment, showing total USD and median USD per setup-task cell.</p>',
    '      <div class="tableWrap">',
    '        <table class="tasks">',
    taskCostColgroup,
    taskCostHeader,
    '          <tbody>',
    taskCostRows || `<tr><td colspan="${2 + ctx.experiments.length * 2}" class="muted">No tasks found.</td></tr>`,
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderModelResponsesSection(ctx: ArenaReportHtmlContext) {
  if (!ctx.modelLabel) {
    return [
      '    <section class="section panelSection" id="section-model-responses">',
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
    `<col style="width: 680px" />`,
    ...ctx.experiments.map(() => `<col style="width: 420px" />`),
    `</colgroup>`,
  ].join('\n');

  const tableHead = [
    `<thead>`,
    `<tr>`,
    `<th class="num">#</th>`,
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
        `<td class="taskText">${taskHtml}</td>`,
        cells,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section panelSection" id="section-model-responses">',
    '      <h2>Model Responses</h2>',
    '      <p class="sectionIntro muted small">Final JSON answers captured from each run. If multiple runs exist for a cell, all are listed.</p>',
    '      <div class="tableWrap">',
    '        <table class="responses">',
    colgroup,
    tableHead,
    '          <tbody>',
    rows || `<tr><td colspan="${2 + ctx.experiments.length}" class="muted">No tasks found.</td></tr>`,
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderJsonCell(runs: NormalizedRun[]) {
  const status = summarizeJsonCellStatus(runs);
  const summaryBase = runs.length > 1 ? `View JSON (${runs.length})` : 'View JSON';
  const summary = `${status.icon} ${status.label} - ${summaryBase}`;
  const bodies = runs
    .map((r, i) => {
      const runStatus = classifyRunStatus(r);
      const metaParts = [
        `${runStatus.icon} ${runStatus.label}`,
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
        text === null ? `<pre class="jsonPre muted">n/a</pre>` : `<pre class="jsonPre">${escapeHtml(text)}</pre>`;
      return `${header}${pre}`;
    })
    .join('');

  return `<details class="jsonDetails"><summary>${escapeHtml(summary)}</summary>${bodies}</details>`;
}

type JsonCellStatusKey = 'timeout' | 'correct_solution' | 'incorrect_solution';

function resolveRunEvalOutcome(run: NormalizedRun) {
  const provided = typeof run.evalOutcome === 'string' ? run.evalOutcome.trim() : '';
  if (provided) return provided;
  return deriveEvalOutcome({
    ok: run.ok,
    plumbingOk: run.plumbingOk,
    parseStatus: run.answerParseStatus,
    solvedStrict: run.solvedStrict,
    solvedSemantic: run.solvedSemantic,
  });
}

function classifyRunStatus(run: NormalizedRun): { key: JsonCellStatusKey; label: string; icon: string } {
  const outcome = resolveRunEvalOutcome(run);
  if (outcome === 'plumbing_failure') return { key: 'timeout', label: 'Timeout', icon: '⚪' };
  if (run.solvedSemantic === true || outcome === 'solved_semantic' || outcome === 'solved_strict') {
    return { key: 'correct_solution', label: 'Correct Solution', icon: '🟢' };
  }
  return { key: 'incorrect_solution', label: 'Incorrect Solution', icon: '🔴' };
}

function summarizeJsonCellStatus(runs: NormalizedRun[]) {
  const counts: Record<JsonCellStatusKey, number> = {
    timeout: 0,
    correct_solution: 0,
    incorrect_solution: 0,
  };

  for (const run of runs) {
    const status = classifyRunStatus(run);
    counts[status.key] += 1;
  }

  // Tie-breaker order keeps the harsher status when counts are equal.
  const precedence: JsonCellStatusKey[] = ['timeout', 'incorrect_solution', 'correct_solution'];
  let best: JsonCellStatusKey = precedence[0];
  let bestCount = -1;
  for (const key of precedence) {
    const count = counts[key];
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }

  if (best === 'timeout') return { key: best, label: 'Timeout', icon: '⚪' };
  if (best === 'correct_solution') return { key: best, label: 'Correct Solution', icon: '🟢' };
  return { key: best, label: 'Incorrect Solution', icon: '🔴' };
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
        `<td class="taskText">${row.task ? escapeHtml(row.task) : '<span class="muted">n/a</span>'}</td>`,
        `<td class="exp">${escapeHtml(row.app ?? 'n/a')}</td>`,
        `<td class="responseFormatCode">${row.responseFormat ? escapeHtml(row.responseFormat) : '<span class="muted">n/a</span>'}</td>`,
        `</tr>`,
      ].join('');
    })
    .join('\n');

  return [
    '    <section class="section panelSection" id="section-task-index">',
    '      <h2>Task Index</h2>',
    '      <p class="sectionIntro muted small">Reference list for task numbers used across charts and tables.</p>',
    '      <div class="tableWrap">',
    '        <table class="scenarios">',
    '          <thead>',
    '            <tr>',
    '              <th class="num">#</th>',
    '              <th>Task</th>',
    '              <th>App</th>',
    '              <th>Response format</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody>',
    scenarioRows || '<tr><td colspan="4" class="muted">No tasks found.</td></tr>',
    '          </tbody>',
    '        </table>',
    '      </div>',
    '    </section>',
  ].join('\n');
}

function renderFooter(ctx: ArenaReportHtmlContext) {
  void ctx;
  return '    <footer class="footer"></footer>';
}

function css(args: { figureWidthPx: number }) {
  return `
:root {
  --bg: #f4f5f5;
  --surface: #ffffff;
  --surface-muted: #f8f9fa;
  --ink: #111827;
  --muted: #5f6774;
  --grid: #d6dce5;
  --grid-strong: #bcc5d1;
  --grid-soft: #e5eaf1;
  --accent: #1d4ed8;
  --row-hover: #f2f5fa;
  --figure-min: ${args.figureWidthPx}px;
  --nav-w: 230px;
}

html, body {
  height: 100%;
}

body {
  margin: 0;
  padding: 28px calc(var(--nav-w) + 34px) 56px 18px;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.5 "IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  letter-spacing: -0.004em;
}

.wrap {
  max-width: 1120px;
  margin: 0 auto;
}

.floatingNav {
  position: fixed;
  top: 24px;
  right: 16px;
  width: var(--nav-w);
  max-height: calc(100vh - 28px);
  overflow: auto;
  border-left: 2px solid var(--grid-strong);
  padding: 0 0 0 12px;
  z-index: 30;
}

.floatingNavTitle {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 0 0 2px;
}

.floatingNavList {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  gap: 2px;
}

.floatingNavList a {
  display: block;
  text-decoration: none;
  color: var(--ink);
  padding: 4px 0 4px 8px;
  font-size: 12px;
  border-left: 2px solid transparent;
  transition: color 120ms ease, border-color 120ms ease;
}

.floatingNavList a:hover {
  color: var(--accent);
}

.floatingNavList a[aria-current="true"] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.header {
  margin-bottom: 22px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--grid-strong);
}

.home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 10px;
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.home:hover {
  color: var(--ink);
  text-decoration: underline;
}

.title {
  margin: 0;
  font-size: 40px;
  line-height: 1.06;
  letter-spacing: -0.028em;
}

.modelTitle {
  margin-top: 10px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.sub {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}

.section {
  margin-top: 30px;
  padding-top: 0;
  scroll-margin-top: 16px;
}

.panelSection {
  padding: 0;
}

.sectionHead {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.sectionKicker {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 6px;
}

.sectionIntro {
  margin: 10px 0 16px;
}

.overviewSection {
  padding: 0;
}

.overviewTitle {
  margin: 0;
}

.overviewGrid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.overviewCaveats {
  margin: 12px 0 0;
  padding-left: 18px;
}

.metricCard {
  border-left: 1px solid var(--grid-soft);
  padding: 12px 10px 11px;
  min-height: 0;
}

.overviewGrid .metricCard:first-child {
  border-left: 0;
}

.metricLabel {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.1em;
  font-weight: 700;
  text-transform: uppercase;
}

.metricValue {
  margin-top: 2px;
  font-size: 28px;
  line-height: 1.08;
  letter-spacing: -0.025em;
  font-weight: 620;
  color: var(--ink);
}

.metricMeta {
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}

.chartGroup {
  margin-top: 34px;
}

.chartGroupHeader {
  margin-bottom: 16px;
}

h2 {
  margin: 0 0 6px;
  font-size: 26px;
  line-height: 1.08;
  letter-spacing: -0.024em;
}

h3 {
  margin: 6px 0 7px;
  font-size: 17px;
  letter-spacing: -0.015em;
}

.chartCard {
  margin-top: 22px;
}

.chartCard .sectionHead h3 {
  margin-top: 0;
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
  margin-top: 12px;
  overflow-x: auto;
  background: var(--surface);
  border: 0;
}

table {
  border-collapse: collapse;
  width: 100%;
  min-width: 860px;
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
  border-bottom: 1px solid var(--grid-soft);
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}

.group {
  text-align: center;
  font-weight: 600;
  color: var(--ink);
}

tbody tr:hover td {
  background: var(--row-hover);
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
  margin: 8px 0 0;
  background: transparent;
  border: 0;
  padding: 0;
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
  margin-top: 9px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

.muted {
  color: var(--muted);
}

.small {
  font-size: 12px;
}

table.scenarios {
  min-width: 980px;
}

table.tasks {
  min-width: 1680px;
}

table.responses {
  min-width: 2360px;
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
  background: var(--surface-muted);
  border: 1px solid var(--grid);
  overflow: auto;
  max-height: 260px;
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.footer {
  margin-top: 24px;
  min-height: 1px;
}

.responseFormatCode {
  font: 12px/1.35 Consolas, "Liberation Mono", Menlo, Monaco, "Courier New", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

a:focus-visible,
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }
}

@media print {
  body {
    padding: 0;
  }

  .floatingNav,
  .actions {
    display: none;
  }

  .tableWrap,
  .figure {
    break-inside: avoid;
  }
}

@media (max-width: 1280px) {
  :root {
    --nav-w: 188px;
  }

  body {
    padding: 18px calc(var(--nav-w) + 24px) 40px 12px;
  }

  .floatingNav {
    right: 8px;
    top: 16px;
  }

  .floatingNavList a {
    font-size: 11px;
    padding: 3px 0 3px 7px;
  }
}

@media (max-width: 900px) {
  :root {
    --nav-w: 164px;
  }

  body {
    padding-right: calc(var(--nav-w) + 18px);
  }

  .floatingNavTitle {
    font-size: 9px;
  }

  .title {
    font-size: 31px;
  }

  .modelTitle {
    font-size: 24px;
  }

  .overviewGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 0;
  }

  .metricCard {
    border-top: 1px solid var(--grid);
    border-left: 0;
  }
}

@media (max-width: 640px) {
  body {
    padding: 12px calc(var(--nav-w) + 12px) 28px 8px;
    font-size: 13px;
  }

  .floatingNav {
    right: 4px;
    top: 8px;
    padding-left: 8px;
  }

  .floatingNavList a {
    font-size: 10px;
    padding: 2px 0 2px 6px;
  }

  .overviewGrid {
    grid-template-columns: 1fr;
  }

  .title {
    font-size: 24px;
  }

  .modelTitle {
    font-size: 20px;
  }

  .metricValue {
    font-size: 23px;
  }

  .actions {
    gap: 6px;
  }

  .btn {
    padding: 5px 7px;
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

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f4f5f5';
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

  function setupScrollSpy() {
    const links = Array.from(document.querySelectorAll('.floatingNav a[href^="#"]'));
    if (!links.length) return;

    const byId = new Map();
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const id = href.startsWith('#') ? href.slice(1) : '';
      if (!id) continue;
      const section = document.getElementById(id);
      if (!section) continue;
      byId.set(id, { link, section });
    }

    const entries = Array.from(byId.entries());
    if (!entries.length) return;

    function setActive(id) {
      for (const [key, pair] of entries) {
        if (key === id) pair.link.setAttribute('aria-current', 'true');
        else pair.link.removeAttribute('aria-current');
      }
    }

    const observer = new IntersectionObserver(
      (items) => {
        const visible = items
          .filter((item) => item.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (!visible.length) return;
        const hit = visible[0];
        const id = hit.target.id;
        if (id) setActive(id);
      },
      {
        rootMargin: '-15% 0px -70% 0px',
        threshold: [0, 0.2, 0.5, 1],
      },
    );

    for (const [, pair] of entries) observer.observe(pair.section);

    const firstId = entries[0][0];
    if (firstId) setActive(firstId);
  }

  setupScrollSpy();
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

function safeJsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const ESC_HTML: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
