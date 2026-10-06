'use strict';

// Tells the main process which theme the page is showing, so the window's title bar can match it.
// It runs isolated from the page and exposes nothing to it. XUNA switches theme by setting the
// color-scheme of <html>, which is all this reads.

const { ipcRenderer } = require('electron');

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let lastReport = '';

function report() {
  const appearance = {
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    prefersDark: darkQuery.matches,
  };
  const serialized = JSON.stringify(appearance);
  if (serialized === lastReport) return;
  lastReport = serialized;
  ipcRenderer.send('xuna:page-appearance', appearance);
}

window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  report();
});
darkQuery.addEventListener('change', report);
