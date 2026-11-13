import assert from 'node:assert/strict';
import test from 'node:test';
import { placeBubble, ride, targetBounds, type BubblePlacement, type Departure } from '../src/bubble-layout';

const viewport = { width: 1440, height: 900 };
type Rect = { x: number; y: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Rect, b: Rect) =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
/** A full-width row of a list, and the cursor in its middle. */
const row = (y: number) => ({ x: 0, y, width: 1440, height: 48 });
const at = (target: Rect) => ({ x: 720, y: target.y + 24 });
const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/**
 * The most of `target` the label covers on the ride `ride` paints. A flight that starts from standstill
 * moves the cursor in a straight line.
 */
const covers = (departure: Required<Departure>, rest: BubblePlacement, target: Rect, view = viewport) =>
  Math.max(
    ...Array.from({ length: 1001 }, (_, step) => {
      const t = step / 1000;
      const cursor = {
        x: departure.from.x + (rest.anchor.x - departure.from.x) * t,
        y: departure.from.y + (rest.anchor.y - departure.from.y) * t,
      };
      return area({ ...ride(departure, cursor, rest, view), width: rest.width, height: rest.height }, target);
    }),
  );
/** A tall viewport, a target spanning most of it, and the cursor near its bottom edge. */
const page = { width: 1440, height: 1600 };
const tall = { x: 0, y: 160, width: 1440, height: 1100 };
const bottom = { x: 720, y: 1240 };
/** The label of a cursor that travels from the top of the page down to `bottom`. */
const descend = (size: { width: number; height: number }) => {
  const start = placeBubble({ x: 708, y: 28, width: 24, height: 24 }, { x: 720, y: 40 }, size, page);
  const departure = { from: { x: 720, y: 40 }, label: start };
  return { departure, rest: placeBubble(tall, bottom, size, page, start, departure) };
};

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

test('a cursor stepping along a list of full-width rows never carries its label across the next row', () => {
  const size = { width: 260, height: 110 };
  const step = (from: Rect, to: Rect, rest = placeBubble(from, at(from), size, viewport)) => {
    const departure = { from: at(from), label: rest };
    const placed = placeBubble(to, at(to), size, viewport, rest, departure);
    assert.equal(covers(departure, placed, to), 0, `from the row at ${from.y} to the row at ${to.y}`);
    return placed;
  };
  const middle = row(420);
  const down = step(row(100), middle);
  assert.ok(down.y + down.height <= middle.y, 'stepping down, the label rests above the row');
  const up = step(row(700), middle);
  assert.ok(up.y >= middle.y + middle.height, 'stepping up, the label rests below the row');
  // Without room above the first row, the label rests below it.
  const first = row(24);
  const top = step(middle, first, down);
  assert.ok(top.y >= first.y + first.height);
});

test('a row that moves a little keeps its label on its side, and a long step leaves a side that would cross', () => {
  const size = { width: 260, height: 110 };
  const step = (rest: BubblePlacement, to: Rect) => {
    const departure = { from: rest.anchor, label: rest };
    const placed = placeBubble(to, at(to), size, viewport, rest, departure);
    assert.equal(covers(departure, placed, to), 0, `to the row at ${to.y}`);
    return placed;
  };
  const above = step(placeBubble(row(100), at(row(100)), size, viewport), row(420));
  assert.equal(above.side, 'above');
  assert.equal(step(above, row(422)).side, 'above');
  // Rows of one size look like the same row moved by layout, so the long step up keeps the side unless it crosses.
  const lower = step(above, row(700));
  assert.equal(lower.side, 'above');
  assert.equal(step(lower, row(420)).side, 'below');
});

test('a label riding between two regions rests where its ride stays off the destination', () => {
  const size = { width: 260, height: 110 };
  const rides: Array<[Rect, Rect]> = [
    [
      { x: 180, y: 500, width: 230, height: 158 },
      { x: 470, y: 580, width: 220, height: 88 },
    ],
    [
      { x: 230, y: 460, width: 420, height: 230 },
      { x: 1080, y: 680, width: 240, height: 70 },
    ],
  ];
  for (const [from, to] of rides) {
    const start = placeBubble(from, center(from), size, viewport);
    const departure = { from: center(from), label: start };
    const rest = placeBubble(to, center(to), size, viewport, start, departure);
    assert.equal(overlaps(rest, to), false);
    assert.equal(covers(departure, rest, to), 0, `to the region at ${to.x},${to.y}`);
  }
});

test('a side the label reaches without crossing its target beats any closer side whose ride crosses it', () => {
  // Below would rest 40 px from the cursor, but its ride crosses the whole target on the way down.
  const { departure, rest } = descend({ width: 260, height: 110 });
  assert.equal(overlaps(rest, tall), false);
  assert.equal(covers(departure, rest, tall, page), 0);
});

test('a label resting clear of its target stays put when the target is delivered again', () => {
  const size = { width: 260, height: 110 };
  const { rest } = descend(size);
  // A layout frame jumps the label, and an activity frame settles it from where it rests. Below is
  // 40 px from the cursor either way, but settling there would carry the label across the target.
  for (const departure of [undefined, { label: rest }])
    assert.deepEqual(placeBubble(tall, bottom, size, page, rest, departure), rest);
});

test('a label settling beside a target that changed under its cursor takes a side it reaches without crossing', () => {
  const size = { width: 260, height: 110 };
  const { rest } = descend(size);
  const grown = { ...tall, y: 150, height: 1110 };
  // Settling below, nearer the cursor, would carry the label across the target.
  assert.equal(placeBubble(grown, bottom, size, page, rest, { label: rest }).side, 'above');
  // A jump paints no path, so the side nearest the cursor wins.
  assert.equal(placeBubble(grown, bottom, size, page, rest).side, 'below');
});

test('a label with no clear side takes the side that covers the least of its target', () => {
  const target = { x: 100, y: 100, width: 520, height: 400 };
  // Beside the target, the label covers 172 px of its width. Above and below, it covers a 22 px strip, and the
  // side bias puts it below.
  const placed = placeBubble(target, center(target), { width: 260, height: 110 }, { width: 720, height: 600 });
  assert.equal(placed.side, 'below');
});

test('a label the viewport clips into its shifted row keeps its side and covers only the clipped strip', () => {
  const size = { width: 260, height: 110 };
  const rest = placeBubble(row(730), at(row(730)), size, viewport);
  assert.equal(rest.side, 'below');
  const departure = { from: at(row(730)), label: rest };
  const shifted = placeBubble(row(732), at(row(732)), size, viewport, rest, departure);
  // The viewport holds the label 2 px into the shifted row, while riding up to above would cover all of it.
  assert.equal(shifted.side, 'below');
  assert.ok(covers(departure, shifted, row(732)) <= 3 * size.width);
});

test('a label that grows into its row against the viewport edge moves to a side it rests clear of', () => {
  const target = row(100);
  const short = { width: 260, height: 60 };
  const start = placeBubble({ x: 708, y: 28, width: 24, height: 24 }, { x: 720, y: 40 }, short, viewport);
  const above = placeBubble(target, at(target), short, viewport, start, { from: { x: 720, y: 40 }, label: start });
  assert.equal(above.side, 'above');
  // Grown to 110 px, the viewport would hold the label over 22 px of the row for as long as it rests.
  // Settling below crosses the row once and then rests clear.
  const grown = placeBubble(target, at(target), { width: 260, height: 110 }, viewport, above, { label: above });
  assert.equal(grown.side, 'below');
  assert.equal(overlaps(grown, target), false);
});

test('a label that sets out over its next row rests clear of it when a side is clear', () => {
  const size = { width: 260, height: 110 };
  const waiting = { x: 720, y: 716 };
  const start = placeBubble({ x: 708, y: 704, width: 24, height: 24 }, waiting, size, viewport);
  const target = row(740);
  // Below, the viewport would hold the label over a 10 px strip of the row.
  for (const departure of [{ from: waiting, label: start }, { label: start }]) {
    const placed = placeBubble(target, at(target), size, viewport, start, departure);
    assert.equal(overlaps(placed, target), false);
  }
});

test('a label that leaves a band it sets out inside takes the side nearest its cursor', () => {
  const size = { width: 260, height: 110 };
  const band = (y: number) => ({ x: 0, y, width: 1440, height: 160 });
  const start = placeBubble(band(40), { x: 500, y: 120 }, size, viewport);
  const placed = placeBubble(band(176), { x: 900, y: 256 }, size, viewport, start, {
    from: { x: 500, y: 120 },
    label: start,
  });
  assert.equal(placed.side, 'below');
});

test('a label riding to the far side of a tall target stays inside the viewport', () => {
  const size = { width: 260, height: 110 };
  const { departure, rest } = descend(size);
  for (let step = 0; step <= 100; step++) {
    const cursor = { x: 720, y: 40 + (bottom.y - 40) * (step / 100) };
    const label = { ...ride(departure, cursor, rest, page), ...size };
    assert.ok(inside(label, { x: 0, y: 0, ...page }), `label at ${label.y} with the cursor at ${cursor.y}`);
  }
});

test('a label that would rest on the end of a row at the viewport edge crosses the row once and rests clear', () => {
  const size = { width: 260, height: 110 };
  const from = { x: 1080, y: 290, width: 190, height: 190 };
  const to = { x: 370, y: 470, width: 920, height: 30 };
  const start = placeBubble(from, center(from), size, viewport);
  // Right of the row, the viewport would hold the label over the row's end for as long as it rests.
  const placed = placeBubble(to, center(to), size, viewport, start, { from: center(from), label: start });
  assert.equal(overlaps(placed, to), false);
});

test('a label whose words grew against the viewport edge rides from where it is first painted', () => {
  const waiting = { x: 700, y: 880 };
  const start = placeBubble({ x: 688, y: 868, width: 24, height: 24 }, waiting, { width: 260, height: 64 }, viewport);
  const target = row(770);
  // Grown to 84 px, the label first paints 20 px higher, over the next row, whichever side it rides to.
  const placed = placeBubble(target, at(target), { width: 260, height: 84 }, viewport, start, {
    from: waiting,
    label: start,
  });
  assert.equal(overlaps(placed, target), false);
});
