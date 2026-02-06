export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

type CandidateSource = 'answer_anchor' | 'json_fence' | 'any_fence' | 'balanced' | 'whole_text';

type ParseCandidate = {
  raw: string;
  source: CandidateSource;
  index: number;
  score: number;
};

const JSON_FENCE_RE_GLOBAL = /```json\s*([\s\S]*?)\s*```/gi;
const ANY_FENCE_RE_GLOBAL = /```[a-z0-9_-]*\s*([\s\S]*?)\s*```/gi;
const ANSWER_ANCHOR_RE_GLOBAL = /(?:^|\n)\s*(?:final\s+answer|answer)\s*[:-]\s*/gi;
const ANSWER_ANCHOR_NEAR_RE = /\b(?:final\s+answer|answer)\s*[:-]\s*$/i;
const SCRIPTY_TOKEN_RE = /\b(?:const|let|var|function|return)\b|=>|document\.|window\.|querySelector|JSON\.stringify/;

export function parseAnswerFromText(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { parseStatus: 'no_text', answerJson: null };

  const candidates = collectCandidates(trimmed);
  let firstFailedCandidateRaw = '';

  for (const candidate of candidates) {
    const parsed = tryParseJsonLike(candidate.raw, candidate.source);
    if (parsed.ok) {
      return {
        parseStatus: 'ok',
        answerJson: parsed.value,
        answerJsonRaw: candidate.raw,
      };
    }
    firstFailedCandidateRaw ||= candidate.raw;
  }

  if (candidates.length === 0) return { parseStatus: 'no_json_fence', answerJson: null };
  return { parseStatus: 'json_parse_error', answerJson: null, answerJsonRaw: firstFailedCandidateRaw };
}

function collectCandidates(text: string): ParseCandidate[] {
  const candidates: ParseCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: ParseCandidate) => {
    const raw = candidate.raw.trim();
    if (!raw) return;
    const key = `${candidate.source}|${candidate.index}|${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ ...candidate, raw });
  };

  for (const m of text.matchAll(JSON_FENCE_RE_GLOBAL)) {
    const raw = String(m[1] ?? '').trim();
    if (!raw) continue;
    const index = m.index ?? 0;
    push({
      raw,
      source: 'json_fence',
      index,
      score: 900 + answerAnchorBonus(text, index),
    });
  }

  for (const m of text.matchAll(ANY_FENCE_RE_GLOBAL)) {
    const raw = String(m[1] ?? '').trim();
    if (!raw) continue;
    const index = m.index ?? 0;
    push({
      raw,
      source: 'any_fence',
      index,
      score: 700 + answerAnchorBonus(text, index),
    });
  }

  for (const m of text.matchAll(ANSWER_ANCHOR_RE_GLOBAL)) {
    const start = (m.index ?? 0) + String(m[0] ?? '').length;
    const after = text.slice(start);
    const direct = after.trimStart();
    if (direct.startsWith('{') || direct.startsWith('[')) {
      const literal = extractFirstBalancedJsonLiteral(after);
      if (literal) {
        push({
          raw: literal.raw,
          source: 'answer_anchor',
          index: start + literal.index,
          score: 1000,
        });
      }
    } else {
      const literal = extractFirstBalancedJsonLiteral(after);
      if (literal && literal.index < 200) {
        push({
          raw: literal.raw,
          source: 'answer_anchor',
          index: start + literal.index,
          score: 980,
        });
      }
    }
  }

  const whole = text.trim();
  if (whole.startsWith('{') || whole.startsWith('[')) {
    push({
      raw: whole,
      source: 'whole_text',
      index: 0,
      score: 850,
    });
  }

  for (const literal of extractBalancedJsonLiterals(text)) {
    const anchor = answerAnchorBonus(text, literal.index);
    push({
      raw: literal.raw,
      source: 'balanced',
      index: literal.index,
      score: 500 + anchor,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.index !== a.index) return b.index - a.index;
    return b.raw.length - a.raw.length;
  });
  return candidates;
}

function answerAnchorBonus(text: string, index: number): number {
  const start = Math.max(0, index - 120);
  const near = text.slice(start, index);
  return ANSWER_ANCHOR_NEAR_RE.test(near) ? 120 : 0;
}

function extractFirstBalancedJsonLiteral(text: string): { raw: string; index: number } | null {
  const literals = extractBalancedJsonLiterals(text);
  return literals.length ? literals[0] : null;
}

function extractBalancedJsonLiterals(text: string): Array<{ raw: string; index: number }> {
  const out: Array<{ raw: string; index: number }> = [];
  let inString = false;
  let quote = '';
  let escaped = false;
  let depth = 0;
  let start = -1;
  let startCh = '';

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (depth === 0) {
        start = i;
        startCh = ch;
      }
      depth += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth !== 0) continue;

      const end = i + 1;
      const raw = text.slice(start, end).trim();
      start = -1;
      const seemsObject = startCh === '{';
      if (!raw || raw === '{}' || raw === '[]') continue;
      if (seemsObject && !raw.includes(':')) continue;
      if (raw.length < 4) continue;
      out.push({ raw, index: Math.max(0, end - raw.length) });
    }
  }

  return out;
}

function tryParseJsonLike(raw: string, source: CandidateSource): { ok: true; value: unknown } | { ok: false } {
  const variants = buildParseVariants(raw, source);
  for (const variant of variants) {
    try {
      return { ok: true, value: JSON.parse(variant) as unknown };
    } catch {
      // try next variant
    }
  }
  return { ok: false };
}

function buildParseVariants(raw: string, source: CandidateSource): string[] {
  const trimmed = raw.trim();
  const base = normalizeCommonCharacters(stripTrailingSemicolon(trimmed));
  const variants = new Set<string>();
  variants.add(base);

  const escapedNewlines = escapeRawNewlinesInQuotedStrings(base);
  variants.add(escapedNewlines);
  variants.add(removeTrailingCommas(escapedNewlines));

  if (source === 'answer_anchor' || source === 'whole_text' || source === 'balanced' || source === 'json_fence') {
    if (!SCRIPTY_TOKEN_RE.test(base)) {
      const quotedKeys = quoteBareObjectKeys(removeTrailingCommas(escapedNewlines));
      variants.add(quotedKeys);
      variants.add(removeTrailingCommas(quoteBareObjectKeys(base)));
    }
  }

  return Array.from(variants).filter(Boolean);
}

function stripTrailingSemicolon(value: string): string {
  return value.replace(/;\s*$/, '');
}

function normalizeCommonCharacters(value: string): string {
  return value
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, ' ');
}

function removeTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function escapeRawNewlinesInQuotedStrings(value: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
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

    if (ch === '\n') {
      out += '\\n';
      continue;
    }
    if (ch === '\r') {
      continue;
    }

    out += ch;
  }

  return out;
}

function quoteBareObjectKeys(value: string): string {
  return value.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}
