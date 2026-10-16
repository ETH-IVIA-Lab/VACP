import assert from 'node:assert/strict';
import test from 'node:test';
import { placeBubble, targetBounds } from '../src/bubble-layout';

const viewport = { width: 1440, height: 900 };
type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

test('a label settles beside its target, clear of it and on screen', () => {
  const target = targetBounds({ kind: 'region', x: 400, y: 300, width: 300, height: 240 });
  const placed = placeBubble(target, { x: 550, y: 420 }, { width: 260, height: 60 }, viewport);
  assert.equal(overlaps(placed, target), false);
  const cramped = placeBubble(target, { x: 550, y: 420 }, { width: 260, height: 60 }, { width: 720, height: 900 });
  assert.ok(inside(cramped, { x: 12, y: 12, width: 720 - 24, height: 900 - 24 }));
});

test('words that grow the label never move it while its side still fits', () => {
  const target = targetBounds({ kind: 'region', x: 400, y: 300, width: 300, height: 240 });
  const anchor = { x: 550, y: 420 };
  const short = placeBubble(target, anchor, { width: 260, height: 60 }, viewport);
  const taller = placeBubble(target, anchor, { width: 260, height: 100 }, viewport, short);
  assert.equal(taller.side, short.side);
  assert.deepEqual({ x: taller.x, y: taller.y }, { x: short.x, y: short.y });
});

test('a label keeps its side as its cursor moves, and grows upward only when nothing else fits', () => {
  const cursor = (x: number, y: number) => ({ x: x - 12, y: y - 12, width: 24, height: 24 });
  const first = placeBubble(cursor(700, 300), { x: 700, y: 300 }, { width: 260, height: 60 }, viewport);
  assert.notEqual(first.side, 'above');
  const moved = placeBubble(cursor(760, 340), { x: 760, y: 340 }, { width: 260, height: 60 }, viewport, first);
  assert.equal(moved.side, first.side);
  // Against the bottom right corner, only the space above the target is free.
  const corner = { x: 1080, y: 500, width: 348, height: 388 };
  const pressed = placeBubble(corner, { x: 1250, y: 700 }, { width: 260, height: 80 }, viewport);
  assert.equal(overlaps(pressed, corner), false);
});

test('a new target settles on the side nearest its cursor, whatever side the previous target used', () => {
  const size = { width: 287, height: 110 };
  // A conclusion without geometry near the bottom of the page settles below its cursor.
  const conclusion = placeBubble({ x: 876, y: 175, width: 24, height: 24 }, { x: 888, y: 187 }, size, {
    width: 1440,
    height: 1000,
  });
  const brush = { x: 887, y: 185, width: 54, height: 212 };
  const step = placeBubble(
    brush,
    { x: 888, y: 187 },
    size,
    { width: 1440, height: 1000 },
    { ...conclusion, side: 'below' },
  );
  assert.equal(overlaps(step, brush), false);
  const gap =
    Math.max(step.x - 888, 0, 888 - step.x - step.width) + Math.max(step.y - 187, 0, 187 - step.y - step.height);
  assert.ok(gap <= 48, `label ${gap}px from its cursor`);
});
