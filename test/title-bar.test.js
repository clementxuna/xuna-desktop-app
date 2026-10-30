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
  rememberedBar,
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
  const layout = macWindowLayout({ width: 1280, height: 820, fullScreen: false, header: xunaHeader({ innerWidth: 1024 }), cluster: { natural: 184, minimum: 184 }, zoom: 1.25 });
  assert.equal(layout.barHeight, 70);
  assert.deepEqual(layout.strip, { x: 0, y: 0, width: 184, height: 70 });
  assert.deepEqual(layout.trafficLights, { x: 20, y: 27 });
  assert.equal(layout.inset, 147.2);
});

test("the bar follows the zoom the page is at, not the width the page last gave, which lags while the window is resized", () => {
  // The window has just grown from 1280 to 1728 wide; the page still says it is 1280 CSS px wide.
  const layout = macWindowLayout({ width: 1728, height: 1000, fullScreen: false, header: xunaHeader({ innerWidth: 1280 }), cluster: { natural: 184, minimum: 184 }, zoom: 1 });
  assert.equal(layout.barHeight, 56);
  assert.deepEqual(layout.trafficLights, { x: 20, y: 20 });
  assert.equal(layout.inset, 184);
});

test("one row needs XUNA's desktop header, which it shows from 1024 CSS px wide: narrower, its menu covers the whole page", () => {
  const cluster = { natural: 184, minimum: 184 };
  const at = (width, zoom = 1) => macWindowLayout({ width, height: 800, fullScreen: false, header: xunaHeader({ minWidth: 450, innerWidth: width / zoom }), cluster, zoom }).mode;
  assert.equal(at(1023), 'strip');
  assert.equal(at(1024), 'one-row');
  assert.equal(at(1200, 1.25), 'strip'); // the page 960 CSS px wide
  assert.equal(at(1280, 1.25), 'one-row'); // 1024
});

test("tabs that want more room than XUNA's header can spare shrink, keeping 64px of the header free to drag the window by", () => {
  assert.equal(ONE_ROW_MIN_DRAG, 64);
  const cluster = { natural: 600, minimum: 300 };
  const header = xunaHeader({ minWidth: 600 });
  assert.equal(macWindowLayout({ width: 1280, height: 820, fullScreen: false, tabCount: 4, header, cluster }).strip.width, 600);
  const narrow = macWindowLayout({ width: 1100, height: 820, fullScreen: false, tabCount: 4, header: { ...header, innerWidth: 1100 }, cluster });
  assert.equal(narrow.mode, 'one-row');
  assert.equal(narrow.strip.width, 436); // 1100 − 600 − 64
});

test("the strip comes back when even the smallest tabs won't fit, on a page without XUNA's header, and until the strip has measured itself", () => {
  const strip = { mode: 'strip', page: { x: 0, y: 40, width: 1100, height: 780 }, strip: { x: 0, y: 0, width: 1100, height: 40 }, trafficLights: { x: 14, y: 12 }, inset: 0, barHeight: 40, barBottom: 40 };
  const cluster = { natural: 600, minimum: 300 };
  const header = xunaHeader({ innerWidth: 1100 });
  assert.deepEqual(macWindowLayout({ width: 1100, height: 820, fullScreen: false, tabCount: 4, header: { ...header, minWidth: 800 }, cluster }), strip); // 1100 − 800 − 64 < 300
  assert.deepEqual(macWindowLayout({ width: 1100, height: 820, fullScreen: false, header: null, cluster }), strip);
  assert.deepEqual(macWindowLayout({ width: 1100, height: 820, fullScreen: false, header, cluster: null }), strip);
  assert.deepEqual(macWindowLayout({ width: 1100, height: 820, fullScreen: false, header, cluster: { natural: 184, minimum: 184 }, oneRow: false }), strip);
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

test("colours in CSS's newer syntax, as Chromium gives Tailwind's, are kept", () => {
  const report = headerReport(xunaHeader({ background: 'oklch(0.985 0 0)', border: 'oklab(0.92 0 0 / 0.8)', cover: { filter: 'blur(16px) saturate(1.25)', tint: 'oklab(0 0 0 / 0.1)' } }));
  assert.equal(report.background, 'oklch(0.985 0 0)');
  assert.equal(report.border, 'oklab(0.92 0 0 / 0.8)');
  assert.equal(report.cover.tint, 'oklab(0 0 0 / 0.1)');
});

test("the strip's measure of its tabs is taken only when it makes sense", () => {
  assert.deepEqual(clusterReport({ natural: 400, minimum: 250 }), { natural: 400, minimum: 250 });
  assert.equal(clusterReport({ natural: 200, minimum: 250 }), null);
  assert.equal(clusterReport({ natural: 400, minimum: 0 }), null);
  assert.equal(clusterReport({ natural: 9000, minimum: 250 }), null);
  assert.equal(clusterReport('400'), null);
});

test('the bar as the window last closed with it is kept, without whatever covered XUNA then, and read back only where plausible', () => {
  const kept = rememberedBar({ header: xunaHeader({ cover: { filter: 'blur(16px)', tint: 'rgba(0, 0, 0, 0.1)' } }), cluster: { natural: 317, minimum: 258 }, dark: true });
  assert.deepEqual(kept, { header: xunaHeader(), cluster: { natural: 317, minimum: 258 }, dark: true });
  assert.deepEqual(rememberedBar(JSON.parse(JSON.stringify(kept))), kept); // through the file and back
  assert.deepEqual(rememberedBar({ header: null, cluster: null, dark: false }), { header: null, cluster: null, dark: false });
  // A first run, or a file that isn't the bar's
  assert.deepEqual(rememberedBar(null), { header: null, cluster: null, dark: null });
  assert.deepEqual(rememberedBar({ header: xunaHeader({ height: 500 }), cluster: '400', dark: 'yes' }), { header: null, cluster: null, dark: null });
});

test('a window opening with the bar remembered from one row opens in one row, the three buttons already in their place', () => {
  const { header, cluster } = rememberedBar({ header: xunaHeader(), cluster: { natural: 317, minimum: 258 }, dark: false });
  const layout = macWindowLayout({ width: 1280, height: 820, fullScreen: false, header, cluster });
  assert.equal(layout.mode, 'one-row');
  assert.deepEqual(layout.trafficLights, { x: 20, y: 20 });
  // Nothing remembered: the strip, as on a first run, at the sign-in page.
  assert.equal(macWindowLayout({ width: 1280, height: 820, fullScreen: false, ...rememberedBar(null) }).mode, 'strip');
});

const stripHtml = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'title-strip.html'), 'utf8');
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cssRule = (html, selector) => html.match(new RegExp(`(?:^|\\s)${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

test("the strip's drag area is exactly the strip, 40px tall until the main process sets the bar's height", () => {
  const strip = cssRule(stripHtml(), '.strip');
  assert.match(strip, /height:\s*var\(--bar-height\)/);
  assert.match(cssRule(stripHtml(), ':root'), new RegExp(`--bar-height:\\s*${MAC_TITLE_STRIP_HEIGHT}px`));
  assert.match(strip, /(^|[\s;])app-region:\s*drag/);
});

test("the strip's buttons take clicks instead of dragging the window, Back and Forward among them", () => {
  const buttons = cssRule(stripHtml(), '.tab, .add, .ask-ai, .history button');
  assert.match(buttons, /(^|[\s;])app-region:\s*no-drag/);
  assert.match(buttons, /-webkit-app-region:\s*no-drag/);
});

test("until it is told the bar's colour, the strip lets the window's colour through, so it matches XUNA's header exactly", () => {
  // A colour scheme on the strip makes Chromium paint its own grey (#121212) over the window's black.
  const style = stripHtml().match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.doesNotMatch(style, /color-scheme\s*:/);
  assert.match(cssRule(stripHtml(), 'html, body'), /background:\s*transparent/);
  assert.match(cssRule(stripHtml(), ':root'), /--bar-background:\s*transparent/);
  assert.match(cssRule(stripHtml(), '.strip'), /background:\s*var\(--bar-background\)/);
  assert.doesNotMatch(stripHtml(), /<meta name="color-scheme"/);
});

test("in one row the strip's controls sit at its left, against XUNA's header, and its Ask AI goes, XUNA's own being in the same row", () => {
  assert.match(cssRule(stripHtml(), ':root[data-mode="one-row"] .history'), /margin-inline-end:\s*0/);
  assert.match(cssRule(stripHtml(), '.history'), /margin-inline-end:\s*auto/); // in the strip, the tabs stay at its right end
  assert.match(cssRule(stripHtml(), ':root[data-mode="one-row"] .ask-ai'), /display:\s*none/);
});

test("the bar stays as it is with the window in the background: nothing in it fades, XUNA's Ask AI orb among it", () => {
  assert.doesNotMatch(stripHtml(), /data-inactive/);
  assert.ok(!oneRowRules().some(([selectors]) => selectors.some((selector) => selector.includes('inactive'))));
});

test("until the main process has said what to draw, the strip shows nothing, rather than a bar it would redraw at once", () => {
  assert.match(cssRule(stripHtml(), ':root:not([data-ready]) .strip'), /visibility:\s*hidden/);
});

test("XUNA's logo in the bar has its width before its image has loaded, so the bar's measure doesn't change when it arrives", () => {
  const img = stripHtml().match(/<img src="xuna-logo\.png"[^>]*>/)?.[0] ?? '';
  assert.match(img, /width="512"/); // src/xuna-logo.png is 512 × 122
  assert.match(img, /height="122"/);
  assert.match(cssRule(stripHtml(), '.home img'), /height:\s*20px/);
});

// XUNA's header orb is AskAiOrb: an 18px SiriOrb, at rest ("idle"), turning every 6 seconds (see the web app's
// ask-ai-orb.tsx, siri-orb/index.tsx and ai-core). Its values at that size: the mesh's --angle runs to 720deg
// over two turns' time, where every layer (x1, x2, x-2, x-3, x1.5) is back where it began; blur 1px,
// contrast 1.1, dots 0.072px, rim 1.5px; at rest the sphere is at 0.94 of its size and 0.75 of its
// saturation, its glow at 0.15 x 0.7 opacity, blurred 0.28 of its size; the whole breathes to 1.035 every 5.5s.
test("the strip's Ask AI orb is XUNA's, as XUNA's header draws it: the same size, colours, pace and layers", () => {
  const html = stripHtml();
  assert.match(cssRule(html, '.orb'), /width:\s*18px;[^}]*height:\s*18px/);
  assert.match(html, /@keyframes orb-turn\s*\{\s*to\s*\{\s*--angle:\s*720deg;?\s*\}\s*\}/);
  assert.match(cssRule(html, '.orb-sphere::before'), /animation:\s*orb-turn 12s linear infinite/);
  assert.match(cssRule(html, '.orb-sphere::before'), /filter:\s*blur\(1px\) contrast\(1\.1\) saturate\(1\.4\)/);
  assert.match(cssRule(html, '.orb-sphere'), /filter:\s*saturate\(0\.75\)/);
  assert.match(cssRule(html, '.orb-sphere'), /transform:\s*scale\(0\.94\)/);
  assert.match(cssRule(html, '.orb-sphere::after'), /backdrop-filter:\s*blur\(2px\) contrast\(2\.2\)/);
  assert.match(cssRule(html, '.orb-sphere::after'), /mix-blend-mode:\s*overlay/);
  assert.match(cssRule(html, '.orb-glow'), /opacity:\s*0\.105/);
  assert.match(cssRule(html, '.orb-glow'), /filter:\s*blur\(5\.04px\)/);
  assert.match(cssRule(html, '.orb-sheen'), /animation:\s*orb-drift 12s ease-in-out infinite alternate/);
  assert.match(cssRule(html, '.orb'), /animation:\s*orb-breathe 5\.5s cubic-bezier\(0\.645, 0\.045, 0\.355, 1\) infinite/);
});

test("while there is no XUNA Ask AI to press yet, the strip's dims its label, never its orb", () => {
  assert.doesNotMatch(cssRule(stripHtml(), '.ask-ai:disabled'), /opacity/);
  assert.match(cssRule(stripHtml(), '.ask-ai:disabled .label'), /opacity:\s*0\.5/);
});

test("while XUNA's page is covered the strip's bottom line goes too, as the cover blurs XUNA's own away", () => {
  assert.match(cssRule(stripHtml(), ':root[data-covered] .strip'), /box-shadow:\s*none/);
});

test("while something covers XUNA's page, a dialog's backdrop say, the strip looks covered as well and takes no clicks", () => {
  const controls = cssRule(stripHtml(), ':root[data-covered] .strip > *');
  assert.match(controls, /filter:\s*var\(--cover-filter, none\)/);
  assert.match(controls, /pointer-events:\s*none/);
  assert.match(cssRule(stripHtml(), ':root[data-covered] .strip::after'), /background:\s*var\(--cover-tint, transparent\)/);
});

test('the strip runs only its own script file', () => {
  const policy = stripHtml().match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/);
  assert.doesNotMatch(stripHtml(), /<script>/); // an inline script would be refused anyway
});

// src/one-row.css: its rules, comments left out, as [selectors, declarations], each selector on its own.
const oneRowRules = () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'one-row.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const split = (list) => {
    const parts = [''];
    let depth = 0;
    for (const char of list) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) parts.push('');
      else parts[parts.length - 1] += char;
    }
    return parts.map((part) => part.trim()).filter(Boolean);
  };
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, list, body]) => [split(list), body]);
};
const oneRowRule = (selector) => oneRowRules().find(([selectors]) => selectors.includes(selector))?.[1] ?? '';

test("the CSS put in XUNA's page does nothing until the main process turns one row, or the bar's logo, on", () => {
  const selectors = oneRowRules().flatMap(([list]) => list);
  assert.ok(selectors.length > 0);
  for (const selector of selectors) assert.match(selector, /^:root\[data-xuna-desktop-(row|logo)\]/);
});

test("while the bar shows XUNA's logo, XUNA's header hides its own, a white-labelled workspace's included, from the moment it is drawn", () => {
  // Any header holding XUNA's home link, not only one the preload has already marked, which it does on
  // its next look, a moment after XUNA draws it: in the strip the header's logo would show till then.
  const rule = oneRowRule(':root[data-xuna-desktop-logo] header a[aria-label="Go to home"]');
  assert.match(rule, /display:\s*none\s*!important/);
});

test("in one row XUNA's header moves over by the strip's width, its box with it, and its empty space drags the window", () => {
  const rule = oneRowRule(':root[data-xuna-desktop-row] [data-xuna-desktop-bar]');
  assert.match(rule, /margin-inline-start:\s*var\(--xuna-desktop-row-inset, 0px\)\s*!important/);
  assert.match(rule, /width:\s*calc\(100% - var\(--xuna-desktop-row-inset, 0px\)\)\s*!important/);
  assert.match(rule, /(^|[\s;])app-region:\s*drag/);
  assert.match(rule, /-webkit-app-region:\s*drag/);
});

test("everything that takes clicks in or over XUNA's header stays clickable: its controls, and XUNA's dialogs, menus and toasts", () => {
  const noDrag = oneRowRules().filter(([, body]) => /(^|[\s;])app-region:\s*no-drag/.test(body)).flatMap(([list]) => list);
  for (const selector of [
    ':root[data-xuna-desktop-row] [data-xuna-desktop-bar] > * > *',
    ':root[data-xuna-desktop-row] body > :not(#root)',
    ':root[data-xuna-desktop-row] :is([data-sonner-toaster], [data-sonner-toast])',
    ':root[data-xuna-desktop-row][data-xuna-desktop-covered] [data-xuna-desktop-bar]',
  ]) {
    assert.ok(noDrag.includes(selector), selector);
  }
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
