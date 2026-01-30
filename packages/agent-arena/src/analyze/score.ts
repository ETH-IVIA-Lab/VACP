export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

const JSON_FENCE_RE = /```json\s*([\s\S]*?)\s*```/i;

export function parseAnswerFromText(text: string): ParsedAnswer {
  if (!text.trim()) return { parseStatus: 'no_text', answerJson: null };
  const m = JSON_FENCE_RE.exec(text);
  if (!m) return { parseStatus: 'no_json_fence', answerJson: null };
  const raw = m[1].trim();
  if (!raw) return { parseStatus: 'json_parse_error', answerJson: null, answerJsonRaw: raw };
  try {
    return { parseStatus: 'ok', answerJson: JSON.parse(raw), answerJsonRaw: raw };
  } catch {
    return { parseStatus: 'json_parse_error', answerJson: null, answerJsonRaw: raw };
  }
}
