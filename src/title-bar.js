'use strict';

// Picks the window title bar colour from the theme the page reports (see src/preload.js), so the bar
// matches the app beneath it: black in dark mode, white in light mode. No Electron imports, so it is
// unit-tested in test/title-bar.test.js.

const { BACKGROUND } = require('./config');

// report: { colorScheme: the page's computed CSS color-scheme, prefersDark: Windows is in dark mode }
function titleBarColor(report) {
  const tokens = typeof report?.colorScheme === 'string' ? report.colorScheme.trim().split(/\s+/) : [];
  const dark = tokens.includes('dark');
  const light = tokens.includes('light');
  if (dark !== light) return dark ? BACKGROUND.dark : BACKGROUND.light;
  return report?.prefersDark === true ? BACKGROUND.dark : BACKGROUND.light;
}

module.exports = { titleBarColor };
