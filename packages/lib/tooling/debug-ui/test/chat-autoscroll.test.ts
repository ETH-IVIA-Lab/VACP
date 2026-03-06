import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldStickToBottom } from '../src/overlay/modules/chat/use-chat-autoscroll';

test('shouldStickToBottom disables stickiness on manual upward scroll away from bottom', () => {
  assert.equal(
    shouldStickToBottom({
      distanceFromBottom: 24,
      currentTop: 980,
      lastTop: 1000,
    }),
    false,
  );
});

test('shouldStickToBottom remains sticky near the bottom when not scrolling upward', () => {
  assert.equal(
    shouldStickToBottom({
      distanceFromBottom: 24,
      currentTop: 1000,
      lastTop: 1000,
    }),
    true,
  );
});
