'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAC_TITLE_STRIP_HEIGHT,
  MAC_TRAFFIC_LIGHTS,
  ONE_ROW_MIN_DRAG,
  titleBarColor,
  macAppViewBounds,
  macWindowLayout,
  headerReport,
  clusterReport,
  PICKER_PANEL_WIDTH,
  pickerPanelBounds,
  askAiState,
} = require('../src/title-bar');
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

test("on Mac the XUNA page sits below a strip a little taller than macOS's own title bar, to fit Ask AI", () => {
  assert.equal(MAC_TITLE_STRIP_HEIGHT, 40);
  assert.deepEqual(macAppViewBounds({ width: 1280, height: 820, fullScreen: false }), { x: 0, y: 40, width: 1280, height: 780 });
});

test("the window's three buttons sit in the middle of the strip, level with its tabs and buttons", () => {
  // macOS draws each in a 16px-tall frame, from the top-left corner given here.
  assert.deepEqual(MAC_TRAFFIC_LIGHTS, { x: 14, y: 12 });
  assert.equal(MAC_TRAFFIC_LIGHTS.y + 16 / 2, MAC_TITLE_STRIP_HEIGHT / 2);
});

test('in full screen the XUNA page takes the whole window', () => {
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true }), { x: 0, y: 0, width: 1512, height: 982 });
});

test('with two or more workspace tabs open the strip stays in full screen, so they can still be switched', () => {
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true, tabCount: 1 }), { x: 0, y: 0, width: 1512, height: 982 });
  assert.deepEqual(macAppViewBounds({ width: 1512, height: 982, fullScreen: true, tabCount: 2 }), { x: 0, y: 40, width: 1512, height: 942 });
  assert.deepEqual(macAppViewBounds({ width: 1280, height: 820, fullScreen: false, tabCount: 3 }), { x: 0, y: 40, width: 1280, height: 780 });
});

test('a window smaller than the strip gives the page no height rather than a negative one', () => {
  assert.deepEqual(macAppViewBounds({ width: 400, height: 10, fullScreen: false }), { x: 0, y: 40, width: 400, height: 0 });
});

// XUNA's header as a tab's page reports it (see src/preload.js): 56 CSS px tall, its contents needing 700.
const xunaHeader = (fields = {}) => ({ height: 56, minWidth: 700, innerWidth: 1280, background: 'rgb(255, 255, 255)', border: 'rgb(233, 234, 235)', cover: null, ...fields });

test("in one row XUNA's page fills the window, and the strip takes the left end of XUNA's header, the three buttons in its middle", () => {
  const layout = macWindowLayout({ width: 1280, height: 820, fullScreen: false, tabCount: 1, header: xunaHeader(), cluster: { natural: 184, minimum: 184 } });
  assert.deepEqual(layout, {
    mode: 'one-row',
    page: { x: 0, y: 0, width: 1280, height: 820 },
    strip: { x: 0, y: 0, width: 184, height: 56 },
    trafficLights: { x: 20, y: 20 },
    inset: 184,
    barHeight: 56,
    barBottom: 56,
  });
});

test("zooming XUNA's page scales its header, so the bar grows with it, and the room made in it is in the page's own pixels", () => {
  // At 125% the page is 1024 CSS px wide in a 1280-wide window.
  const layout = macWindowLayout({ width: 1280, height: 820, fullScreen: false, header: xunaHeader({ innerWidth: 1024 }), cluster: { natural: 184, minimum: 184 } });
  assert.equal(layout.barHeight, 70);
  assert.deepEqual(layout.strip, { x: 0, y: 0, width: 184, height: 70 });
  assert.deepEqual(layout.trafficLights, { x: 20, y: 27 });
  assert.equal(layout.inset, 147.2);
});

test("tabs that want more room than XUNA's header can spare shrink, keeping 64px of the header free to drag the window by", () => {
  assert.equal(ONE_ROW_MIN_DRAG, 64);
  const cluster = { natural: 600, minimum: 300 };
  const header = xunaHeader({ minWidth: 600 });
  assert.equal(macWindowLayout({ width: 1280, height: 820, fullScreen: false, tabCount: 4, header, cluster }).strip.width, 600);
  const narrow = macWindowLayout({ width: 1000, height: 820, fullScreen: false, tabCount: 4, header: { ...header, innerWidth: 1000 }, cluster });
  assert.equal(narrow.mode, 'one-row');
  assert.equal(narrow.strip.width, 336); // 1000 − 600 − 64
});

test("the strip comes back when even the smallest tabs won't fit, on a page without XUNA's header, and until the strip has measured itself", () => {
  const strip = { mode: 'strip', page: { x: 0, y: 40, width: 900, height: 780 }, strip: { x: 0, y: 0, width: 900, height: 40 }, trafficLights: { x: 14, y: 12 }, inset: 0, barHeight: 40, barBottom: 40 };
  const cluster = { natural: 600, minimum: 300 };
  assert.deepEqual(macWindowLayout({ width: 900, height: 820, fullScreen: false, tabCount: 4, header: xunaHeader({ minWidth: 600, innerWidth: 900 }), cluster }), strip);
  assert.deepEqual(macWindowLayout({ width: 900, height: 820, fullScreen: false, header: null, cluster }), strip);
  assert.deepEqual(macWindowLayout({ width: 900, height: 820, fullScreen: false, header: xunaHeader({ innerWidth: 900 }), cluster: null }), strip);
  assert.deepEqual(macWindowLayout({ width: 900, height: 820, fullScreen: false, header: xunaHeader({ innerWidth: 900 }), cluster: { natural: 184, minimum: 184 }, oneRow: false }), strip);
});

test("full screen keeps today's rule, as macOS shows the three buttons there only with the menu bar: no bar with one tab, the strip with more", () => {
  const header = xunaHeader({ innerWidth: 1512 });
  const cluster = { natural: 184, minimum: 184 };
  const one = macWindowLayout({ width: 1512, height: 982, fullScreen: true, tabCount: 1, header, cluster });
  assert.deepEqual(one, { mode: 'strip', page: { x: 0, y: 0, width: 1512, height: 982 }, strip: null, trafficLights: { x: 14, y: 12 }, inset: 0, barHeight: 40, barBottom: 0 });
  const two = macWindowLayout({ width: 1512, height: 982, fullScreen: true, tabCount: 2, header, cluster });
  assert.equal(two.mode, 'strip');
  assert.deepEqual(two.strip, { x: 0, y: 0, width: 1512, height: 40 });
  assert.deepEqual(two.page, { x: 0, y: 40, width: 1512, height: 942 });
});

test("what a page says about XUNA's header is taken only when it is plausible, keeping only plain colours and filters", () => {
  assert.deepEqual(headerReport(xunaHeader()), xunaHeader());
  const cover = { filter: 'blur(16px) saturate(1.25)', tint: 'rgba(0, 0, 0, 0.1)' };
  assert.deepEqual(headerReport(xunaHeader({ cover })).cover, cover);
  assert.equal(headerReport(xunaHeader({ height: 120 })), null);
  assert.equal(headerReport(xunaHeader({ minWidth: Number.NaN })), null);
  assert.equal(headerReport(xunaHeader({ innerWidth: 50 })), null);
  assert.equal(headerReport(null), null);
  const odd = headerReport(xunaHeader({ background: 'url(https://example.com/x.png)', border: 'red; position: fixed', cover: { filter: 'url(#x)', tint: 'blue' } }));
  assert.equal(odd.background, null);
  assert.equal(odd.border, null);
  assert.deepEqual(odd.cover, { filter: null, tint: 'blue' });
});

test("the strip's measure of its tabs is taken only when it makes sense", () => {
  assert.deepEqual(clusterReport({ natural: 400, minimum: 250 }), { natural: 400, minimum: 250 });
  assert.equal(clusterReport({ natural: 200, minimum: 250 }), null);
  assert.equal(clusterReport({ natural: 400, minimum: 0 }), null);
  assert.equal(clusterReport({ natural: 9000, minimum: 250 }), null);
  assert.equal(clusterReport('400'), null);
});

const stripHtml = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'title-strip.html'), 'utf8');
const cssRule = (html, selector) => html.match(new RegExp(`(?:^|\\s)${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test("the strip's drag area is exactly the strip", () => {
  const strip = cssRule(stripHtml(), '.strip');
  assert.match(strip, new RegExp(`height:\\s*${MAC_TITLE_STRIP_HEIGHT}px`));
  assert.match(strip, /(^|[\s;])app-region:\s*drag/);
});

test("the strip's buttons take clicks instead of dragging the window", () => {
  const buttons = cssRule(stripHtml(), '.tab, .add, .ask-ai');
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
  const anchor = { x: 1240, y: 4, width: 20, height: 20 }; // the + button's rectangle in the strip
  assert.equal(PICKER_PANEL_WIDTH, 384);
  assert.deepEqual(pickerPanelBounds({ anchor, width: 1280, height: 820, panelHeight: 300 }), { x: 864, y: 28, width: 408, height: 320 });
});

test('the workspace panel stays inside a narrow window, and no taller than the space below the strip', () => {
  const anchor = { x: 360, y: 4, width: 20, height: 20 };
  assert.deepEqual(pickerPanelBounds({ anchor, width: 400, height: 500, panelHeight: 300 }), { x: 0, y: 28, width: 400, height: 320 });
  assert.equal(pickerPanelBounds({ anchor, width: 1280, height: 200, panelHeight: 300 }).height, 172);
});

test('in one row the workspace panel opens below the bar, not over it, where its top would drag the window', () => {
  const anchor = { x: 150, y: 14, width: 28, height: 28 }; // the + button in a 56px row
  const bounds = pickerPanelBounds({ anchor, width: 1280, height: 820, panelHeight: 300, barBottom: 56 });
  assert.equal(bounds.y, 56);
  assert.equal(bounds.height, 320);
});

test("Ask AI follows XUNA's own button in the tab in front: there or not, open or not, in the workspace's colours", () => {
  const colors = ['#6232FF', '#2849FF', 'color-mix(in oklab, #6232FF 62%, #2849FF)', 'color-mix(in oklab, #2849FF 68%, white)'];
  assert.deepEqual(askAiState({ available: true, open: true, colors }), { available: true, open: true, colors });
  assert.deepEqual(askAiState({ available: 1, open: 'yes', colors: [...colors.slice(0, 3), 'url(https://example.com/x)'] }), { available: false, open: false, colors: null });
  assert.deepEqual(askAiState({ available: true, open: false, colors: colors.slice(0, 2) }), { available: true, open: false, colors: null });
  assert.deepEqual(askAiState(undefined), { available: false, open: false, colors: null });
});
