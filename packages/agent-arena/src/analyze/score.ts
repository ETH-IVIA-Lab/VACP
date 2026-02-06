export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ParsedAnswer = {
  parseStatus: AnswerParseStatus;
  answerJson: unknown | null;
  answerJsonRaw?: string;
};

export type ReflectionProvenance = 'interaction-derived' | 'prior-knowledge/guess';
export type ReflectionConfidence = 'low' | 'medium' | 'high';
export type ReflectionRobustness = 'robust' | 'brittle';

export type StructuredReflection = {
  provenance: ReflectionProvenance | null;
  confidence: ReflectionConfidence | null;
  easyHardWhy: string | null;
  processRobustness: ReflectionRobustness | null;
  actionsToolsAvailableVsUsedWhy: string | null;
};

export type StructuredReflectionParseStatus =
  | 'ok'
  | 'no_final_assistant'
  | 'no_text'
  | 'no_structured_reflection'
  | 'no_json_fence'
  | 'json_parse_error'
  | 'invalid_shape';

export type ParsedStructuredReflection = {
  parseStatus: StructuredReflectionParseStatus;
  reflection: StructuredReflection | null;
  reflectionRaw?: string;
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
const REFLECTION_STRUCTURED_ANCHOR_RE_GLOBAL =
  /(?:^|\n)\s*(?:#+\s*)?reflection\s*(?:\(\s*structured\s*\)|structured)\s*[:-]\s*/gi;
const SCRIPTY_TOKEN_RE = /\b(?:const|let|var|function|return)\b|=>|document\.|window\.|querySelector|JSON\.stringify/;

export function parseAnswerFromText(text: string): ParsedAnswer {
  const trimmed = text.trim();
  if (!trimmed) return { parseStatus: 'no_text', answerJson: null };

  const answerAnchors = [...trimmed.matchAll(ANSWER_ANCHOR_RE_GLOBAL)];
  const candidates = answerAnchors.length > 0 ? collectCandidates(trimmed) : collectStrictAnswerCandidates(trimmed);
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

export function parseStructuredReflectionFromText(text: string): ParsedStructuredReflection {
  const trimmed = text.trim();
  if (!trimmed) return { parseStatus: 'no_text', reflection: null };

  const anchors = [...trimmed.matchAll(REFLECTION_STRUCTURED_ANCHOR_RE_GLOBAL)];
  if (anchors.length === 0) {
    const loose = parseLooseStructuredReflection(trimmed);
    if (loose) return { parseStatus: 'ok', reflection: loose };
    return { parseStatus: 'no_structured_reflection', reflection: null };
  }

  let bestFailure: ParsedStructuredReflection | null = null;
  for (let i = anchors.length - 1; i >= 0; i -= 1) {
    const anchor = anchors[i];
    const start = (anchor.index ?? 0) + String(anchor[0] ?? '').length;
    const seg = trimmed.slice(start);
    const parsed = parseStructuredReflectionSegment(seg);
    if (parsed.parseStatus === 'ok') return parsed;
    if (!bestFailure) bestFailure = parsed;
    else bestFailure = preferFailure(bestFailure, parsed);
  }

  const loose = parseLooseStructuredReflection(trimmed);
  if (loose) return { parseStatus: 'ok', reflection: loose };

  return bestFailure ?? { parseStatus: 'no_json_fence', reflection: null };
}

function parseStructuredReflectionSegment(segment: string): ParsedStructuredReflection {
  const candidates = collectCandidates(segment);
  if (!candidates.length) return { parseStatus: 'no_json_fence', reflection: null };

  let firstFailedRaw = '';
  let sawInvalidShape = false;

  for (const candidate of candidates) {
    const parsed = tryParseJsonLike(candidate.raw, candidate.source);
    if (!parsed.ok) {
      firstFailedRaw ||= candidate.raw;
      continue;
    }

    const normalized = normalizeStructuredReflection(parsed.value);
    if (normalized) {
      return {
        parseStatus: 'ok',
        reflection: normalized,
        reflectionRaw: candidate.raw,
      };
    }
    sawInvalidShape = true;
    firstFailedRaw ||= candidate.raw;
  }

  if (sawInvalidShape) return { parseStatus: 'invalid_shape', reflection: null, reflectionRaw: firstFailedRaw };
  return { parseStatus: 'json_parse_error', reflection: null, reflectionRaw: firstFailedRaw };
}

function preferFailure(a: ParsedStructuredReflection, b: ParsedStructuredReflection): ParsedStructuredReflection {
  const order: Record<StructuredReflectionParseStatus, number> = {
    ok: 99,
    no_final_assistant: 0,
    no_text: 1,
    no_structured_reflection: 2,
    no_json_fence: 3,
    json_parse_error: 4,
    invalid_shape: 5,
  };
  return (order[b.parseStatus] ?? -1) > (order[a.parseStatus] ?? -1) ? b : a;
}

function normalizeStructuredReflection(value: unknown): StructuredReflection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const nested = findNestedReflectionObject(obj);
  const root = nested ?? obj;

  const provenance = normalizeProvenance(pickString(root, ['provenance', 'data_provenance', 'dataProvenance']));
  const confidence = normalizeConfidence(pickString(root, ['confidence', 'certainty']));
  const easyHardWhy = normalizeFreeText(
    pickString(root, ['easy_hard_why', 'easyHardWhy', 'difficulty', 'difficulty_notes', 'what_was_easy_hard']),
  );
  const processRobustness = normalizeRobustness(
    pickString(root, ['process_robustness', 'processRobustness', 'robustness']),
  );
  const actionsToolsAvailableVsUsedWhy = normalizeFreeText(
    pickString(root, [
      'actions_tools_available_vs_used_why',
      'actionsToolsAvailableVsUsedWhy',
      'actions_tools',
      'tool_choice',
      'tools_used_why',
      'tools',
    ]),
  );

  if (!provenance && !confidence && !easyHardWhy && !processRobustness && !actionsToolsAvailableVsUsedWhy) return null;

  return {
    provenance,
    confidence,
    easyHardWhy,
    processRobustness,
    actionsToolsAvailableVsUsedWhy,
  };
}

function findNestedReflectionObject(obj: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['reflection', 'reflection_structured', 'structured_reflection']) {
    const v = obj[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  }
  return null;
}

function parseLooseStructuredReflection(text: string): StructuredReflection | null {
  const provenance = normalizeProvenance(matchGroup(text, /\bProvenance:\s*([^\n\r]+)/i));
  const confidence = normalizeConfidence(matchGroup(text, /\bconfidence:\s*([^\n\r]+)/i));
  const processRobustness = normalizeRobustness(
    matchGroup(text, /\b(?:process\s+)?(?:robustness|robust|brittle):\s*([^\n\r]+)/i) ??
      matchGroup(text, /\b(process[^.\n\r]{0,80}\b(?:robust|brittle)\b[^.\n\r]*)/i),
  );
  const easyHardWhy = normalizeFreeText(
    matchGroup(text, /\b(?:easy\/hard|easy_hard_why|difficulty):\s*([^\n\r]+)/i) ??
      matchGroup(text, /\b([^.\n\r]{0,120}\b(?:easy|hard)\b[^.\n\r]{0,120})/i),
  );
  const actionsToolsAvailableVsUsedWhy = normalizeFreeText(
    matchGroup(text, /\b(?:actions[_\s-]*tools[_\s-]*available[_\s-]*vs[_\s-]*used[_\s-]*why|tools(?:\s+used)?):\s*([^\n\r]+)/i),
  );

  if (!provenance && !confidence && !processRobustness) return null;
  return {
    provenance,
    confidence,
    easyHardWhy,
    processRobustness,
    actionsToolsAvailableVsUsedWhy,
  };
}

function matchGroup(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const v = String(m[1] ?? '').trim();
  return v || null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function normalizeProvenance(value: string | null): ReflectionProvenance | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('interaction')) return 'interaction-derived';
  if (v.includes('prior') || v.includes('guess')) return 'prior-knowledge/guess';
  return null;
}

function normalizeConfidence(value: string | null): ReflectionConfidence | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('low')) return 'low';
  if (v.includes('medium')) return 'medium';
  if (v.includes('high')) return 'high';
  return null;
}

function normalizeRobustness(value: string | null): ReflectionRobustness | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('robust')) return 'robust';
  if (v.includes('brittle')) return 'brittle';
  return null;
}

function normalizeFreeText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
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

  sortCandidates(candidates);
  return candidates;
}

function collectStrictAnswerCandidates(text: string): ParseCandidate[] {
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
      score: 900 + tailBonus(text, index),
    });
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

  const tailStart = Math.max(0, text.length - 800);
  for (const literal of extractBalancedJsonLiterals(text)) {
    if (literal.index < tailStart) continue;
    if (SCRIPTY_TOKEN_RE.test(literal.raw)) continue;
    push({
      raw: literal.raw,
      source: 'balanced',
      index: literal.index,
      score: 560 + tailBonus(text, literal.index),
    });
  }

  sortCandidates(candidates);
  return candidates;
}

function sortCandidates(candidates: ParseCandidate[]) {
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.index !== a.index) return b.index - a.index;
    return b.raw.length - a.raw.length;
  });
}

function tailBonus(text: string, index: number) {
  const distance = Math.max(0, text.length - index);
  if (distance <= 140) return 140;
  if (distance <= 400) return 60;
  if (distance <= 800) return 20;
  return 0;
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
