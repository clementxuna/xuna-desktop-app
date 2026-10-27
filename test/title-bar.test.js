'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAC_TITLE_STRIP_HEIGHT, titleBarColor, macAppViewBounds } = require('../src/title-bar');
const { BACKGROUND } = require('../src/config');

test("the title bar uses the app's own black and white", () => {
  assert.equal(BACKGROUND.dark, '#010101');
  assert.equal(BACKGROUND.light, '#ffffff');
});

test('a page showing its dark theme gets a black title bar, whatever Windows is set to', () => {
  assert.equal(titleBarColor({ colorScheme: 'dark', prefersDark: false }), BACKGROUND.dark);
  assert.equal(titleBarColor({ colorScheme: 'only dark', prefersDark: false }), BACKGROUND.dark);
});

test('a page showing its light theme gets a white title bar, whatever Windows is set to', () => {
  assert.equal(titleBarColor({ colorScheme: 'light', prefersDark: true }), BACKGROUND.light);
});

test('when the page declares no single theme, the title bar follows Windows', () => {
  for (const colorScheme of ['normal', 'light dark', '', undefined]) {
    assert.equal(titleBarColor({ colorScheme, prefersDark: true }), BACKGROUND.dark, String(colorScheme));
    assert.equal(titleBarColor({ colorScheme, prefersDark: false }), BACKGROUND.light, String(colorScheme));
  }
});

test('a malformed report gives a white title bar instead of throwing', () => {
  for (const report of [null, undefined, 'dark', 42, { colorScheme: 7, prefersDark: 'yes' }]) {
    assert.equal(titleBarColor(report), BACKGROUND.light, JSON.stringify(report));
  }
});

test("on Mac the XUNA page sits below a strip as tall as macOS's own title bar", () => {
  assert.equal(MAC_TITLE_STRIP_HEIGHT, 28);
  assert.deepEqual(macAppViewBounds({ width: 1280, height: 820, fullScreen: false }), { x: 0, y: 28, width: 1280, height: 792 });
});

test('in full screen the XUNA page takes the whole window', () => {
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true }), { x: 0, y: 0, width: 1512, height: 982 });
});

test('a window smaller than the strip gives the page no height rather than a negative one', () => {
  assert.deepEqual(macAppViewBounds({ width: 400, height: 10, fullScreen: false }), { x: 0, y: 28, width: 400, height: 0 });
});

test("the strip's drag area is exactly the strip", () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'title-strip.html'), 'utf8');
  const strip = html.match(/\.strip\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(strip, new RegExp(`height:\\s*${MAC_TITLE_STRIP_HEIGHT}px`));
  assert.match(strip, /(^|[\s;])app-region:\s*drag/);
});
