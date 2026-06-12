import type { NormalizedRun } from '../stats.js';

export type SolvedEvidenceClass = 'observed-vacp-execute' | 'no-vacp-execute-signal';

export type SolvedEvidenceBasis = 'observed vacp_execute' | 'no vacp_execute signal';

export function classifySolvedEvidence(run: NormalizedRun): {
  classification: SolvedEvidenceClass;
  basis: SolvedEvidenceBasis;
} {
  if (run.hasVacpExecuteTool === true) {
    return {
      classification: 'observed-vacp-execute',
      basis: 'observed vacp_execute',
    };
  }

  return {
    classification: 'no-vacp-execute-signal',
    basis: 'no vacp_execute signal',
  };
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
  return `${value.slice(0, maxChars - 1)}...`;
}
