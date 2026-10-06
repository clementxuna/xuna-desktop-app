'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { titleBarColor } = require('../src/title-bar');
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
