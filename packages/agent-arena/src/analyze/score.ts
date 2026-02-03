export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

const JSON_FENCE_RE = /```json\s*([\s\S]*?)\s*```/i;
const ANY_FENCE_RE = /```[a-z0-9_-]*\s*([\s\S]*?)\s*```/i;

export function parseAnswerFromText(text: string): ParsedAnswer {
  if (!text.trim()) return { parseStatus: 'no_text', answerJson: null };

  const m = findLastMatch(JSON_FENCE_RE, text) ?? findLastMatch(ANY_FENCE_RE, text);
  const raw = m?.[1]?.trim() ?? '';

  if (!raw) return { parseStatus: 'no_json_fence', answerJson: null };
  try {
    return { parseStatus: 'ok', answerJson: JSON.parse(raw), answerJsonRaw: raw };
  } catch {
    if (!m) return { parseStatus: 'no_json_fence', answerJson: null };
    return { parseStatus: 'json_parse_error', answerJson: null, answerJsonRaw: raw };
  }
}

function findLastMatch(re: RegExp, text: string): RegExpExecArray | null {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const rx = new RegExp(re.source, flags);
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(rx)) last = m as RegExpExecArray;
  return last;
}
