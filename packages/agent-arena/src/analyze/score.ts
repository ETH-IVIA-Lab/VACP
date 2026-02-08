export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

type AnchorMatch = {
  end: number;
};

const ANSWER_ANCHOR_RE_GLOBAL = /(?:^|\n)\s*(?:final\s+answer|answer)\s*[:-]\s*/gi;
const JSON_FENCE_RE = /```json\s*([\s\S]*?)\s*```/i;

export function hasAnswerAnchor(text: string): boolean {
  return /(?:^|\n)\s*(?:final\s+answer|answer)\s*[:-]/i.test(text);
}

export function parseAnswerFromText(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { parseStatus: 'no_text', answerJson: null };

  const anchor = findLastAnswerAnchor(trimmed);
  if (!anchor) return { parseStatus: 'no_json_fence', answerJson: null };

  const tail = trimmed.slice(anchor.end);
  const fence = JSON_FENCE_RE.exec(tail);
  if (!fence) return { parseStatus: 'no_json_fence', answerJson: null };

  const raw = String(fence[1] ?? '').trim();
  if (!raw) return { parseStatus: 'json_parse_error', answerJson: null };

  try {
    return {
      parseStatus: 'ok',
      answerJson: JSON.parse(raw) as unknown,
      answerJsonRaw: raw,
    };
  } catch {
    return { parseStatus: 'json_parse_error', answerJson: null, answerJsonRaw: raw };
  }
}

function findLastAnswerAnchor(text: string): AnchorMatch | null {
  const matches = Array.from(text.matchAll(ANSWER_ANCHOR_RE_GLOBAL));
  if (!matches.length) return null;

  const match = matches[matches.length - 1];
  const start = match.index ?? 0;
  const end = start + String(match[0] ?? '').length;
  return { end };
}
