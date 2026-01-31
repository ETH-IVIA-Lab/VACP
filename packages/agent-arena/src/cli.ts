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
import { DEFAULT_CHARTS, DEFAULT_REPORT_SECTIONS, generateArenaReport } from './report/index.js';
import { runArena } from './runner/index.js';

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
  .option('--resume', 'Reuse successful run.json results when present')
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
  .command('analyze')
  .description('Parse a run folder and export tabular datasets (runs + tool calls)')
  .requiredOption('--run <dir>', 'Arena run folder (contains results.json + runs/...)')
  .option('--out <dir>', 'Output directory. Default: <runDir>/analysis')
  .option(
    '--config <path>',
    'Arena config file (TS/JS). Used to load SCENARIO_BASES judge predicates for scoring. Default: ./packages/agent-arena/agent-arena.config.ts if present.',
  )
  .option(
    '--opencode-root <dir>',
    'OpenCode root or storage dir. Defaults try ~/.local/share/opencode/storage then ~/.opencode/storage.',
  )
  .option('--max-field-chars <n>', 'Max chars stored per large string field (sensitive default). Default: 500', '500')
  .action(async (raw) => {
    try {
      const runDir = resolveFromCwd(raw.run);
      const outDir = raw.out ? resolveFromCwd(raw.out) : undefined;
      const configPath = raw.config ? resolveFromCwd(raw.config) : undefined;
      const opencodeRoot = raw.opencodeRoot ? resolveFromCwd(raw.opencodeRoot) : undefined;
      const maxFieldChars = Number(raw.maxFieldChars);

      const res = await analyzeArenaRun({
        runDir,
        ...(outDir ? { outDir } : {}),
        ...(configPath ? { configPath } : {}),
        ...(opencodeRoot ? { opencodeRoot } : {}),
        ...(Number.isFinite(maxFieldChars) ? { maxFieldChars } : {}),
      });

      consola.success(`Wrote analysis to: ${res.outDir}`);
      consola.info(`- runs:       ${res.runsJsonPath}`);
      consola.info(`- tool calls:  ${res.toolCallsJsonPath}`);
      consola.info(`- meta:       ${res.metaPath}`);
    } catch (error) {
      consola.error(error);
      process.exitCode = 1;
    }
  });

program
  .command('report')
  .description('Generate a publication-ready HTML + SVG report from an analysis folder')
  .requiredOption('--analysis <dir>', 'Analysis folder (contains meta.json + runs.*)')
  .option('--out <dir>', 'Output directory. Default: <analysisDir>/report')
  .option('--width <px>', 'Override figure width in px (affects all charts)')
  .option('--font-size <px>', 'Override base chart font size in px (affects all charts)')
  .option('--charts <ids>', 'Comma-separated chart ids to include (default: all)')
  .option('--sections <ids>', 'Comma-separated report section ids to include (default: all)')
  .option('--chart-config <path>', 'JSON file mapping chart ids -> per-chart config (layout + chart-specific options)')
  .action(async (raw) => {
    try {
      const analysisDir = resolveFromCwd(raw.analysis);
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

      const res = await generateArenaReport({
        analysisDir,
        ...(outDir ? { outDir } : {}),
        ...(Object.keys(theme).length ? { theme } : {}),
        ...(charts ? { charts } : {}),
        ...(sections ? { sections } : {}),
        ...(chartConfigById ? { chartConfigById } : {}),
      });
      consola.success(`Wrote report to: ${res.outDir}`);
      consola.info(`- html:     ${res.htmlPath}`);
      consola.info(`- figures:  ${res.figuresDir}`);
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
