'use strict';

// Sizes in the Mac title strip (src/title-strip.html), worked out by the strip's page and unit-tested in
// test/title-strip-layout.test.js. No Electron imports; the strip's page loads this as a plain script.

// Where the strip's controls start, clear of macOS's three buttons: they sit 14px in in the 40px strip
// and 20px in in one row (see src/title-bar.js), and take about 54px. Without them (Windows), a margin.
const LIGHTS = { strip: 90, oneRow: 92, none: 8 };
const TAB_MIN_WIDTH = 48; // .tab's min-width in the strip's CSS
const TAB_GAP = 2; // between tabs
const GAP = 4; // between the strip's groups of controls
const END_PADDING = 8; // after the last control

// lights: whether the window has macOS's three buttons. mode: 'strip' or 'one-row'.
function lightsZone({ lights, mode }) {
  if (!lights) return LIGHTS.none;
  return mode === 'one-row' ? LIGHTS.oneRow : LIGHTS.strip;
}

// The bar's left end in one row, which the main process needs before it can choose one row (see
// clusterReport in src/title-bar.js): its width with the tabs at their full width (tabNaturals, as
// measured), and with each at its narrowest. logo, history and add: the widths of XUNA's logo, of Back
// and Forward together, and of +. The strip shows every tab, one on its own included; it has none only
// before it is first told them.
function clusterWidths({ lights, logo, history, add, tabNaturals }) {
  const fixed = lightsZone({ lights, mode: 'one-row' }) + logo + GAP + history + GAP + add + END_PADDING;
  if (tabNaturals.length === 0) return { natural: Math.ceil(fixed), minimum: Math.ceil(fixed) };
  const gaps = TAB_GAP * (tabNaturals.length - 1) + GAP;
  const full = tabNaturals.reduce((sum, width) => sum + Math.max(width, TAB_MIN_WIDTH), 0);
  return { natural: Math.ceil(fixed + gaps + full), minimum: Math.ceil(fixed + gaps + TAB_MIN_WIDTH * tabNaturals.length) };
}

// Where a tab dragged along the strip lands: centers are the tabs' middles before the drag, from the
// dragged tab's place, x where its middle is now. It goes after every other tab whose middle it passed.
function dropIndex({ centers, from, x }) {
  return centers.filter((center, index) => index !== from && center < x).length;
}

// While a tab is dragged from one place to another, how far each other tab moves aside to show where it
// will land: by the dragged tab's width and the gap between tabs.
function dragShifts({ count, from, to, width }) {
  const step = width + TAB_GAP;
  return Array.from({ length: count }, (_, index) => {
    if (from < to && index > from && index <= to) return -step;
    if (from > to && index >= to && index < from) return step;
    return 0;
  });
}

// The tabs the strip draws: all of them, a tab on its own included, as you are always in a workspace,
// once it stands for one you are in (known, as the main process says). Before that, a new copy at the
// sign-in page, signed out, or with tabs turned off, a tab on its own isn't drawn.
function shownTabs(tabs) {
  return tabs.length === 1 && !tabs[0].known ? [] : tabs;
}

const api = { LIGHTS, TAB_MIN_WIDTH, TAB_GAP, GAP, END_PADDING, lightsZone, clusterWidths, dropIndex, dragShifts, shownTabs };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.titleStripLayout = api; // the strip's page loads this as a plain script
