import assert from 'node:assert/strict';
import { hasAnswerAnchor, parseAnswerFromText } from '../src/analyze/score.ts';

function main() {
  const plain = parseAnswerFromText(['Answer:', '```json', '{"value": 7}', '```'].join('\n'));
  assert.equal(plain.parseStatus, 'ok');
  assert.equal(plain.parseDetail, 'ok');
  assert.deepEqual(plain.answerJson, { value: 7 });

  const heading = parseAnswerFromText(['## Answer:', '```json', '{"value": 9}', '```'].join('\n'));
  assert.equal(heading.parseStatus, 'ok');
  assert.equal(heading.parseDetail, 'ok');
  assert.deepEqual(heading.answerJson, { value: 9 });
  assert.equal(hasAnswerAnchor('## Answer:\n```json\n{"value": 9}\n```'), true);

  const unfencedObject = parseAnswerFromText('Answer:\n{"value": 11}');
  assert.equal(unfencedObject.parseStatus, 'ok');
  assert.equal(unfencedObject.parseDetail, 'ok');
  assert.deepEqual(unfencedObject.answerJson, { value: 11 });

  const unfencedNull = parseAnswerFromText(['Answer:', 'null', '', 'Reasoning:', 'blocked'].join('\n'));
  assert.equal(unfencedNull.parseStatus, 'ok');
  assert.equal(unfencedNull.parseDetail, 'ok');
  assert.equal(unfencedNull.answerJson, null);

  const noAnchor = parseAnswerFromText('```json\n{"value": 1}\n```');
  assert.equal(noAnchor.parseStatus, 'no_json_fence');
  assert.equal(noAnchor.parseDetail, 'no_anchor');

  const anchorNoFence = parseAnswerFromText('Answer:\nNot sure');
  assert.equal(anchorNoFence.parseStatus, 'no_json_fence');
  assert.equal(anchorNoFence.parseDetail, 'anchor_without_json_fence');

  const invalid = parseAnswerFromText(['### Final Answer:', '```json', '{"value": }', '```'].join('\n'));
  assert.equal(invalid.parseStatus, 'json_parse_error');
  assert.equal(invalid.parseDetail, 'json_parse_error');

  const repaired = parseAnswerFromText(
    ['Final Answer:', '```json', '{"countries":["North', ' Korea"]}', '```', 'Reasoning:', 'omitted'].join('\n'),
  );

  assert.equal(repaired.parseStatus, 'ok');
  assert.equal(repaired.parseDetail, 'ok');
  assert.deepEqual(repaired.answerJson, { countries: ['North Korea'] });

  const empty = parseAnswerFromText('');
  assert.equal(empty.parseStatus, 'no_text');
  assert.equal(empty.parseDetail, 'no_text');

  console.log('score-parse: ok');
}

main();
