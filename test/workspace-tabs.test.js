'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TABS,
  MAX_NAME_LENGTH,
  partitionFor,
  labelFor,
  readTabs,
  addTab,
  closeTab,
  selectTab,
  cycleTab,
  renameTab,
} = require('../src/workspace-tabs');

const tabs = (...ids) => ids.map((id) => ({ id, name: null }));

test('tab 1 signs in with the profile the app always used, so nobody is signed out', () => {
  assert.equal(partitionFor('workspace-1'), undefined);
});

test('every other tab signs in with its own persistent profile', () => {
  assert.equal(partitionFor('workspace-2'), 'persist:workspace-2');
  assert.equal(partitionFor('workspace-9'), 'persist:workspace-9');
});

test('a first run, a missing file or a malformed one opens tab 1 alone', () => {
  for (const saved of [null, undefined, 'tabs', 42, {}, { tabs: 'workspace-2' }, { tabs: [] }]) {
    assert.deepEqual(readTabs(saved), { tabs: tabs('workspace-1'), active: 'workspace-1' }, JSON.stringify(saved));
  }
});

test('saved tabs come back in their order, with their names and the one that was shown', () => {
  const saved = { tabs: [{ id: 'workspace-1', name: 'Acme' }, { id: 'workspace-3', name: null }], active: 'workspace-3' };
  assert.deepEqual(readTabs(saved), saved);
});

test('saved entries that could name a profile outside the tabs are dropped', () => {
  const saved = {
    tabs: [
      { id: 'workspace-0' },
      { id: 'workspace-01' },
      { id: 'workspace-10' },
      { id: '../workspace-2' },
      { id: 'workspace-2' },
      { id: 'workspace-2', name: 'again' },
      null,
    ],
    active: 'workspace-10',
  };
  assert.deepEqual(readTabs(saved), { tabs: tabs('workspace-2'), active: 'workspace-2' });
});

test('a saved name is tidied, and a blank one falls back to the default', () => {
  const { tabs: [first, second] } = readTabs({ tabs: [{ id: 'workspace-1', name: '  Acme\n  Dental ' }, { id: 'workspace-2', name: '   ' }] });
  assert.equal(first.name, 'Acme Dental');
  assert.equal(second.name, null);
});

test("a tab's default name is its profile's number", () => {
  assert.equal(labelFor({ id: 'workspace-1', name: null }), 'Workspace 1');
  assert.equal(labelFor({ id: 'workspace-4', name: null }), 'Workspace 4');
  assert.equal(labelFor({ id: 'workspace-4', name: 'Acme' }), 'Acme');
});

test('a new tab goes after the others, is shown, and takes the lowest free profile', () => {
  assert.deepEqual(addTab({ tabs: tabs('workspace-1'), active: 'workspace-1' }), { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-2' });
  // workspace-2 was closed: its profile, and the sign-in in it, is reused.
  assert.deepEqual(addTab({ tabs: tabs('workspace-1', 'workspace-3'), active: 'workspace-1' }), {
    tabs: tabs('workspace-1', 'workspace-3', 'workspace-2'),
    active: 'workspace-2',
  });
});

test('tab 1 can be closed, and a new tab then picks its profile back up', () => {
  const state = closeTab({ tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' }, 'workspace-1');
  assert.deepEqual(state, { tabs: tabs('workspace-2'), active: 'workspace-2' });
  assert.equal(addTab(state).active, 'workspace-1');
});

test('no more tabs open than ⌘1 to ⌘9 can reach', () => {
  let state = readTabs(null);
  while (state.tabs.length < MAX_TABS) state = addTab(state);
  assert.equal(MAX_TABS, 9);
  assert.equal(addTab(state), null);
});

test('closing the tab that is shown shows the next one, or the one before when it was last', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2', 'workspace-3'), active: 'workspace-2' };
  assert.equal(closeTab(state, 'workspace-2').active, 'workspace-3');
  assert.equal(closeTab({ ...state, active: 'workspace-3' }, 'workspace-3').active, 'workspace-2');
});

test('closing a tab in the background leaves the shown one alone', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2', 'workspace-3'), active: 'workspace-3' };
  assert.deepEqual(closeTab(state, 'workspace-1'), { tabs: tabs('workspace-2', 'workspace-3'), active: 'workspace-3' });
});

test('the last tab never closes, and an unknown one changes nothing', () => {
  const alone = { tabs: tabs('workspace-2'), active: 'workspace-2' };
  assert.equal(closeTab(alone, 'workspace-2'), alone);
  const pair = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  assert.equal(closeTab(pair, 'workspace-5'), pair);
});

test('only an open tab can be shown', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  assert.equal(selectTab(state, 'workspace-2').active, 'workspace-2');
  assert.equal(selectTab(state, 'workspace-3'), state);
});

test('stepping through the tabs wraps around at either end', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2', 'workspace-3'), active: 'workspace-3' };
  assert.equal(cycleTab(state, 1).active, 'workspace-1');
  assert.equal(cycleTab(state, -1).active, 'workspace-2');
  assert.equal(cycleTab({ ...state, active: 'workspace-1' }, -1).active, 'workspace-3');
});

test('renaming changes only that tab, keeps names short, and an empty name restores the default', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  const renamed = renameTab(state, 'workspace-2', '  Acme  ');
  assert.deepEqual(renamed.tabs, [{ id: 'workspace-1', name: null }, { id: 'workspace-2', name: 'Acme' }]);
  assert.equal(renameTab(state, 'workspace-1', 'x'.repeat(80)).tabs[0].name.length, MAX_NAME_LENGTH);
  assert.equal(renameTab(renamed, 'workspace-2', '').tabs[1].name, null);
  assert.equal(renameTab(renamed, 'workspace-2', 42).tabs[1].name, null);
});
