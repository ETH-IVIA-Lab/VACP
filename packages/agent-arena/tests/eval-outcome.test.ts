import assert from 'node:assert/strict';
import { classifyEvalOutcome, detectPlumbingFailure } from '../src/eval/outcome.ts';

function main() {
  const timeoutPrecedence = detectPlumbingFailure({
    ok: false,
    runErrorMessage: 'session.prompt timed out after 600000ms',
    hasAssistantError: true,
  });
  assert.equal(timeoutPrecedence, 'session_prompt_timeout');

  const assistantError = detectPlumbingFailure({
    ok: true,
    runErrorMessage: null,
    hasAssistantError: true,
  });
  assert.equal(assistantError, 'assistant_api_error');

  const questionPending = detectPlumbingFailure({
    ok: true,
    runErrorMessage: null,
    hasQuestionPending: true,
  });
  assert.equal(questionPending, 'question_pending');

  const permissionDenied = detectPlumbingFailure({
    ok: true,
    runErrorMessage: null,
    hasPermissionRuleDenied: true,
  });
  assert.equal(permissionDenied, 'permission_rule_denied');

  const noPlumbing = detectPlumbingFailure({
    ok: true,
    runErrorMessage: null,
  });
  assert.equal(noPlumbing, null);

  const outcome = classifyEvalOutcome({
    plumbingOk: false,
    parseStatus: 'ok',
    hasJudge: true,
    solvedStrict: true,
    solvedSemantic: true,
  });
  assert.equal(outcome, 'plumbing_failure');

  console.log('eval-outcome: ok');
}

main();
