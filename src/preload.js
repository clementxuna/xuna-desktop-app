'use strict';

// Tells the main process which theme the page is showing, so the window's title bar can match it.
// XUNA switches theme by setting the color-scheme of <html>, which is all this reads.
//
// It runs isolated from the page and gives it one function, window.xunaDesktop.getPushRegistration(),
// which resolves to where XUNA's servers can send this Mac push notifications:
// { platform: 'macos', token, topic, environment }, or null on Windows, in development runs, if Apple
// refused, or for pages outside xuna.ai (the main process checks).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xunaDesktop', {
  getPushRegistration: () => ipcRenderer.invoke('xuna:push-registration'),
});

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
