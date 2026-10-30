'use strict';

// A page whose renderer crashes, or is killed, loads again: XUNA's own pages, and the Mac title strip
// (see src/main.js). A page that crashes again within ten seconds of reloading is left as it is, rather
// than reloaded over and over. No Electron imports, so it is unit-tested in test/reload-on-crash.test.js.

const RETRY_AFTER_MS = 10_000;

// contents: a page's webContents.
function reloadOnCrash(contents) {
  let lastReload = -Infinity;
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || Date.now() - lastReload < RETRY_AFTER_MS) return;
    lastReload = Date.now();
    contents.reload();
  });
}

module.exports = { reloadOnCrash };
