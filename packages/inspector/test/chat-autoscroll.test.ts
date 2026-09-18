import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollTopForBottom, shouldStickToBottom } from '../src/overlay/modules/chat/use-chat-autoscroll';

test('scrollTopForBottom clamps to zero when content fits within the viewport', () => {
  assert.equal(
    scrollTopForBottom({
      scrollHeight: 320,
      clientHeight: 480,
    }),
    0,
  );
});

test('scrollTopForBottom returns the exact bottom offset when content overflows', () => {
  assert.equal(
    scrollTopForBottom({
      scrollHeight: 1125,
      clientHeight: 140,
    }),
    985,
  );
});

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
