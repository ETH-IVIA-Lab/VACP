import type { NormalizedRun } from '../stats.js';

export type SolvedEvidenceClass = 'interaction' | 'workaround';

export type SolvedEvidenceBasis =
  | 'self-reported interaction-derived'
  | 'self-reported prior-knowledge/guess'
  | 'inferred interaction from vacp_execute'
  | 'unknown provenance';

export function classifySolvedEvidence(run: NormalizedRun): {
  classification: SolvedEvidenceClass;
  basis: SolvedEvidenceBasis;
} {
  if (run.reflectionProvenance === 'interaction-derived') {
    return {
      classification: 'interaction',
      basis: 'self-reported interaction-derived',
    };
  }

  if (run.reflectionProvenance === 'prior-knowledge/guess') {
    return {
      classification: 'workaround',
      basis: 'self-reported prior-knowledge/guess',
    };
  }

  if (run.hasVacpExecuteTool === true) {
    return {
      classification: 'interaction',
      basis: 'inferred interaction from vacp_execute',
    };
  }

  return {
    classification: 'workaround',
    basis: 'unknown provenance',
  };
}

export function buildTrajectorySnippet(run: NormalizedRun): string | null {
  const parts: string[] = [];
  if (run.reflectionActionsToolsAvailableVsUsedWhy) {
    parts.push(`tools: ${cleanText(run.reflectionActionsToolsAvailableVsUsedWhy)}`);
  }
  if (run.reflectionEasyHardWhy) {
    parts.push(`difficulty: ${cleanText(run.reflectionEasyHardWhy)}`);
  }
  if (!parts.length) return null;
  const model = `${run.modelProvider}/${run.modelName}`;
  return `${model}: ${truncate(parts.join(' | '), 260)}`;
}

export function buildFailureSnippet(run: NormalizedRun): string | null {
  const reason = run.runErrorMessage ?? run.plumbingFailure ?? run.answerParseStatus;
  if (!reason) return null;
  const model = `${run.modelProvider}/${run.modelName}`;
  return `${model}: ${truncate(cleanText(reason), 220)}`;
}

export function pushUniqueBounded(list: string[], value: string | null, max: number) {
  if (!value) return;
  if (list.includes(value)) return;
  if (list.length >= max) return;
  list.push(value);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}
