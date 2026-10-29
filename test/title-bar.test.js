'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MAC_TITLE_STRIP_HEIGHT, titleBarColor, macAppViewBounds, PICKER_PANEL_WIDTH, pickerPanelBounds } = require('../src/title-bar');
const { BACKGROUND } = require('../src/config');

test("the title bar uses the black and white of the app's header", () => {
  // The web app's dark --sidebar (its header) is the page's rgb(3 3 3); its light one is white.
  assert.equal(BACKGROUND.dark, '#030303');
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

test('with two or more workspace tabs open the strip stays in full screen, so they can still be switched', () => {
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true, tabCount: 1 }), { x: 0, y: 0, width: 1512, height: 982 });
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true, tabCount: 2 }), { x: 0, y: 28, width: 1512, height: 954 });
  assert.deepEqual(macAppViewBounds({ width: 1280, height: 820, fullScreen: false, tabCount: 3 }), { x: 0, y: 28, width: 1280, height: 792 });
});

test('a window smaller than the strip gives the page no height rather than a negative one', () => {
  assert.deepEqual(macAppViewBounds({ width: 400, height: 10, fullScreen: false }), { x: 0, y: 28, width: 400, height: 0 });
});

const stripHtml = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'title-strip.html'), 'utf8');
const cssRule = (html, selector) => html.match(new RegExp(`(?:^|\\s)${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test("the strip's drag area is exactly the strip", () => {
  const strip = cssRule(stripHtml(), '.strip');
  assert.match(strip, new RegExp(`height:\\s*${MAC_TITLE_STRIP_HEIGHT}px`));
  assert.match(strip, /(^|[\s;])app-region:\s*drag/);
});

test("the strip's buttons take clicks instead of dragging the window", () => {
  const buttons = cssRule(stripHtml(), '.tab, .add');
  assert.match(buttons, /(^|[\s;])app-region:\s*no-drag/);
  assert.match(buttons, /-webkit-app-region:\s*no-drag/);
});

test("the strip lets the window's colour through, so it matches XUNA's header exactly", () => {
  // A colour scheme on the strip makes Chromium paint its own grey (#121212) over the window's black.
  const style = stripHtml().match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.doesNotMatch(style, /color-scheme\s*:/);
  assert.match(cssRule(stripHtml(), 'html, body'), /background:\s*transparent/);
  assert.doesNotMatch(stripHtml(), /<meta name="color-scheme"/);
});

test('the strip runs only its own script file', () => {
  const policy = stripHtml().match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.doesNotMatch(stripHtml(), /<script>/); // an inline script would be refused anyway
});

test("the workspace panel opens below the + button, its right edge in line with the button's, as wide as XUNA's", () => {
  // The view holds the panel and a transparent margin for its shadow: 12px either side, 4 above, 16 below.
  const anchor = { x: 1240, y: 4, width: 20, height: 20 };
  assert.equal(PICKER_PANEL_WIDTH, 384);
  assert.deepEqual(pickerPanelBounds({ anchor, width: 1280, height: 820, panelHeight: 300 }), { x: 864, y: 28, width: 408, height: 320 });
});

test('the workspace panel stays inside a narrow window, and no taller than the space below the strip', () => {
  const anchor = { x: 360, y: 4, width: 20, height: 20 };
  assert.deepEqual(pickerPanelBounds({ anchor, width: 400, height: 500, panelHeight: 300 }), { x: 0, y: 28, width: 400, height: 320 });
  assert.equal(pickerPanelBounds({ anchor, width: 1280, height: 200, panelHeight: 300 }).height, 172);
});
