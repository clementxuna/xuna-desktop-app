'use strict';

// Tells the main process which theme the page is showing, so the window's title bar can match it.
// XUNA switches theme by setting the color-scheme of <html>, which is all this reads.
//
// It runs isolated from the page and gives it one function, window.xunaDesktop.getPushRegistration(),
// which resolves to where XUNA's servers can send this Mac push notifications:
// { platform: 'macos', token, topic, environment }, or null on Windows, in development runs, if Apple
// refused, or for pages outside xuna.ai (the main process checks).
//
// In a Mac workspace tab, and in pop-ups a tab opens, it also gives the page the tab's own copy of the
// storage keys where XUNA remembers the current workspace (see src/workspace-memory.js), and passes on
// XUNA's sign-in answers, which list the account's workspaces for the + menu (src/workspace-picker.js).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xunaDesktop', {
  getPushRegistration: () => ipcRenderer.invoke('xuna:push-registration'),
});

// null for a page that keeps the profile's shared storage: anything outside a workspace tab.
const workspace = ipcRenderer.sendSync('xuna:workspace-memory');
if (workspace) keepWorkspaceInTab(workspace);

// prefixes: the keys a tab keeps for itself. values: the tab's copy, or null for a tab that has none
// yet, which starts from what the profile holds. report: false for a pop-up, whose writes stay its own.
function keepWorkspaceInTab({ prefixes, activeKey, values, remembered: rememberedAtStart, report }) {
  const isTabKey = (key) => prefixes.some((prefix) => key.startsWith(prefix));
  let memory = values;
  let remembered = rememberedAtStart;
  if (!memory) {
    memory = {};
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key !== null && isTabKey(key)) memory[key] = window.localStorage.getItem(key);
      }
    } catch {} // storage this page may not use
    remembered = memory[activeKey] ?? null;
    if (report) ipcRenderer.send('xuna:workspace-memory-init', memory);
  }

  let readReported = false;
  const read = (key) => {
    if (key === activeKey && !readReported) {
      readReported = true;
      if (report) ipcRenderer.send('xuna:workspace-memory-read'); // see createIsolationGuard
    }
    // After signing out, the workspace the tab showed is still offered, as a hint for the next sign-in.
    return memory[key] ?? (key === activeKey ? remembered : null);
  };
  const write = (key, value) => {
    if (value === null) delete memory[key];
    else memory[key] = value;
    if (key === activeKey && value !== null) remembered = value;
    if (report) ipcRenderer.send('xuna:workspace-memory-write', key, value);
  };
  const workspacesListed = (responseText) => ipcRenderer.send('xuna:workspace-list', responseText);
  // A page back from the back/forward cache starts no new preload, but the page shown meanwhile reset the
  // guard, so it says again that it reads its workspace.
  if (report) {
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && readReported) ipcRenderer.send('xuna:workspace-memory-read');
    });
  }

  try {
    contextBridge.executeInMainWorld({ func: hookPage, args: [prefixes, read, write, workspacesListed] });
  } catch (error) {
    console.error('[workspace tabs]', error); // the page still works, with the shared storage
  }
}

// Runs in the page itself, before its scripts, so it is serialized: it may use only its arguments and
// the page's globals. The page's tab keys go to its tab (read and write cross back into this preload);
// every other key, and sessionStorage, go where they always did.
function hookPage(prefixes, read, write, workspacesListed) {
  const local = window.localStorage;
  const isTabKey = (key) => prefixes.some((prefix) => key.startsWith(prefix));
  const storage = Storage.prototype;
  const { getItem, setItem, removeItem } = storage;
  storage.getItem = function (key) {
    return this === local && isTabKey(String(key)) ? read(String(key)) : getItem.call(this, key);
  };
  storage.setItem = function (key, value) {
    if (this === local && isTabKey(String(key))) write(String(key), String(value));
    else setItem.call(this, key, value);
  };
  storage.removeItem = function (key) {
    if (this === local && isTabKey(String(key))) write(String(key), null);
    else removeItem.call(this, key);
  };

  // XUNA's sign-in check, whose answer lists the account's workspaces. XUNA makes it with
  // XMLHttpRequest today; fetch is watched too, in case that changes.
  const isSignInCheck = (method, url) => String(method).toUpperCase() === 'POST' && /\/v2\/auth\/bootstrap(?:[?#]|$)/.test(String(url));
  const succeeded = (status) => status >= 200 && status < 300;
  const checks = new WeakSet();
  const { open, send } = XMLHttpRequest.prototype;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isSignInCheck(method, url)) checks.add(this);
    else checks.delete(this);
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (checks.has(this)) {
      this.addEventListener('load', () => {
        if (!succeeded(this.status)) return;
        if (this.responseType === '' || this.responseType === 'text') workspacesListed(this.responseText);
        else if (this.responseType === 'json') workspacesListed(JSON.stringify(this.response));
      });
    }
    return send.apply(this, args);
  };
  const pageFetch = window.fetch;
  window.fetch = function (input, init) {
    const pending = pageFetch.apply(this === undefined ? window : this, arguments);
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (isSignInCheck(init?.method ?? input?.method ?? 'GET', url)) {
      pending.then((response) => {
        if (succeeded(response.status)) response.clone().text().then(workspacesListed, () => {});
      }, () => {});
    }
    return pending;
  };
}

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
