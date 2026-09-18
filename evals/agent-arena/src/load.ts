import { isRecord } from './records.js';

import path from 'node:path';
import { createJiti } from 'jiti';
import { resolveFromCwd } from './paths.js';
import type { ArenaConfig, ArenaJob, ArenaModelPricing, Scenario } from './types.js';

export async function loadArenaConfig(filePath: string): Promise<ArenaConfig> {
  const resolved = resolveFromCwd(filePath);
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const mod = (await jiti.import(resolved)) as any;
  const cfg = (mod?.default ?? mod?.config ?? mod) as ArenaConfig;

  if (!cfg || typeof cfg !== 'object') {
    throw new Error(`Config must export an object (default export recommended): ${resolved}`);
  }

  if (!Array.isArray(cfg.runs) || cfg.runs.length === 0) {
    throw new Error(`Config must include a non-empty 'runs' array: ${resolved}`);
  }

  cfg.runs = cfg.runs.map((r, i) => normalizeRun(r, i, resolved));

  const hasDefaultPrompt = typeof cfg.promptTemplate === 'function';
  const hasPerRunPrompts = cfg.runs.every((r) => typeof r.promptTemplate === 'function');

  if (!hasDefaultPrompt && !hasPerRunPrompts) {
    throw new Error(`Config must provide a 'promptTemplate' function (either on config or on every run): ${resolved}`);
  }

  return cfg;
}

export function defaultConfigPaths() {
  return {
    config: path.resolve(process.cwd(), 'agent-arena.config.ts'),
  };
}

function normalizeScenario(input: any, index: number, source: string): Scenario {
  if (!input || typeof input !== 'object') {
    throw new Error(`Scenario at index ${index} must be an object: ${source}`);
  }

  if (typeof input.url !== 'string' || !input.url.trim()) {
    throw new Error(`Scenario at index ${index} is missing 'url': ${source}`);
  }

  if (typeof input.task !== 'string' || !input.task.trim()) {
    throw new Error(`Scenario at index ${index} is missing 'task': ${source}`);
  }

  if (typeof input.responseFormat !== 'string' || !input.responseFormat.trim()) {
    throw new Error(`Scenario at index ${index} is missing 'responseFormat': ${source}`);
  }

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : `s${index + 1}`;
  const responseFormat = input.responseFormat.trim();
  const tags = Array.isArray(input.tags) ? input.tags.filter((t: unknown) => typeof t === 'string') : undefined;
  const scenario: Scenario = { id, url: input.url, task: input.task, responseFormat, ...(tags ? { tags } : {}) };

  return scenario;
}

function normalizeRun(input: any, index: number, source: string): ArenaJob {
  if (!input || typeof input !== 'object') {
    throw new Error(`Run at index ${index} must be an object: ${source}`);
  }

  if (typeof input.experiment !== 'string' || !input.experiment.trim()) {
    throw new Error(`Run at index ${index} is missing 'experiment': ${source}`);
  }

  if (!input.model || typeof input.model !== 'object') {
    throw new Error(`Run at index ${index} is missing 'model': ${source}`);
  }

  if (typeof input.model.providerID !== 'string' || !input.model.providerID.trim()) {
    throw new Error(`Run at index ${index} is missing 'model.providerID': ${source}`);
  }

  if (typeof input.model.modelID !== 'string' || !input.model.modelID.trim()) {
    throw new Error(`Run at index ${index} is missing 'model.modelID': ${source}`);
  }

  const scenario = normalizeScenario(input.scenario, index, source);
  const pricing = normalizeModelPricing(input.model.pricing);

  return {
    ...input,
    experiment: input.experiment.trim(),
    model: {
      providerID: input.model.providerID,
      modelID: input.model.modelID,
      ...(pricing ? { pricing } : {}),
    },
    scenario,
  } as ArenaJob;
}

function normalizeModelPricing(value: unknown): ArenaModelPricing | null {
  if (!isRecord(value)) return null;
  const input = asFiniteNumber(value.input);
  const output = asFiniteNumber(value.output);
  const cacheRead = asFiniteNumber(value.cacheRead);
  const cacheWrite = asFiniteNumber(value.cacheWrite);

  if (input === null || output === null || cacheRead === null || cacheWrite === null) return null;

  if (input < 0 || output < 0 || cacheRead < 0 || cacheWrite < 0) return null;

  return { input, output, cacheRead, cacheWrite };
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
