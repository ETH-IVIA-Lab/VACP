import type { NormalizedRun } from '../stats.js';

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
