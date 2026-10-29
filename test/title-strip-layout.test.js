'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lightsZone, clusterWidths, dropIndex, dragShifts } = require('../src/title-strip-layout');

test("the strip's controls start clear of macOS's three buttons, which sit further in in one row; without them, at a margin", () => {
  assert.equal(lightsZone({ lights: true, mode: 'strip' }), 90);
  assert.equal(lightsZone({ lights: true, mode: 'one-row' }), 92);
  assert.equal(lightsZone({ lights: false, mode: 'one-row' }), 8);
});

test("with one tab the bar's left end holds Back, Forward and + only", () => {
  // 92 clear of the three buttons, Back and Forward's 58, a 4px gap, +'s 28 and 8 at the end
  assert.deepEqual(clusterWidths({ lights: true, history: 58, add: 28, tabNaturals: [] }), { natural: 190, minimum: 190 });
});

test("with tabs, the bar's left end is as wide as they are at full width, or with each at its narrowest, 48px", () => {
  // 190, the tabs, 2px between them and 4 before +
  assert.deepEqual(clusterWidths({ lights: true, history: 58, add: 28, tabNaturals: [120, 90.5, 176] }), { natural: 585, minimum: 342 });
  assert.deepEqual(clusterWidths({ lights: false, history: 58, add: 28, tabNaturals: [100, 100] }), { natural: 312, minimum: 208 });
  // a tab measured under 48 still takes 48
  assert.deepEqual(clusterWidths({ lights: true, history: 58, add: 28, tabNaturals: [30, 30] }), { natural: 292, minimum: 292 });
});

test('a tab dragged along the strip lands after every other tab whose middle it has passed', () => {
  const centers = [50, 150, 250];
  assert.equal(dropIndex({ centers, from: 0, x: 160 }), 1);
  assert.equal(dropIndex({ centers, from: 0, x: 260 }), 2);
  assert.equal(dropIndex({ centers, from: 2, x: 40 }), 0);
  assert.equal(dropIndex({ centers, from: 1, x: 140 }), 1); // not far enough to pass either neighbour
});

test('while a tab is dragged, the tabs it passes move aside by its width and the gap', () => {
  assert.deepEqual(dragShifts({ count: 4, from: 0, to: 2, width: 100 }), [0, -102, -102, 0]);
  assert.deepEqual(dragShifts({ count: 4, from: 3, to: 1, width: 100 }), [0, 102, 102, 0]);
  assert.deepEqual(dragShifts({ count: 3, from: 1, to: 1, width: 100 }), [0, 0, 0]);
});
