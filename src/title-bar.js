'use strict';

// Picks the window title bar colour from the theme the page reports (see src/preload.js), so the bar
// matches the app beneath it: black in dark mode, white in light mode. No Electron imports, so it is
// unit-tested in test/title-bar.test.js.

const { BACKGROUND } = require('./config');

// On Mac the window hides macOS's own title bar, which is grey whatever theme XUNA shows, and keeps its
// three buttons over a strip in XUNA's black or white (src/title-strip.html), with the XUNA page below.
// 28px is macOS's own title bar height, so the buttons sit where they always do.
const MAC_TITLE_STRIP_HEIGHT = 28;

// report: { colorScheme: the page's computed CSS color-scheme, prefersDark: the system is in dark mode }
function titleBarColor(report) {
  const tokens = typeof report?.colorScheme === 'string' ? report.colorScheme.trim().split(/\s+/) : [];
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  if (dark !== light) return dark ? BACKGROUND.dark : BACKGROUND.light;
  return report?.prefersDark === true ? BACKGROUND.dark : BACKGROUND.light;
}

// Where the XUNA pages go in a Mac window with this content size: below the strip, or the whole window
// in full screen, where macOS shows the buttons over the page only while the pointer is at the top.
// With more than one workspace tab open the strip stays in full screen, so the tabs can still be switched.
function macAppViewBounds({ width, height, fullScreen, tabCount = 1 }) {
  const top = fullScreen && tabCount < 2 ? 0 : MAC_TITLE_STRIP_HEIGHT;
  return { x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) };
}

// The + button's panel of workspaces (src/workspace-picker-panel.html), as wide as XUNA's own picker.
// Its view keeps a transparent margin round the panel for the panel's shadow, and it sits 8px below the
// button, as XUNA's popovers sit below the control that opens them.
const PICKER_PANEL_WIDTH = 384;
const PANEL_MARGIN = { side: 12, top: 4, bottom: 16 };
const PANEL_GAP = 8;

// Where the panel's view goes in a window with this content size: under the + button (anchor: its
// rectangle in the strip), right edges in line, kept inside the window. panelHeight: what the panel's
// page measured itself at.
function pickerPanelBounds({ anchor, width, height, panelHeight }) {
  const viewWidth = Math.min(PICKER_PANEL_WIDTH + 2 * PANEL_MARGIN.side, width);
  const right = anchor.x + anchor.width + PANEL_MARGIN.side;
  const x = Math.max(0, Math.min(right - viewWidth, width - viewWidth));
  const y = anchor.y + anchor.height + PANEL_GAP - PANEL_MARGIN.top;
  const wanted = panelHeight + PANEL_MARGIN.top + PANEL_MARGIN.bottom;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(viewWidth), height: Math.round(Math.max(0, Math.min(wanted, height - y))) };
}

module.exports = { MAC_TITLE_STRIP_HEIGHT, titleBarColor, macAppViewBounds, PICKER_PANEL_WIDTH, pickerPanelBounds };
