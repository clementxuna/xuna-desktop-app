'use strict';

// src/preload.js, run with stand-ins for Electron and the browser: the page's storage, its requests,
// and the main process at the other end of each message. The hook it installs "in the page" runs on
// the stand-ins directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const ACTIVE = 'xuna_active_workspace_id';
const PREFIXES = [ACTIVE, 'xuna_branding_workspace_id', 'xuna_sidebar_selected_agency:', 'xuna_sidebar_selected_client:'];

// Fresh classes for every run, since the hook changes their prototypes as it would the page's.
function makeBrowser() {
  class FakeStorage {
    constructor(entries = {}) {
      this.entries = new Map(Object.entries(entries));
    }
    get length() {
      return this.entries.size;
    }
    key(index) {
      return [...this.entries.keys()][index] ?? null;
    }
    getItem(key) {
      return this.entries.has(key) ? this.entries.get(key) : null;
    }
    setItem(key, value) {
      this.entries.set(String(key), String(value));
    }
    removeItem(key) {
      this.entries.delete(key);
    }
  }

  class FakeXhr {
    constructor() {
      this.listeners = [];
      this.status = 0;
      this.responseType = '';
      this.responseText = '';
    }
    open(method, url) {
      this.request = `${method} ${url}`;
    }
    send() {}
    addEventListener(type, listener) {
      if (type === 'load') this.listeners.push(listener);
    }
    // What the browser does when the answer has arrived.
    answer(status, text) {
      this.status = status;
      this.responseText = text;
      for (const listener of this.listeners) listener();
    }
  }
  return { FakeStorage, FakeXhr };
}

// <html>: its attributes and its inline style's properties.
function fakeRoot() {
  const attributes = new Set();
  const properties = new Map();
  return {
    attributes,
    properties,
    hasAttribute: (name) => attributes.has(name),
    toggleAttribute: (name, force) => {
      const on = force ?? !attributes.has(name);
      if (on) attributes.add(name);
      else attributes.delete(name);
      return on;
    },
    style: {
      getPropertyValue: (name) => properties.get(name) ?? '',
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
  };
}

// seed: what the main process answers for this page (see xuna:workspace-memory in src/main.js).
// askButton: XUNA's header Ask AI button as the page has it, or null for a page without one.
// page: a page with XUNA's header (see xunaPage), or null for one without.
function runPreload({ seed, shared = {}, failHook = false, askButton = null, page = null } = {}) {
  const sent = [];
  const ipcListeners = {};
  const observers = [];
  const documentListeners = {};
  const root = fakeRoot();
  const globals = ['window', 'Storage', 'XMLHttpRequest', 'document', 'MutationObserver', 'getComputedStyle'];
  const saved = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const { FakeStorage, FakeXhr } = makeBrowser();
  const localStorage = new FakeStorage(shared);
  const fetched = [];
  const listeners = {};
  globalThis.Storage = FakeStorage;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.document = {
    documentElement: root,
    body: page?.body ?? null,
    querySelector: (selector) => {
      if (selector === 'button[aria-label="Ask AI"]') return askButton;
      if (selector === 'a[aria-label="Go to home"]') return page?.logo ?? null;
      return null;
    },
    elementFromPoint: (x, y) => page?.at(x, y) ?? null,
    addEventListener: (type, listener) => (documentListeners[type] ??= []).push(listener),
  };
  globalThis.MutationObserver = class {
    constructor(callback) {
      observers.push(callback);
    }
    observe() {}
  };
  globalThis.getComputedStyle = (element) => ({ colorScheme: 'normal', getPropertyValue: (name) => element?.cssVariables?.[name] ?? '', ...element?.computed });
  globalThis.window = {
    localStorage,
    innerWidth: page?.innerWidth ?? 1280,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
    fetch: async () => ({ status: 200, clone: () => ({ text: async () => fetched.shift() ?? '' }) }),
  };
  const electron = {
    contextBridge: {
      exposeInMainWorld() {},
      executeInMainWorld({ func, args }) {
        if (failHook) throw new Error('no main world');
        return func(...args);
      },
    },
    ipcRenderer: {
      sendSync: (channel) => (channel === 'xuna:workspace-memory' ? seed : undefined),
      send: (channel, ...args) => sent.push([channel, ...args]),
      on: (channel, listener) => (ipcListeners[channel] ??= []).push(listener),
      invoke: async () => null,
    },
  };
  const load = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? electron : load.call(this, request, ...rest);
  };
  const file = path.join(__dirname, '..', 'src', 'preload.js');
  delete require.cache[file];
  try {
    require(file);
  } finally {
    Module._load = load;
  }
  const restore = () => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  const dispatch = (type, event) => (listeners[type] ?? []).forEach((listener) => listener(event));
  const fromMain = (channel, ...args) => (ipcListeners[channel] ?? []).forEach((listener) => listener({}, ...args));
  const mutate = () => observers.forEach((callback) => callback([]));
  return { sent, localStorage, page: globalThis.window, root, fetched, dispatch, fromMain, mutate, restore };
}

const tabSeed = (values, remembered = values?.[ACTIVE] ?? null, report = true) => ({ prefixes: PREFIXES, activeKey: ACTIVE, values, remembered, report });

test('a page outside a workspace tab keeps the shared storage', (t) => {
  const run = runPreload({ seed: null, shared: { [ACTIVE]: 'ws-shared' } });
  t.after(run.restore);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-shared');
  run.localStorage.setItem(ACTIVE, 'ws-new');
  assert.equal(run.localStorage.entries.get(ACTIVE), 'ws-new');
  assert.deepEqual(run.sent, []);
});

test("a tab's page reads its own workspace, not the one the profile shares", (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab', [`${ACTIVE}:explicit`]: '1' }), shared: { [ACTIVE]: 'ws-shared' } });
  t.after(run.restore);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-tab');
  assert.equal(run.localStorage.getItem(`${ACTIVE}:explicit`), '1');
});

test('what the page writes stays in its tab, and the main process is told', (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), shared: { [ACTIVE]: 'ws-shared' } });
  t.after(run.restore);
  run.localStorage.setItem(ACTIVE, 'ws-2');
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-2');
  assert.equal(run.localStorage.entries.get(ACTIVE), 'ws-shared'); // the other tabs' storage is untouched
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-write'), [['xuna:workspace-memory-write', ACTIVE, 'ws-2']]);
});

test('signing out removes the workspace, but the page is still offered it as a hint', (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab', [`${ACTIVE}:explicit`]: '1' }) });
  t.after(run.restore);
  run.localStorage.removeItem(ACTIVE);
  run.localStorage.removeItem(`${ACTIVE}:explicit`);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-tab');
  assert.equal(run.localStorage.getItem(`${ACTIVE}:explicit`), null); // a hint, not a deliberate choice
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-write').map((message) => message[2]), [null, null]);
});

test('every other key goes to the shared storage, as before', (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), shared: { 'ui-theme': 'light' } });
  t.after(run.restore);
  run.localStorage.setItem('ui-theme', 'dark');
  assert.equal(run.localStorage.entries.get('ui-theme'), 'dark');
  assert.equal(run.localStorage.getItem('ui-theme'), 'dark');
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-write'), []);
});

test('a tab with no memory yet starts from what the profile had, and hands it to the main process', (t) => {
  const run = runPreload({ seed: tabSeed(null, null), shared: { [ACTIVE]: 'ws-old', 'xuna_sidebar_selected_agency:uid': 'a1', 'ui-theme': 'dark' } });
  t.after(run.restore);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-old');
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-init'), [
    ['xuna:workspace-memory-init', { [ACTIVE]: 'ws-old', 'xuna_sidebar_selected_agency:uid': 'a1' }],
  ]);
});

test("the page's first read of its workspace is reported once, for the guard", (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }) });
  t.after(run.restore);
  run.localStorage.getItem('xuna_branding_workspace_id');
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-read'), []);
  run.localStorage.getItem(ACTIVE);
  run.localStorage.getItem(ACTIVE);
  assert.deepEqual(run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-read'), [['xuna:workspace-memory-read']]);
});

test("a pop-up reads its tab's workspace and keeps its own writes to itself", (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }, 'ws-tab', false) });
  t.after(run.restore);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-tab');
  run.localStorage.setItem(ACTIVE, 'ws-other');
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-other');
  assert.deepEqual(run.sent, []);
});

test("XUNA's sign-in answers are passed on, whether they come by XMLHttpRequest or fetch", async (t) => {
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }) });
  t.after(run.restore);
  const lists = () => run.sent.filter(([channel]) => channel === 'xuna:workspace-list').map((message) => message[1]);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'https://api.xuna.ai/v2/auth/bootstrap');
  xhr.send('{}');
  xhr.answer(200, '{"data":{"accessList":[]}}');
  const other = new XMLHttpRequest();
  other.open('GET', 'https://api.xuna.ai/v2/users/me');
  other.send();
  other.answer(200, '{"user":{}}');
  const refused = new XMLHttpRequest();
  refused.open('POST', 'https://api.xuna.ai/v2/auth/bootstrap');
  refused.send('{}');
  refused.answer(403, '{"error":{}}');
  assert.deepEqual(lists(), ['{"data":{"accessList":[]}}']);

  run.fetched.push('{"from":"fetch"}');
  await run.page.fetch('https://api.xuna.ai/v2/auth/bootstrap', { method: 'POST' });
  await new Promise((resolve) => setImmediate(resolve));
  await run.page.fetch('https://api.xuna.ai/v2/auth/bootstrap'); // a GET is not the sign-in check
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lists(), ['{"data":{"accessList":[]}}', '{"from":"fetch"}']);
});

test('if the hook cannot be installed, the page still loads, and the failure is logged', (t) => {
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), shared: { [ACTIVE]: 'ws-shared' }, failHook: true });
  t.after(run.restore);
  assert.equal(run.localStorage.getItem(ACTIVE), 'ws-shared');
  assert.deepEqual(logged, ['[workspace tabs] Error: no main world']);
});

test('a page back from the back/forward cache says again that it reads its workspace, for the guard', (t) => {
  // It starts no new preload, and the page shown meanwhile reset the guard (see createIsolationGuard).
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }) });
  t.after(run.restore);
  const reads = () => run.sent.filter(([channel]) => channel === 'xuna:workspace-memory-read').length;
  run.dispatch('pageshow', { persisted: true });
  assert.equal(reads(), 0); // it never read its workspace, so it has nothing to report
  run.localStorage.getItem(ACTIVE);
  run.dispatch('pageshow', { persisted: false }); // an ordinary load
  run.dispatch('pageshow', { persisted: true });
  assert.equal(reads(), 2);
});

// XUNA's header button: pressing it opens or closes the assistant, which aria-pressed says.
function xunaAskButton() {
  const orb = { cssVariables: { '--c1': '#6232FF', '--c2': '#2849FF', '--c3': 'color-mix(in oklab, #6232FF 62%, #2849FF)', '--c4': 'color-mix(in oklab, #2849FF 68%, white)' } };
  const button = {
    disabled: false,
    pressed: 'false',
    clicks: 0,
    getAttribute: (name) => (name === 'aria-pressed' ? button.pressed : null),
    querySelector: (selector) => (selector === '.siri-orb' ? orb : null),
    click() {
      button.clicks += 1;
      button.pressed = button.pressed === 'true' ? 'false' : 'true';
    },
  };
  return button;
}
const askStates = (run) => run.sent.filter(([channel]) => channel === 'xuna:ask-ai-state').map((message) => message[1]);

test("a tab's page says whether XUNA's Ask AI is there and open, with the orb's colours, for the strip's own", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const button = xunaAskButton();
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), askButton: button });
  t.after(run.restore);
  run.dispatch('DOMContentLoaded');
  const colors = ['#6232FF', '#2849FF', 'color-mix(in oklab, #6232FF 62%, #2849FF)', 'color-mix(in oklab, #2849FF 68%, white)'];
  assert.deepEqual(askStates(run), [{ available: true, open: false, colors }]);
  button.pressed = 'true'; // opened from the page itself
  run.mutate();
  t.mock.timers.tick(250);
  assert.deepEqual(askStates(run).at(-1), { available: true, open: true, colors });
  run.mutate(); // nothing changed, so nothing more is said
  t.mock.timers.tick(250);
  assert.equal(askStates(run).length, 2);
});

test("the strip's Ask AI presses XUNA's own button in the page, so the assistant opens as it does there", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const button = xunaAskButton();
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), askButton: button });
  t.after(run.restore);
  run.dispatch('DOMContentLoaded');
  run.fromMain('xuna:ask-ai-toggle');
  assert.equal(button.clicks, 1);
  t.mock.timers.tick(250);
  assert.equal(askStates(run).at(-1).open, true);
});

test("a page without XUNA's Ask AI says so, and a pop-up stays out of it", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bare = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }) });
  bare.dispatch('DOMContentLoaded');
  assert.deepEqual(askStates(bare), [{ available: false, open: false, colors: null }]);
  bare.fromMain('xuna:ask-ai-toggle'); // nothing to press
  t.mock.timers.tick(250);
  assert.equal(askStates(bare).length, 1);
  bare.restore();
  const popup = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }, 'ws-tab', false), askButton: xunaAskButton() });
  t.after(popup.restore);
  popup.dispatch('DOMContentLoaded');
  assert.deepEqual(askStates(popup), []);
});

// A stand-in for an element: its box in the page, its children, and what getComputedStyle gives for it.
function box(tagName, rect, { children = [], computed = {} } = {}) {
  const node = {
    tagName,
    children,
    computed,
    parentElement: null,
    attributes: new Set(),
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    setAttribute: (name) => node.attributes.add(name),
    removeAttribute: (name) => node.attributes.delete(name),
    contains: (other) => other === node || children.some((child) => child.contains(other)),
    closest: (selector) => {
      for (let at = node; at; at = at.parentElement) if (at.tagName.toLowerCase() === selector) return at;
      return null;
    },
  };
  for (const child of children) child.parentElement = node;
  return node;
}

// XUNA's header in a 1280-wide page, as the live app lays it out: its home link at the left, its controls
// from the workspace switcher to the avatar at the right, the mobile menu button among them hidden. What
// lies at any point of the header's mid-line is the header's own controls, until something covers them.
function xunaPage({ top = 0, width = 1280 } = {}) {
  const logo = box('A', { left: 22, top: 18, width: 80, height: 20 });
  const left = box('DIV', { left: 24, top: 18, width: 78, height: 20 }, { children: [logo] });
  const right = box('DIV', { left: 776, top: 12, width: 480, height: 32 }, {
    children: [
      box('BUTTON', { left: 776, top: 12, width: 180, height: 32 }), // the workspace switcher
      box('BUTTON', { left: 0, top: 0, width: 0, height: 0 }), // the mobile menu button, hidden
      box('BUTTON', { left: 1224, top: 12, width: 32, height: 32 }), // the avatar
    ],
  });
  const header = box('HEADER', { left: 0, top, width, height: 56 }, {
    children: [left, right],
    computed: { paddingLeft: '24px', paddingRight: '24px', columnGap: '8px', backgroundColor: 'rgb(255, 255, 255)', borderBottomWidth: '1px', borderBottomColor: 'rgb(233, 234, 235)', position: 'relative' },
  });
  const body = box('BODY', { left: 0, top: 0, width: 1280, height: 820 }, { children: [header] });
  const page = { logo, header, body, innerWidth: 1280, covering: null, at: () => page.covering ?? right };
  return page;
}
const headerReports = (run) => run.sent.filter(([channel]) => channel === 'xuna:title-bar-header').map((message) => message[1]);

test("a tab's page finds XUNA's header and says how tall it is, the room its contents need, and its colours", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = xunaPage();
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), page });
  t.after(run.restore);
  run.dispatch('DOMContentLoaded');
  // 24 + 24 of padding, the home link's 80, the controls' 480 (the hidden button aside) and one 8px gap
  assert.deepEqual(headerReports(run), [{ height: 56, minWidth: 616, innerWidth: 1280, background: 'rgb(255, 255, 255)', border: 'rgb(233, 234, 235)', cover: null }]);
  assert.ok(page.header.attributes.has('data-xuna-desktop-bar'));
  run.mutate();
  t.mock.timers.tick(250);
  assert.equal(headerReports(run).length, 1); // nothing changed, so nothing more is said
});

test("a page without XUNA's header, or with one anywhere but along the top, has no title bar to offer", () => {
  for (const page of [null, xunaPage({ top: 40 }), xunaPage({ width: 600 })]) {
    const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), page });
    run.dispatch('DOMContentLoaded');
    assert.deepEqual(headerReports(run), [null]);
    run.restore();
  }
});

test("when a XUNA dialog's backdrop covers the header, the page says how it looks, and the header stops dragging the window", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = xunaPage();
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), page });
  t.after(run.restore);
  run.dispatch('DOMContentLoaded');
  page.covering = box('DIV', { left: 0, top: 0, width: 1280, height: 820 }, { computed: { position: 'fixed', backdropFilter: 'blur(16px) saturate(1.25)', backgroundColor: 'rgba(0, 0, 0, 0.1)' } });
  run.mutate();
  t.mock.timers.tick(250);
  assert.deepEqual(headerReports(run).at(-1).cover, { filter: 'blur(16px) saturate(1.25)', tint: 'rgba(0, 0, 0, 0.1)' });
  assert.ok(run.root.attributes.has('data-xuna-desktop-covered')); // so the dialog takes every click over it
  page.covering = null;
  run.mutate();
  t.mock.timers.tick(250);
  assert.equal(headerReports(run).at(-1).cover, null);
  assert.ok(!run.root.attributes.has('data-xuna-desktop-covered'));
});

test('the room the main process makes for the strip is applied to the page, kept there, and taken away again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }), page: xunaPage() });
  t.after(run.restore);
  run.dispatch('DOMContentLoaded');
  run.fromMain('xuna:title-bar-row', { inset: 184, inactive: true });
  assert.ok(run.root.attributes.has('data-xuna-desktop-row'));
  assert.equal(run.root.properties.get('--xuna-desktop-row-inset'), '184px');
  assert.ok(run.root.attributes.has('data-xuna-desktop-inactive'));
  run.root.properties.clear(); // XUNA's own code resets <html>'s style
  run.mutate();
  t.mock.timers.tick(250);
  assert.equal(run.root.properties.get('--xuna-desktop-row-inset'), '184px');
  run.fromMain('xuna:title-bar-row', null);
  assert.deepEqual([...run.root.attributes], []);
  assert.equal(run.root.properties.size, 0);
  t.mock.timers.tick(250);
});

test('a pop-up offers no title bar', (t) => {
  const popup = runPreload({ seed: tabSeed({ [ACTIVE]: 'ws-tab' }, 'ws-tab', false), page: xunaPage() });
  t.after(popup.restore);
  popup.dispatch('DOMContentLoaded');
  assert.deepEqual(headerReports(popup), []);
});
