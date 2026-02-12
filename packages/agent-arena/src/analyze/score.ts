export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';
export type AnswerParseDetail =
  | 'ok'
  | 'no_final_assistant'
  | 'no_text'
  | 'no_anchor'
  | 'anchor_without_json_fence'
  | 'json_empty'
  | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  parseDetail: AnswerParseDetail;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

type AnchorMatch = {
  end: number;
};

const ANSWER_ANCHOR_RE_GLOBAL = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:final\s+answer|answer)(?:\*\*)?\s*[:-]\s*/gi;
const JSON_FENCE_RE = /```json\s*([\s\S]*?)\s*```/i;
const GENERIC_FENCE_RE = /```(?:\w+)?\s*([\s\S]*?)\s*```/i;
const ANSWER_ANCHOR_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?(?:final\s+answer|answer)(?:\*\*)?\s*[:-]/i;
const REASONING_SECTION_RE = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?reasoning(?:\*\*)?\s*[:-]\s*/i;

export function hasAnswerAnchor(text: string): boolean {
  return ANSWER_ANCHOR_RE.test(text);
}

export function parseAnswerFromText(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { parseStatus: 'no_text', parseDetail: 'no_text', answerJson: null };

  const anchor = findLastAnswerAnchor(trimmed);
  if (!anchor) return { parseStatus: 'no_json_fence', parseDetail: 'no_anchor', answerJson: null };

  const tail = trimmed.slice(anchor.end);
  const strictFence = JSON_FENCE_RE.exec(tail);
  if (strictFence) {
    const strictRaw = String(strictFence[1] ?? '').trim();
    if (!strictRaw) return { parseStatus: 'json_parse_error', parseDetail: 'json_empty', answerJson: null };
    const strictParsed = parseJsonWithRepair(strictRaw);
    if (strictParsed.ok) {
      return {
        parseStatus: 'ok',
        parseDetail: 'ok',
        answerJson: strictParsed.value,
        answerJsonRaw: strictRaw,
      };
    }
  }

  const recoveryTail = trimBeforeReasoning(tail);
  const recoveryRaw = extractRecoveryRaw(recoveryTail);
  if (!recoveryRaw) return { parseStatus: 'no_json_fence', parseDetail: 'anchor_without_json_fence', answerJson: null };

  const parsed = parseJsonWithRepair(recoveryRaw);
  if (parsed.ok) {
    return {
      parseStatus: 'ok',
      parseDetail: 'ok',
      answerJson: parsed.value,
      answerJsonRaw: recoveryRaw,
    };
  }
  return {
    parseStatus: 'json_parse_error',
    parseDetail: recoveryRaw.trim() ? 'json_parse_error' : 'json_empty',
    answerJson: null,
    answerJsonRaw: recoveryRaw,
  };
}

function trimBeforeReasoning(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const match = REASONING_SECTION_RE.exec(trimmed);
  if (!match || typeof match.index !== 'number') return trimmed;
  return trimmed.slice(0, match.index).trim();
}

function extractRecoveryRaw(tail: string): string | null {
  const trimmed = tail.trim();
  if (!trimmed) return null;

  const genericFence = GENERIC_FENCE_RE.exec(trimmed);
  if (genericFence) {
    const fenced = String(genericFence[1] ?? '').trim();
    if (fenced) return fenced;
  }

  return extractFirstJsonValue(trimmed);
}

function extractFirstJsonValue(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed) return null;

  const first = trimmed[0];
  if (first === '{' || first === '[') {
    const end = findCompositeJsonEnd(trimmed);
    if (end !== null) return trimmed.slice(0, end).trim();
    return null;
  }

  if (first === '"') {
    const end = findStringLiteralEnd(trimmed);
    if (end !== null) return trimmed.slice(0, end).trim();
    return null;
  }

  const scalar = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(trimmed);
  if (scalar) return scalar[0];

  return null;
}

function findCompositeJsonEnd(text: string): number | null {
  const stack: string[] = [];
  const first = text[0];
  if (first === '{') stack.push('}');
  else if (first === '[') stack.push(']');
  else return null;

  let inString = false;
  let escaped = false;

  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push('}');
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      const expected = stack.pop();
      if (expected !== ch) return null;
      if (!stack.length) return i + 1;
    }
  }

  return null;
}

function findStringLiteralEnd(text: string): number | null {
  let escaped = false;
  for (let i = 1; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') return i + 1;
  }
  return null;
}

function parseJsonWithRepair(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    const repaired = repairRawNewlinesInStrings(raw);
    if (repaired !== raw) {
      try {
        return { ok: true, value: JSON.parse(repaired) as unknown };
      } catch {
        // fall through
      }
    }
    return { ok: false };
  }
}

function repairRawNewlinesInStrings(raw: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  let changed = false;
  let collapseWhitespaceAfterLinebreak = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (collapseWhitespaceAfterLinebreak) {
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
          changed = true;
          continue;
        }
        collapseWhitespaceAfterLinebreak = false;
      }
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        if (!out.endsWith(' ')) out += ' ';
        changed = true;
        collapseWhitespaceAfterLinebreak = true;
        continue;
      }
      out += ch;
      continue;
    }

    if (ch === '"') inString = true;
    out += ch;
  }

  return changed ? out : raw;
}

function findLastAnswerAnchor(text: string): AnchorMatch | null {
  const matches = Array.from(text.matchAll(ANSWER_ANCHOR_RE_GLOBAL));
  if (!matches.length) return null;

  const match = matches[matches.length - 1];
  const start = match.index ?? 0;
  const end = start + String(match[0] ?? '').length;
  return { end };
}
