'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTIVE_WORKSPACE_KEY,
  TAB_KEY_PREFIXES,
  isTabKey,
  readMemory,
  applyWrite,
  workspaceOf,
  seedFor,
  createIsolationGuard,
  memoryForPage,
} = require('../src/workspace-memory');

const EXPLICIT_KEY = `${ACTIVE_WORKSPACE_KEY}:explicit`;

test("each tab keeps its own copy of the keys where XUNA remembers the current workspace", () => {
  assert.equal(ACTIVE_WORKSPACE_KEY, 'xuna_active_workspace_id');
  for (const key of [
    'xuna_active_workspace_id',
    'xuna_active_workspace_id:explicit', // a deliberate switch, re-sent on the next sign-in check
    'xuna_active_workspace_id:client.example.com', // a custom domain's own memory
    'xuna_branding_workspace_id',
    'xuna_sidebar_selected_agency:uid-1', // what XUNA's switcher has selected
    'xuna_sidebar_selected_client:uid-1',
  ]) {
    assert.equal(isTabKey(key), true, key);
  }
  assert.equal(TAB_KEY_PREFIXES.length, 4);
});

test('every other key stays shared, since it is a setting or already names its workspace', () => {
  for (const key of ['ui-theme', 'xuna_workspace_branding:ws-1', 'xuna-dashboard-grid-v2:main', 'xuna-imessage-onboarding:ws-1', 'firebase:authUser:key:[DEFAULT]', '', 'xuna_active']) {
    assert.equal(isTabKey(key), false, key);
  }
});

test('a tab with nothing saved has no memory yet, so it starts from what the profile already had', () => {
  for (const saved of [null, undefined, 'memory', 42, [], { values: 'x' }]) {
    assert.equal(readMemory(saved), null, JSON.stringify(saved));
  }
});

test('a saved memory keeps only the keys a tab may hold, with short text values', () => {
  const saved = {
    values: {
      [ACTIVE_WORKSPACE_KEY]: 'ws-1',
      [EXPLICIT_KEY]: '1',
      'ui-theme': 'dark', // shared, so never a tab's
      xuna_branding_workspace_id: 7, // not text
      'xuna_sidebar_selected_agency:uid-1': 'x'.repeat(257), // too long to be an id
    },
    remembered: 'ws-1',
  };
  assert.deepEqual(readMemory(saved), { values: { [ACTIVE_WORKSPACE_KEY]: 'ws-1', [EXPLICIT_KEY]: '1' }, remembered: 'ws-1' });
  assert.deepEqual(readMemory({ values: {}, remembered: 3 }), { values: {}, remembered: null });
});

test('a saved memory holds at most 32 keys', () => {
  const values = {};
  for (let i = 0; i < 40; i += 1) values[`xuna_sidebar_selected_client:uid-${i}`] = `ws-${i}`;
  assert.equal(Object.keys(readMemory({ values }).values).length, 32);
});

test('what the page writes goes into the tab, and the current workspace is also remembered', () => {
  let memory = applyWrite(null, ACTIVE_WORKSPACE_KEY, 'ws-2');
  memory = applyWrite(memory, EXPLICIT_KEY, '1');
  assert.deepEqual(memory, { values: { [ACTIVE_WORKSPACE_KEY]: 'ws-2', [EXPLICIT_KEY]: '1' }, remembered: 'ws-2' });
  assert.equal(workspaceOf(memory), 'ws-2');
});

test('signing out clears the current workspace, but the tab still knows which one it was', () => {
  // XUNA forgets the workspace when it signs out. The tab offers it again, as a hint only, at the
  // next sign-in, so each tab comes back to its own workspace.
  let memory = seedFor('ws-3');
  memory = applyWrite(memory, ACTIVE_WORKSPACE_KEY, null);
  memory = applyWrite(memory, EXPLICIT_KEY, null);
  assert.deepEqual(memory.values, {});
  assert.equal(memory.remembered, 'ws-3');
  assert.equal(workspaceOf(memory), 'ws-3');
});

test('writes the tab may not hold are ignored', () => {
  const memory = seedFor('ws-1');
  assert.deepEqual(applyWrite(memory, 'ui-theme', 'dark'), memory);
  assert.deepEqual(applyWrite(memory, ACTIVE_WORKSPACE_KEY, 'x'.repeat(300)), memory);
  assert.deepEqual(applyWrite(memory, ACTIVE_WORKSPACE_KEY, 5), memory);
});

test('a workspace picked from the menu opens as a deliberate choice, as a switcher click does', () => {
  assert.deepEqual(seedFor('ws-9'), { values: { [ACTIVE_WORKSPACE_KEY]: 'ws-9', [EXPLICIT_KEY]: '1' }, remembered: 'ws-9' });
});

test('a tab that knows no workspace has none', () => {
  assert.equal(workspaceOf(null), null);
  assert.equal(workspaceOf({ values: {}, remembered: null }), null);
});

// A guard whose timers run only when the test says so.
function guardWithClock() {
  const timers = [];
  let trips = 0;
  const guard = createIsolationGuard({ onBroken: () => (trips += 1), schedule: (run, wait) => timers.push({ run, wait }) });
  const elapse = () => {
    for (const timer of timers.splice(0)) timer.run();
  };
  return { guard, timers, elapse, trips: () => trips };
}

test("the guard trips when a page's sign-in check completes and the page still hasn't read its workspace soon after", () => {
  // XUNA reads the remembered workspace before every request, the sign-in check included. A page that
  // never does has stopped using the key each tab keeps for itself, so tabs could mix up workspaces.
  const { guard, timers, elapse, trips } = guardWithClock();
  guard.pageStarted(7);
  guard.bootstrapCompleted(7);
  assert.equal(trips(), 0);
  assert.equal(timers[0].wait, 5000);
  elapse();
  assert.equal(trips(), 1);
});

test('a read that arrives just after the check completed keeps the guard quiet', () => {
  // The read and the completed request reach the main process by different routes.
  const { guard, elapse, trips } = guardWithClock();
  guard.pageStarted(7);
  guard.bootstrapCompleted(7);
  guard.pageRead(7);
  elapse();
  assert.equal(trips(), 0);
});

test('a page that read its workspace first is not checked again', () => {
  const { guard, timers } = guardWithClock();
  guard.pageStarted(7);
  guard.pageRead(7);
  guard.bootstrapCompleted(7);
  assert.equal(timers.length, 0);
});

test("an old page's sign-in check finishing after a reload doesn't trip the guard", () => {
  const { guard, elapse, trips } = guardWithClock();
  guard.pageStarted(7);
  guard.pageRead(7);
  guard.pageStarted(7); // the reload
  guard.bootstrapCompleted(7); // the old page's check
  guard.pageRead(7); // the new page reads as it starts
  elapse();
  guard.pageStarted(7);
  guard.bootstrapCompleted(7);
  guard.pageStarted(7); // another reload before the check is looked at
  elapse();
  assert.equal(trips(), 0);
});

test('each new page in a tab has to read its workspace again', () => {
  const { guard, elapse, trips } = guardWithClock();
  guard.pageStarted(7);
  guard.pageRead(7);
  guard.pageStarted(7);
  guard.bootstrapCompleted(7);
  elapse();
  assert.equal(trips(), 1);
});

test('the guard ignores pages it was never told about', () => {
  const { guard, timers } = guardWithClock();
  guard.pageRead(8);
  guard.bootstrapCompleted(9);
  assert.equal(timers.length, 0);
});

test("a tab's own page reads and writes its tab's memory", () => {
  assert.deepEqual(memoryForPage({ ownTab: seedFor('ws-1'), frontTab: seedFor('ws-2') }), { memory: seedFor('ws-1'), report: true });
  assert.deepEqual(memoryForPage({ ownTab: null }), { memory: null, report: true }); // a tab with no memory yet
});

test('a pop-up reads the tab it was opened from, even with another tab in front and no opener link', () => {
  // An OAuth return can load in the pop-up long after it opened, once the user has moved to another tab.
  assert.deepEqual(memoryForPage({ openedFrom: seedFor('ws-1'), openerTab: undefined, frontTab: seedFor('ws-2') }), { memory: seedFor('ws-1'), report: false });
});

test("a pop-up with no record reads its opener's tab, and failing that the tab in front", () => {
  assert.deepEqual(memoryForPage({ openerTab: seedFor('ws-3'), frontTab: seedFor('ws-2') }), { memory: seedFor('ws-3'), report: false });
  assert.deepEqual(memoryForPage({ frontTab: seedFor('ws-2') }), { memory: seedFor('ws-2'), report: false });
});

test('a page with no tab to go by keeps the shared storage', () => {
  assert.equal(memoryForPage({}), null);
});
