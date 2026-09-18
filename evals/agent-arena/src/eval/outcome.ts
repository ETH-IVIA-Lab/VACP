export type EvalOutcome =
  | 'plumbing_failure'
  | 'protocol_failure'
  | 'eval_error'
  | 'unscored'
  | 'semantic_failure'
  | 'solved_semantic'
  | 'solved_strict';

export type PlumbingFailure =
  | 'err_connection_refused'
  | 'chrome_webdata'
  | 'assistant_api_error'
  | 'question_pending'
  | 'permission_rule_denied'
  | 'session_prompt_timeout'
  | 'session_create_timeout'
  | 'session_prompt_async_timeout'
  | 'timeout'
  | 'econnrefused'
  | 'run_error'
  | 'run_failed';

export function detectPlumbingFailure(args: {
  ok: boolean;
  runErrorMessage: string | null;
  hasAssistantError?: boolean;
  hasQuestionPending?: boolean;
  hasPermissionRuleDenied?: boolean;
  hasErrConnectionRefused?: boolean;
  hasChromeWebdata?: boolean;
}): PlumbingFailure | null {
  if (args.hasErrConnectionRefused) return 'err_connection_refused';

  if (args.hasChromeWebdata) return 'chrome_webdata';

  if (!args.ok) {
    const msg = (args.runErrorMessage ?? '').toLowerCase();

    if (msg.includes('session.prompt timed out')) return 'session_prompt_timeout';

    if (msg.includes('session.create timed out')) return 'session_create_timeout';

    if (msg.includes('session.promptasync timed out')) return 'session_prompt_async_timeout';

    if (msg.includes('timed out')) return 'timeout';

    if (msg.includes('econnrefused')) return 'econnrefused';

    return args.runErrorMessage ? 'run_error' : 'run_failed';
  }

  if (args.hasQuestionPending) return 'question_pending';

  if (args.hasPermissionRuleDenied) return 'permission_rule_denied';

  if (args.hasAssistantError) return 'assistant_api_error';

  return null;
}

export function classifyEvalOutcome(args: {
  plumbingOk: boolean;
  parseStatus: string;
  hasJudge: boolean;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
}): EvalOutcome {
  if (!args.plumbingOk) return 'plumbing_failure';

  if (args.parseStatus !== 'ok') return 'protocol_failure';

  if (!args.hasJudge) return 'unscored';

  if (args.solvedStrict === true) return 'solved_strict';

  if (args.solvedSemantic === true) return 'solved_semantic';

  if (args.solvedStrict === null && args.solvedSemantic === null) return 'eval_error';

  return 'semantic_failure';
}

export function deriveEvalOutcome(args: {
  ok: boolean;
  plumbingOk: boolean | null;
  parseStatus: string | null;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
}): EvalOutcome {
  if (args.plumbingOk === false || args.ok === false) return 'plumbing_failure';

  if (args.parseStatus && args.parseStatus !== 'ok') return 'protocol_failure';

  if (typeof args.solvedStrict === 'boolean') return args.solvedStrict ? 'solved_strict' : 'semantic_failure';

  if (typeof args.solvedSemantic === 'boolean') return args.solvedSemantic ? 'solved_semantic' : 'semantic_failure';

  return 'unscored';
}

export function isParseOk(parseStatus: string | null): boolean | null {
  if (!parseStatus) return null;

  return parseStatus === 'ok';
}

export function isGradeable(args: {
  plumbingOk: boolean | null;
  parseStatus: string | null;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
}): boolean {
  if (args.plumbingOk !== true) return false;

  if (args.parseStatus !== 'ok') return false;

  return typeof args.solvedStrict === 'boolean' || typeof args.solvedSemantic === 'boolean';
}
