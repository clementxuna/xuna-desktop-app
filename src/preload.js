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
if (workspace?.report) {
  watchAskAi();
  watchHeader();
}

// XUNA redraws often, so its page is looked at again at most five times a second: the function this
// returns asks for a look, which happens 200ms after the first ask.
function throttled(look) {
  let waiting = false;
  return () => {
    if (waiting) return;
    waiting = true;
    setTimeout(() => {
      waiting = false;
      look();
    }, 200);
  };
}

// In one row the tab's XUNA page fills the window and XUNA's own header is its title bar (see
// macWindowLayout in src/title-bar.js, and src/one-row.css). This finds the header and tells the main
// process how tall it is and how much room its contents need, in CSS pixels; the page's width in them,
// which gives its zoom; its colours; and how anything covering it looks. It applies the room the main
// process makes at the header's start for the strip, and the fade while the window isn't in front.
function watchHeader() {
  let header = null;
  let row = null; // the main process's word: { inset, inactive } in one row, null otherwise
  let covered = false;
  let last = '';
  const report = () => {
    const found = findHeader();
    if (found !== header) {
      header?.removeAttribute('data-xuna-desktop-bar');
      header = found;
      header?.setAttribute('data-xuna-desktop-bar', '');
    }
    const state = header ? describeHeader(header) : null;
    covered = Boolean(state?.cover);
    applyRow(row, covered); // each time, in case XUNA's own code took it away
    const serialized = JSON.stringify(state);
    if (serialized === last) return;
    last = serialized;
    ipcRenderer.send('xuna:title-bar-header', state);
  };
  const soon = throttled(report);
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    report();
  });
  window.addEventListener('resize', soon);
  document.addEventListener('load', soon, true); // a workspace's logo arriving changes the room the header needs
  ipcRenderer.on('xuna:title-bar-row', (_event, next) => {
    row = next && Number.isFinite(next.inset) ? { inset: next.inset, inactive: next.inactive === true } : null;
    applyRow(row, covered);
    soon();
  });
}

// XUNA's header: the one holding its home link, along the top of the page and reaching its right edge
// (in one row it starts where the strip ends). Any other is not taken for the title bar.
function findHeader() {
  const candidate = document.querySelector('a[aria-label="Go to home"]')?.closest('header');
  if (!candidate) return null;
  const box = candidate.getBoundingClientRect();
  const along = Math.abs(box.top) <= 1 && box.height >= 40 && box.height <= 80;
  const across = box.right >= window.innerWidth - 1 && box.width >= window.innerWidth / 2;
  return along && across ? candidate : null;
}

function describeHeader(header) {
  const box = header.getBoundingClientRect();
  const style = getComputedStyle(header);
  const px = (value) => Number.parseFloat(value) || 0;
  const parts = [...header.children].map(contentWidth).filter((width) => width > 0);
  const contents = parts.reduce((sum, width) => sum + width, 0) + px(style.columnGap) * Math.max(0, parts.length - 1);
  return {
    height: box.height,
    minWidth: Math.ceil(px(style.paddingLeft) + px(style.paddingRight) + contents),
    innerWidth: window.innerWidth,
    background: style.backgroundColor,
    border: px(style.borderBottomWidth) > 0 ? style.borderBottomColor : null,
    cover: coverOf(header, box),
  };
}

// The room a part of the header needs: the span of what shows in it, or its own width.
function contentWidth(part) {
  const boxes = [...part.children].map((child) => child.getBoundingClientRect()).filter((box) => box.width > 0);
  if (boxes.length === 0) return part.getBoundingClientRect().width;
  return Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left));
}

// Whatever covers the header from outside it, as the blurred backdrop behind a XUNA dialog does: how its
// layer looks, so the strip can look the same, or null when nothing does.
function coverOf(header, box) {
  const y = box.top + box.height / 2;
  const hits = [0.25, 0.5, 0.75].map((share) => document.elementFromPoint(box.left + box.width * share, y));
  if (!hits.every((hit) => hit && !header.contains(hit))) return null;
  let layer = hits[1];
  while (layer && layer !== document.body && getComputedStyle(layer).position !== 'fixed') layer = layer.parentElement;
  if (!layer || layer === document.body) return { filter: null, tint: null };
  const style = getComputedStyle(layer);
  return { filter: style.backdropFilter && style.backdropFilter !== 'none' ? style.backdropFilter : null, tint: style.backgroundColor };
}

// The main process's row, on <html>: the room made at the header's start, the fade, and whether something
// covers the header (then it doesn't drag the window). Only what differs is written, since each write is
// a change the page's observers see.
function applyRow(row, covered) {
  const root = document.documentElement;
  if (!root) return;
  const toggle = (name, on) => {
    if (root.hasAttribute(name) !== on) root.toggleAttribute(name, on);
  };
  const inset = row ? `${row.inset}px` : '';
  toggle('data-xuna-desktop-row', Boolean(row));
  if (root.style.getPropertyValue('--xuna-desktop-row-inset') !== inset) {
    if (row) root.style.setProperty('--xuna-desktop-row-inset', inset);
    else root.style.removeProperty('--xuna-desktop-row-inset');
  }
  toggle('data-xuna-desktop-inactive', Boolean(row?.inactive));
  toggle('data-xuna-desktop-covered', covered);
}

// The strip's Ask AI presses XUNA's own, in the header of the tab in front (see src/title-strip.js), so
// the assistant opens as it does from there. This tells the main process whether the tab's page has
// that button to press, whether the assistant is open, and the colours of its orb, which follow the
// workspace's branding.
function watchAskAi() {
  const find = () => document.querySelector('button[aria-label="Ask AI"]');
  let last = '';
  const report = () => {
    const button = find();
    const orb = button?.querySelector('.siri-orb');
    const style = orb ? getComputedStyle(orb) : null;
    const colors = style ? ['--c1', '--c2', '--c3', '--c4'].map((name) => style.getPropertyValue(name).trim()) : null;
    const state = { available: Boolean(button) && !button.disabled, open: button?.getAttribute('aria-pressed') === 'true', colors: colors?.every(Boolean) ? colors : null };
    const serialized = JSON.stringify(state);
    if (serialized === last) return;
    last = serialized;
    ipcRenderer.send('xuna:ask-ai-state', state);
  };
  const soon = throttled(report);
  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(soon).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled'] });
    report();
  });
  ipcRenderer.on('xuna:ask-ai-toggle', () => {
    find()?.click();
    soon();
  });
}

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
