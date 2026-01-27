#!/usr/bin/env node
import path from 'node:path';
import { Command, Option } from 'commander';
import { consola } from 'consola';
import { defaultConfigPaths, loadArenaConfig } from './load.js';
import { writeAggregatedMetrics } from './logs/aggregate.js';
import { exportSessionLogs } from './logs/export-session.js';
import { resolveFromCwd } from './paths.js';
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
  .option('--write-metrics', 'Write aggregated metrics.jsonl and metrics.csv into the output directory')
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
      const outDir = raw.out ? resolveFromCwd(raw.out) : resolveFromBase(runConfig.outDir ?? defaultOutDir(baseOutDir), baseOutDir);
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
