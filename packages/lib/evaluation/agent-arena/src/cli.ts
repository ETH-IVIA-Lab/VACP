#!/usr/bin/env node
import path from 'node:path';
import { Command, Option } from 'commander';
import { consola } from 'consola';
import { defaultConfigPaths, loadArenaConfig } from './load.js';
import { writeAggregatedMetrics } from './logs/aggregate.js';
import { exportSessionLogs } from './logs/export-session.js';
import { resolveFromCwd } from './paths.js';
import { analyzeArenaRun } from './analyze/analyze-run.js';
import fs from 'node:fs/promises';
import {
  DEFAULT_CHARTS,
  DEFAULT_REPORT_SECTIONS,
  exportArenaDatasets,
  generateArenaReportSuite,
} from './report/index.js';
import { runArena } from './runner/index.js';
import { computeJobIdentityKey, inspectJob, type ResumeReuseMode } from './runner/job-state.js';
import {
  buildResumeOutcomeSelection,
  parseResumeRerunOutcomesCsv,
  type ResumeOutcomeSelection,
} from './runner/resume-selective.js';

const program = new Command()
  .name('agent-arena')
  .description('Run config-driven OpenCode sessions via @opencode-ai/sdk')
  .showHelpAfterError();

program
  .command('run')
  .description('Run all configured runs in your arena config')
  .option('--config <path>', 'Arena config file (TS/JS). Default: ./agent-arena.config.ts')
  .option('--directory <path>', 'OpenCode directory used for project/session context')
  .option('--out <dir>', 'Output directory. Default: ./.agent-arena/runs/<timestamp>')
  .option('--only <substring>', 'Only run entries whose experiment includes this substring')
  .option('--resume', 'Reuse successful run.json results when present (reruns failures)')
  .option('--export-logs', 'Export OpenCode session messages/tool calls + metrics into each job folder')
  .option('--write-metrics', 'Write aggregated metrics.json and tool_calls.json into the output directory')
  .addOption(
    new Option('--auto-approve <mode>', 'Auto-approve permission requests')
      .choices(['off', 'once', 'always', 'reject'])
      .default('always'),
  )
  .action(async (raw) => {
    try {
      const defaults = defaultConfigPaths();
      const configPath = raw.config ? resolveFromCwd(raw.config) : defaults.config;
      const cfg = await loadArenaConfig(configPath);

      const filtered = raw.only
        ? { ...cfg, runs: cfg.runs.filter((r) => r.experiment.toLowerCase().includes(String(raw.only).toLowerCase())) }
        : cfg;

      const runConfig = {
        ...filtered,
        ...(raw.directory ? { directory: resolveFromCwd(raw.directory) } : {}),
        autoApprove: raw.autoApprove ?? filtered.autoApprove,
        ...(raw.resume ? { resume: true } : {}),
      };

      const baseOutDir = runConfig.directory ? path.resolve(runConfig.directory) : process.cwd();
      const outDir = raw.out
        ? resolveFromCwd(raw.out)
        : resolveFromBase(runConfig.outDir ?? defaultOutDir(baseOutDir), baseOutDir);
      consola.box(
        [
          `agent-arena`,
          ``,
          `Config:    ${configPath}`,
          `Directory: ${runConfig.directory ?? '(auto)'}`,
          `Out:       ${outDir}`,
        ].join('\n'),
      );

      const exportLogs = Boolean(raw.exportLogs);
      const writeMetrics = Boolean(raw.writeMetrics) || exportLogs;

      const results = await runArena({
        config: runConfig,
        outDir,
        ...(exportLogs
          ? {
              hooks: {
                afterJob: async ({ result, directory, client, jobOutDir, uiBase }) => {
                  if (!result.sessionID) return;
                  const uiUrl = uiBase ? `${uiBase}/session/${result.sessionID}` : undefined;
                  await exportSessionLogs({
                    client,
                    directory,
                    sessionID: result.sessionID,
                    outDir: jobOutDir,
                    ...(uiUrl ? { uiUrl } : {}),
                  });
                },
              },
            }
          : {}),
      });
      if (writeMetrics) await writeAggregatedMetrics({ arenaOutDir: outDir, outDir });
      const ok = results.filter((r) => r.ok).length;
      const bad = results.length - ok;
      consola.success(`Done: ${results.length} runs (${ok} ok, ${bad} failed)`);
      consola.info(`Results: ${resolveFromCwd(outDir)}/results.json`);
      process.exitCode = bad > 0 ? 1 : 0;
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });

program
  .command('resume')
  .description('Resume an existing run folder (runs only missing/unfinished jobs)')
  .requiredOption('--run <dir>', 'Existing arena run folder (contains runs/**/input.json)')
  .option(
    '--config <path>',
    'Arena config file (TS/JS). Default: inferred from the run folder or ./agent-arena.config.ts',
  )
  .option('--directory <path>', 'OpenCode directory used for project/session context')
  .option('--only <substring>', 'Only run entries whose experiment includes this substring')
  .option('--dry-run', 'Plan only; do not execute any runs')
  .option('--rerun-failed', 'Rerun jobs that finished with ok=false (default: reuse finished results)')
  .option(
    '--rerun-outcomes <list>',
    'Comma-separated eval outcomes to rerun (supported: protocol_failure, plumbing_failure)',
  )
  .option('--analysis <dir>', 'Analysis directory used for --rerun-outcomes (default: <runDir>/analysis)')
  .option('--export-logs', 'Export OpenCode session messages/tool calls + metrics into each job folder')
  .option('--write-metrics', 'Write aggregated metrics.json and tool_calls.json into the output directory')
  .addOption(
    new Option('--auto-approve <mode>', 'Auto-approve permission requests')
      .choices(['off', 'once', 'always', 'reject'])
      .default('always'),
  )
  .action(async (raw) => {
    try {
      const runDir = resolveFromCwd(raw.run);
      await assertIsDirectory(runDir);

      const defaults = defaultConfigPaths();
      const inferredConfig = await inferConfigPath({ explicit: raw.config, runDir, fallback: defaults.config });
      const configPath = inferredConfig ? inferredConfig : defaults.config;

      const cfg = await loadArenaConfig(configPath);
      const filtered = raw.only
        ? { ...cfg, runs: cfg.runs.filter((r) => r.experiment.toLowerCase().includes(String(raw.only).toLowerCase())) }
        : cfg;

      const rerunOutcomes = parseResumeRerunOutcomesCsv(raw.rerunOutcomes);
      if (raw.rerunFailed && rerunOutcomes?.length) {
        throw new Error(`--rerun-failed and --rerun-outcomes are mutually exclusive`);
      }

      const resumeReuseMode: ResumeReuseMode = raw.rerunFailed ? 'ok' : 'finished';
      const runConfig = {
        ...filtered,
        ...(raw.directory ? { directory: resolveFromCwd(raw.directory) } : {}),
        autoApprove: raw.autoApprove ?? filtered.autoApprove,
        resume: true,
      };
      const analysisDir = rerunOutcomes?.length
        ? raw.analysis
          ? resolveFromCwd(raw.analysis)
          : path.join(runDir, 'analysis')
        : null;
      const resumeOutcomeSelection =
        rerunOutcomes?.length && analysisDir
          ? await buildResumeOutcomeSelection({
              runDir,
              analysisDir,
              jobs: runConfig.runs,
              selectedOutcomes: rerunOutcomes,
            })
          : null;

      const outDir = runDir;
      await logResumePlan({
        config: runConfig,
        outDir,
        configPath,
        resumeReuseMode,
        resumeOutcomeSelection,
      });
      if (raw.dryRun) return;

      // Preserve the original manifest/context for postmortems; `runArena` will rewrite these.
      await backupIfPresent(path.join(outDir, 'inputs.json'));
      await backupIfPresent(path.join(outDir, 'context.json'));

      const exportLogs = Boolean(raw.exportLogs);
      const writeMetrics = Boolean(raw.writeMetrics) || exportLogs;

      const results = await runArena({
        config: runConfig,
        outDir,
        resumeReuseMode,
        ...(resumeOutcomeSelection
          ? {
              resumeForcedRerunByJobKey: new Map(
                Array.from(resumeOutcomeSelection.forcedByJobKey.entries()).map(([k, v]) => [k, v.outcome] as const),
              ),
            }
          : {}),
        ...(exportLogs
          ? {
              hooks: {
                afterJob: async ({ result, directory, client, jobOutDir, uiBase }) => {
                  if (!result.sessionID) return;
                  const uiUrl = uiBase ? `${uiBase}/session/${result.sessionID}` : undefined;
                  await exportSessionLogs({
                    client,
                    directory,
                    sessionID: result.sessionID,
                    outDir: jobOutDir,
                    ...(uiUrl ? { uiUrl } : {}),
                  });
                },
              },
            }
          : {}),
      });

      if (writeMetrics) await writeAggregatedMetrics({ arenaOutDir: outDir, outDir });

      const ok = results.filter((r) => r.ok).length;
      const bad = results.length - ok;
      consola.success(`Done: ${results.length} runs (${ok} ok, ${bad} failed)`);
      consola.info(`Results: ${resolveFromCwd(outDir)}/results.json`);
      process.exitCode = bad > 0 ? 1 : 0;
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });

program
  .command('analyze')
  .description('Parse a run folder and export tabular datasets (runs + tool calls)')
  .requiredOption('--run <dir>', 'Arena run folder (contains results.json + runs/...)')
  .option('--out <dir>', 'Output directory. Default: <runDir>/analysis')
  .option(
    '--config <path>',
    'Arena config file (TS/JS). Used to load SCENARIO_BASES judge predicates for scoring. Default: ./packages/lib/evaluation/agent-arena/agent-arena.config.ts if present.',
  )
  .option('--max-field-chars <n>', 'Max chars stored per large string field (sensitive default). Default: 500', '500')
  .action(async (raw) => {
    try {
      const runDir = resolveFromCwd(raw.run);
      const outDir = raw.out ? resolveFromCwd(raw.out) : undefined;
      const configPath = raw.config ? resolveFromCwd(raw.config) : undefined;
      const maxFieldChars = Number(raw.maxFieldChars);

      const res = await analyzeArenaRun({
        runDir,
        ...(outDir ? { outDir } : {}),
        ...(configPath ? { configPath } : {}),
        ...(Number.isFinite(maxFieldChars) ? { maxFieldChars } : {}),
      });

      consola.success(`Wrote analysis to: ${res.outDir}`);
      consola.info(`- runs:       ${res.runsJsonPath}`);
      consola.info(`- tool calls:  ${res.toolCallsJsonPath}`);
      consola.info(`- meta:       ${res.metaPath}`);
      consola.info(`- transcripts: ${res.transcriptsWritten} (runs/**/transcript.md)`);
      consola.info(`- exports:    ${res.opencodeExportManifestPath}`);
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });

program
  .command('report')
  .description('Generate a publication-ready HTML + SVG report from one or more analysis folders')
  .requiredOption('--analysis <dirs...>', 'Analysis folder(s), each containing meta.json + runs.*')
  .option('--out <dir>', 'Output directory. Default: <analysisDir>/report')
  .option('--width <px>', 'Override figure width in px (affects all charts)')
  .option('--font-size <px>', 'Override base chart font size in px (affects all charts)')
  .option('--charts <ids>', 'Comma-separated chart ids to include (default: all)')
  .option('--sections <ids>', 'Comma-separated report section ids to include (default: all)')
  .option('--chart-config <path>', 'JSON file mapping chart ids -> per-chart config (layout + chart-specific options)')
  .action(async (raw) => {
    try {
      const analysisDirs = parseAnalysisDirs(raw.analysis);
      const outDir = raw.out ? resolveFromCwd(raw.out) : undefined;

      const width = raw.width ? Number(raw.width) : undefined;
      const fontSizePx = raw.fontSize ? Number(raw.fontSize) : undefined;

      const chartIds = parseCsv(raw.charts);
      const charts = chartIds ? selectById(DEFAULT_CHARTS, chartIds, 'chart') : undefined;

      const sectionIds = parseCsv(raw.sections);
      const sections = sectionIds ? selectById(DEFAULT_REPORT_SECTIONS, sectionIds, 'section') : undefined;

      const chartConfigPath = raw.chartConfig ? resolveFromCwd(raw.chartConfig) : null;
      const chartConfigById = chartConfigPath ? await loadJsonObject(chartConfigPath) : undefined;

      const theme = {
        ...(typeof width === 'number' && Number.isFinite(width) && width > 0 ? { width } : {}),
        ...(typeof fontSizePx === 'number' && Number.isFinite(fontSizePx) && fontSizePx > 0 ? { fontSizePx } : {}),
      };

      const res = await generateArenaReportSuite({
        analysisDir: analysisDirs,
        ...(outDir ? { outDir } : {}),
        ...(Object.keys(theme).length ? { theme } : {}),
        ...(charts ? { charts } : {}),
        ...(sections ? { sections } : {}),
        ...(chartConfigById ? { chartConfigById } : {}),
      });
      consola.success(`Wrote report suite to: ${res.outDir}`);
      consola.info(`- index:  ${res.indexHtmlPath}`);
      if (res.allHtmlPath) consola.info(`- all:    ${res.allHtmlPath}`);
      for (const page of res.modelReports) {
        consola.info(`- model:  ${page.modelLabel}  →  ${page.htmlPath}`);
      }
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });

program
  .command('datasets')
  .description('Export chart-ready datasets from one or more analysis folders')
  .requiredOption('--analysis <dirs...>', 'Analysis folder(s), each containing meta.json + runs.*')
  .option('--out <dir>', 'Output directory. Default: <analysisDir>/datasets')
  .option('--charts <ids>', 'Comma-separated chart ids to export (default: all)')
  .option('--chart-config <path>', 'JSON file mapping chart ids -> per-chart config (affects dataset shape)')
  .action(async (raw) => {
    try {
      const analysisDirs = parseAnalysisDirs(raw.analysis);
      const outDir = raw.out ? resolveFromCwd(raw.out) : undefined;

      const chartIds = parseCsv(raw.charts);
      const charts = chartIds ? selectById(DEFAULT_CHARTS, chartIds, 'chart') : undefined;

      const chartConfigPath = raw.chartConfig ? resolveFromCwd(raw.chartConfig) : null;
      const chartConfigById = chartConfigPath ? await loadJsonObject(chartConfigPath) : undefined;

      const res = await exportArenaDatasets({
        analysisDir: analysisDirs,
        ...(outDir ? { outDir } : {}),
        ...(charts ? { charts } : {}),
        ...(chartConfigById ? { chartConfigById } : {}),
      });

      consola.success(`Wrote datasets to: ${res.outDir}`);
      consola.info(`- charts: ${path.join(res.outDir, 'charts')}`);
      consola.info(
        `- tables: runs_normalized.json, experiment_summaries.json, task_summaries.json, cost_by_task_setup.json, token_accounting_by_experiment.json, token_accounting_by_task.json, task_index.json, tool_by_experiment.json, tool_by_scenario.json`,
      );
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });
const argv =
  process.argv.length >= 3 && process.argv[2] === '--'
    ? [...process.argv.slice(0, 2), ...process.argv.slice(3)]
    : process.argv;

void main(argv);

async function main(argv: string[]) {
  try {
    await program.parseAsync(argv);
  } catch (error) {
    consola.error(error);
    process.exitCode = 1;
  } finally {
    // Ensure the CLI terminates promptly even if the Node fetch stack keeps
    // idle keep-alive sockets open briefly.
    process.exit(process.exitCode ?? 0);
  }
}

function defaultOutDir(baseDir?: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = baseDir ? path.basename(path.resolve(baseDir)) : '';
  return baseName === '.agent-arena' ? `runs/${stamp}` : `.agent-arena/runs/${stamp}`;
}

function resolveFromBase(p: string, baseDir: string) {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

function parseCsv(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

function parseAnalysisDirs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const dirs = values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => resolveFromCwd(item));
  if (!dirs.length) throw new Error('Expected at least one --analysis directory.');
  return dirs;
}

function selectById<T extends { id: string }>(items: T[], ids: string[], kind: string) {
  const byId = new Map<string, T>(items.map((i) => [i.id, i] as const));
  const out: T[] = [];
  for (const id of ids) {
    const found = byId.get(id);
    if (!found) {
      const known = Array.from(byId.keys())
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
      throw new Error(`Unknown ${kind} id: ${id}\nKnown ${kind}s: ${known}`);
    }
    out.push(found);
  }
  return out;
}

async function loadJsonObject(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${filePath}\n${String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object in: ${filePath}`);
  }
  return parsed as Record<string, unknown>;
}

async function assertIsDirectory(p: string) {
  const st = await fs.stat(p).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`Not a directory: ${p}`);
}

async function inferConfigPath(args: { explicit?: string; runDir: string; fallback: string }) {
  if (typeof args.explicit === 'string' && args.explicit.trim()) return resolveFromCwd(args.explicit);

  const candidates: string[] = [];
  candidates.push(args.fallback);

  // Common monorepo layout: infer config as sibling of `.agent-arena/`.
  // <pkg>/.agent-arena/runs/<id>  ->  <pkg>/agent-arena.config.ts
  const runDirAbs = path.resolve(args.runDir);
  const maybeAgentArenaDir = path.resolve(runDirAbs, '..', '..'); // .../.agent-arena
  const maybePkgDir = path.resolve(maybeAgentArenaDir, '..'); // .../packages/lib/evaluation/agent-arena
  candidates.push(path.join(maybePkgDir, 'agent-arena.config.ts'));

  // As a convenience when running from repo root.
  candidates.push(path.resolve(process.cwd(), 'packages/lib/evaluation/agent-arena/agent-arena.config.ts'));

  for (const p of candidates) {
    const st = await fs.stat(p).catch(() => null);
    if (st && st.isFile()) return p;
  }
  return null;
}

async function logResumePlan(args: {
  config: Awaited<ReturnType<typeof loadArenaConfig>>;
  outDir: string;
  configPath: string;
  resumeReuseMode: ResumeReuseMode;
  resumeOutcomeSelection?: ResumeOutcomeSelection | null;
}) {
  const manifest = await readJsonOptional(path.join(args.outDir, 'inputs.json'));
  const manifestValue =
    manifest?.value && typeof manifest.value === 'object' && !Array.isArray(manifest.value)
      ? (manifest.value as any)
      : null;
  const manifestStartedAt = typeof manifestValue?.startedAt === 'string' ? String(manifestValue.startedAt) : null;
  const manifestRuns = Array.isArray(manifestValue?.runs) ? Number(manifestValue.runs.length) : null;

  const inspections = await Promise.all(
    args.config.runs.map((job, index) =>
      inspectJob({ arenaOutDir: args.outDir, job, index, reuseMode: args.resumeReuseMode }),
    ),
  );
  const forcedByJobKey = args.resumeOutcomeSelection?.forcedByJobKey ?? new Map();
  const hasOutcomeSelection = Boolean(args.resumeOutcomeSelection);

  let done = 0;
  let partial = 0;
  let missing = 0;
  let rerunFailed = 0;
  let rerunOutcome = 0;

  const byExperiment = new Map<
    string,
    { total: number; done: number; partial: number; missing: number; rerunFailed: number; rerunOutcome: number }
  >();

  for (let i = 0; i < args.config.runs.length; i++) {
    const job = args.config.runs[i];
    const insp = inspections[i];
    const forced = forcedByJobKey.get(computeJobIdentityKey({ job, index: i }));

    if (insp.state === 'complete' && insp.reusable && !forced) done += 1;
    else if (insp.state === 'partial') partial += 1;
    else if (insp.state === 'missing') missing += 1;
    else if (forced) rerunOutcome += 1;
    else rerunFailed += 1;

    const ex = job.experiment;
    const row = byExperiment.get(ex) ?? { total: 0, done: 0, partial: 0, missing: 0, rerunFailed: 0, rerunOutcome: 0 };
    row.total += 1;
    if (insp.state === 'complete' && insp.reusable && !forced) row.done += 1;
    else if (insp.state === 'partial') row.partial += 1;
    else if (insp.state === 'missing') row.missing += 1;
    else if (forced) row.rerunOutcome += 1;
    else row.rerunFailed += 1;
    byExperiment.set(ex, row);
  }
  const toRun = partial + missing + rerunFailed + rerunOutcome;

  const outcomeCounts = new Map<string, number>();
  for (const forced of forcedByJobKey.values()) {
    outcomeCounts.set(forced.outcome, (outcomeCounts.get(forced.outcome) ?? 0) + 1);
  }

  const sortedExperiments = Array.from(byExperiment.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const expLines = sortedExperiments.map(([ex, r]) => {
    const toRun = r.total - r.done;
    const detailParts = [`missing ${r.missing}`, `partial ${r.partial}`];
    if (r.rerunFailed > 0) detailParts.push(`rerunFailed ${r.rerunFailed}`);
    if (r.rerunOutcome > 0) detailParts.push(`rerunOutcome ${r.rerunOutcome}`);
    const parts = `done ${r.done}/${r.total}, to run ${toRun} (${detailParts.join(', ')})`;
    return `- ${ex}: ${parts}`;
  });

  const partialItems = args.config.runs
    .map((job, idx) => ({ job, insp: inspections[idx] }))
    .filter((x) => x.insp.state === 'partial')
    .slice(0, 12)
    .map(
      (x) =>
        `- ${x.job.experiment} · ${x.job.scenario.id} · ${x.job.model.providerID}/${x.job.model.modelID} (${x.insp.reason})`,
    );
  const partialExtra = partial > partialItems.length ? `(+${partial - partialItems.length} more)` : null;

  const rerunFailedItems =
    args.resumeReuseMode === 'ok'
      ? args.config.runs
          .map((job, idx) => ({ job, insp: inspections[idx] }))
          .filter(
            (
              x,
            ): x is {
              job: (typeof args.config.runs)[number];
              insp: Extract<(typeof inspections)[number], { state: 'complete' }>;
            } => x.insp.state === 'complete' && x.insp.reusable === false,
          )
          .slice(0, 10)
          .map((x) => {
            const err = x.insp.result.error?.message ? ` | ${x.insp.result.error.message}` : '';
            return `- ${x.job.experiment} · ${x.job.scenario.id} · ${x.job.model.providerID}/${x.job.model.modelID}${err}`;
          })
      : [];
  const rerunFailedExtra =
    args.resumeReuseMode === 'ok' && rerunFailed > rerunFailedItems.length
      ? `(+${rerunFailed - rerunFailedItems.length} more)`
      : null;
  const rerunOutcomeRows = hasOutcomeSelection
    ? args.config.runs
        .map((job, idx) => ({
          job,
          forced: forcedByJobKey.get(computeJobIdentityKey({ job, index: idx })),
          scenarioId: job.scenario.id ?? `s${idx + 1}`,
        }))
        .filter((x) => Boolean(x.forced))
    : [];
  const rerunOutcomeItems = rerunOutcomeRows
    .slice(0, 12)
    .map(
      (x) =>
        `- ${x.job.experiment} · ${x.scenarioId} · ${x.job.model.providerID}/${x.job.model.modelID} (${x.forced?.outcome ?? 'unknown'})`,
    );
  const rerunOutcomeExtra =
    hasOutcomeSelection && rerunOutcome > rerunOutcomeItems.length
      ? `(+${rerunOutcome - rerunOutcomeItems.length} more)`
      : null;
  const selectedOutcomes = args.resumeOutcomeSelection?.selectedOutcomes ?? [];
  const selectedOutcomeLines = selectedOutcomes.map((outcome) => `  - ${outcome}: ${outcomeCounts.get(outcome) ?? 0}`);

  consola.box(
    [
      `agent-arena resume`,
      ``,
      `Run dir:   ${args.outDir}`,
      `Config:    ${args.configPath}`,
      `Directory: ${args.config.directory ?? '(auto)'}`,
      `Reuse:     ${args.resumeReuseMode === 'finished' ? 'finished (ok+failed)' : 'ok only (rerun failed)'}`,
      hasOutcomeSelection ? `Analysis:  ${args.resumeOutcomeSelection?.analysisDir}` : null,
      hasOutcomeSelection ? `Outcomes:  ${selectedOutcomes.join(', ')}` : null,
      manifestStartedAt
        ? `Prev run:  startedAt=${manifestStartedAt}${manifestRuns ? ` runs=${manifestRuns}` : ''}`
        : null,
      ``,
      `Plan:`,
      `- total:   ${inspections.length}`,
      `- done:    ${done}`,
      `- to run:  ${toRun}`,
      `  - missing:      ${missing}`,
      `  - partial:      ${partial}`,
      args.resumeReuseMode === 'ok' ? `  - rerun failed: ${rerunFailed}` : null,
      hasOutcomeSelection ? `  - rerun outcomes: ${rerunOutcome}` : null,
      hasOutcomeSelection
        ? `  - matched completed jobs in analysis: ${args.resumeOutcomeSelection?.matchedJobs}`
        : null,
      hasOutcomeSelection ? `  - complete jobs in run dir: ${args.resumeOutcomeSelection?.completeJobs}` : null,
      hasOutcomeSelection ? `  - analysis runs file: ${args.resumeOutcomeSelection?.analysisRunsPath}` : null,
      hasOutcomeSelection ? `  - selected-outcome counts:` : null,
      ...(hasOutcomeSelection ? selectedOutcomeLines : []),
      ``,
      `By experiment:`,
      ...expLines,
      partialItems.length ? `` : null,
      partialItems.length ? `Partial jobs (showing up to ${partialItems.length}):` : null,
      ...partialItems,
      partialExtra,
      rerunFailedItems.length ? `` : null,
      rerunFailedItems.length ? `Rerun failed jobs (showing up to ${rerunFailedItems.length}):` : null,
      ...rerunFailedItems,
      rerunFailedItems.length ? rerunFailedExtra : null,
      rerunOutcomeItems.length ? `` : null,
      rerunOutcomeItems.length ? `Rerun outcome jobs (showing up to ${rerunOutcomeItems.length}):` : null,
      ...rerunOutcomeItems,
      rerunOutcomeItems.length ? rerunOutcomeExtra : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function readJsonOptional(filePath: string): Promise<{ value: unknown } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

async function backupIfPresent(filePath: string) {
  const st = await fs.stat(filePath).catch(() => null);
  if (!st || !st.isFile()) return;

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, `${base}.pre-resume.${stamp}.bak`);
  await fs.copyFile(filePath, out);
}
