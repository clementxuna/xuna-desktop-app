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

// seed: what the main process answers for this page (see xuna:workspace-memory in src/main.js).
function runPreload({ seed, shared = {}, failHook = false } = {}) {
  const sent = [];
  const globals = ['window', 'Storage', 'XMLHttpRequest'];
  const saved = Object.fromEntries(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const { FakeStorage, FakeXhr } = makeBrowser();
  const localStorage = new FakeStorage(shared);
  const fetched = [];
  globalThis.Storage = FakeStorage;
  globalThis.XMLHttpRequest = FakeXhr;
  globalThis.window = {
    localStorage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
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
  return { sent, localStorage, page: globalThis.window, fetched, restore };
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
