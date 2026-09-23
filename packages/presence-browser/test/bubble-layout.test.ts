import assert from 'node:assert/strict';
import test from 'node:test';
import { crossesTarget, placeBubble, pushOut, targetBounds } from '../src/bubble-layout';

const viewport = { width: 1440, height: 900 };
const size = { width: 260, height: 60 };

type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

test('a settled label sits clear of the target, keeps its side across revisits, and stays on screen', () => {
  const target = targetBounds({ kind: 'region', x: 400, y: 300, width: 300, height: 240 });
  const anchor = { x: 550, y: 420 };
  const first = placeBubble(target, anchor, size, viewport);
  assert.equal(overlaps(first, target), false);
  const moved = placeBubble(target, { x: 560, y: 430 }, size, viewport, first);
  assert.equal(moved.side, first.side);
  const cramped = placeBubble(target, anchor, size, { width: 720, height: 900 }, first);
  assert.ok(inside(cramped, { x: 12, y: 12, width: 720 - 24, height: 900 - 24 }));
});

test('a riding label is pushed off the region ahead by the shortest shift that stays on screen', () => {
  const within = { x: 12, y: 12, width: 1416, height: 876 };
  const region = { x: 400, y: 300, width: 300, height: 240 };
  const clear = { x: 100, y: 100, ...size };
  assert.deepEqual(pushOut(clear, region, within), clear);
  const below = pushOut({ x: 420, y: 500, ...size }, region, within);
  assert.equal(below.y, region.y + region.height + 8);
  const corner = { x: 20, y: 700, width: 300, height: 160 };
  const nearBottom = pushOut({ x: 30, y: 820, ...size }, corner, within);
  assert.equal(overlaps(nearBottom, corner), false);
  assert.ok(inside(nearBottom, within));
});

test('movement across the target is detected from the swept box', () => {
  const target = { x: 400, y: 300, width: 300, height: 240 };
  assert.equal(crossesTarget({ x: 100, y: 100, ...size }, { x: 800, y: 600, ...size }, target), true);
  assert.equal(crossesTarget({ x: 100, y: 100, ...size }, { x: 100, y: 180, ...size }, target), false);
});
