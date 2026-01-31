import fs from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import type { ArenaAnalysisMeta } from './load-analysis.js';

export type ScenarioDef = {
  id: string;
  route: string;
  hash: string | null;
  task: string;
  responseFormat: string;
  tags: string[];
};

export type LoadedScenarioDefs = {
  sourcePath: string;
  defs: ScenarioDef[];
};

export async function loadScenarioDefs(meta: ArenaAnalysisMeta | null): Promise<LoadedScenarioDefs | null> {
  const candidates: string[] = [];
  if (typeof meta?.scenariosPath === 'string' && meta.scenariosPath.trim()) candidates.push(meta.scenariosPath.trim());
  if (typeof meta?.configPath === 'string' && meta.configPath.trim()) {
    const baseDir = path.dirname(meta.configPath.trim());
    candidates.push(path.join(baseDir, 'agent-arena.scenarios.ts'));
    candidates.push(path.join(baseDir, 'agent-arena.scenarios.js'));
  }

  const jiti = createJiti(import.meta.url, { interopDefault: true });
  for (const raw of candidates) {
    const sourcePath = path.resolve(raw);
    if (!(await fileExists(sourcePath))) continue;

    let mod: any;
    try {
      mod = await jiti.import(sourcePath);
    } catch {
      continue;
    }

    const bases = (mod as any)?.SCENARIO_BASES;
    if (!Array.isArray(bases)) continue;

    const defs = bases
      .map((s: any) => {
        const id = typeof s?.id === 'string' ? s.id : '';
        const route = typeof s?.route === 'string' ? s.route : '';
        const hash = typeof s?.hash === 'string' ? s.hash : null;
        const task = typeof s?.task === 'string' ? s.task : '';
        const responseFormat = typeof s?.responseFormat === 'string' ? s.responseFormat : '';
        const tags = Array.isArray(s?.tags) ? s.tags.filter((t: unknown) => typeof t === 'string') : [];
        return { id, route, hash, task, responseFormat, tags } satisfies ScenarioDef;
      })
      .filter((d: ScenarioDef) => Boolean(d.id));

    if (defs.length) return { sourcePath, defs };
  }

  return null;
}

async function fileExists(filePath: string) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}
