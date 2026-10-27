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

// Where the XUNA page goes in a Mac window with this content size: below the strip, or the whole window
// in full screen, where macOS shows the buttons over the page only while the pointer is at the top.
function macAppViewBounds({ width, height, fullScreen }) {
  const top = fullScreen ? 0 : MAC_TITLE_STRIP_HEIGHT;
  return { x: 0, y: top, width: Math.max(0, width), height: Math.max(0, height - top) };
}

module.exports = { MAC_TITLE_STRIP_HEIGHT, titleBarColor, macAppViewBounds };
