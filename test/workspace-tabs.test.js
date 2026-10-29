'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_TABS,
  MAX_NAME_LENGTH,
  labelFor,
  readTabs,
  addTab,
  closeTab,
  selectTab,
  cycleTab,
  renameTab,
  moveTab,
  setTabMemory,
  nameWorkspaces,
  tabShowing,
} = require('../src/workspace-tabs');
const { seedFor, applyWrite, ACTIVE_WORKSPACE_KEY } = require('../src/workspace-memory');

const tab = (id, fields = {}) => ({ id, name: null, memory: null, workspaceName: null, ...fields });
const tabs = (...ids) => ids.map((id) => tab(id));

test('a first run, a missing file or a malformed one opens tab 1 alone', () => {
  for (const saved of [null, undefined, 'tabs', 42, {}, { tabs: 'workspace-2' }, { tabs: [] }]) {
    assert.deepEqual(readTabs(saved), { tabs: tabs('workspace-1'), active: 'workspace-1' }, JSON.stringify(saved));
  }
});

test('saved tabs come back in their order, with their names and the one that was shown', () => {
  const saved = { tabs: [{ id: 'workspace-1', name: 'Acme' }, { id: 'workspace-3', name: null }], active: 'workspace-3' };
  assert.deepEqual(readTabs(saved), { tabs: [tab('workspace-1', { name: 'Acme' }), tab('workspace-3')], active: 'workspace-3' });
});

test('a tab saved before tabs kept their workspace has none, so it starts from what the profile had', () => {
  const { tabs: [first] } = readTabs({ tabs: [{ id: 'workspace-2', name: 'Acme' }] });
  assert.equal(first.memory, null);
  assert.equal(first.workspaceName, null);
});

test("a tab's workspace and the workspace's name survive saving and loading", () => {
  const state = addTab(readTabs(null), { memory: seedFor('ws-2'), workspaceName: 'Acme Dental' });
  const reloaded = readTabs(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded, state);
  assert.deepEqual(reloaded.tabs[1].memory, seedFor('ws-2'));
});

test('a saved workspace name is kept short, and anything else is dropped', () => {
  const { tabs: [first, second] } = readTabs({ tabs: [{ id: 'workspace-1', workspaceName: 'x'.repeat(80) }, { id: 'workspace-2', workspaceName: 42 }] });
  assert.equal(first.workspaceName.length, 64);
  assert.equal(second.workspaceName, null);
});

test('saved entries with an id outside the tabs are dropped', () => {
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

test("a tab is called by the name typed for it, else its workspace's name, else its number", () => {
  assert.equal(labelFor(tab('workspace-4', { name: 'Front desk', workspaceName: 'Acme' })), 'Front desk');
  assert.equal(labelFor(tab('workspace-4', { workspaceName: 'Acme' })), 'Acme');
  assert.equal(labelFor(tab('workspace-1')), 'Workspace 1');
  assert.equal(labelFor(tab('workspace-4')), 'Workspace 4');
});

test('a new tab goes after the others, is shown, and takes the lowest free number', () => {
  assert.deepEqual(addTab({ tabs: tabs('workspace-1'), active: 'workspace-1' }), { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-2' });
  assert.deepEqual(addTab({ tabs: tabs('workspace-1', 'workspace-3'), active: 'workspace-1' }), {
    tabs: tabs('workspace-1', 'workspace-3', 'workspace-2'),
    active: 'workspace-2',
  });
});

test('a new tab can open with a workspace picked for it', () => {
  const state = addTab(readTabs(null), { memory: seedFor('ws-7'), workspaceName: 'Acme' });
  assert.deepEqual(state.tabs[1], tab('workspace-2', { memory: seedFor('ws-7'), workspaceName: 'Acme' }));
  assert.equal(state.active, 'workspace-2');
});

test('tab 1 can be closed, and a new tab then takes its number back', () => {
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

test('a tab dragged to another place goes there, the others keep their order, and the shown tab stays shown', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2', 'workspace-3'), active: 'workspace-2' };
  const order = (next) => next.tabs.map((entry) => entry.id);
  assert.deepEqual(order(moveTab(state, 'workspace-1', 2)), ['workspace-2', 'workspace-3', 'workspace-1']);
  assert.deepEqual(order(moveTab(state, 'workspace-3', 0)), ['workspace-3', 'workspace-1', 'workspace-2']);
  assert.equal(moveTab(state, 'workspace-3', 0).active, 'workspace-2');
  assert.deepEqual(order(moveTab(state, 'workspace-1', 99)), ['workspace-2', 'workspace-3', 'workspace-1']); // past the end: last
});

test('a drop where the tab already is, or of a tab that has gone, changes nothing', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  assert.equal(moveTab(state, 'workspace-2', 1), state);
  assert.equal(moveTab(state, 'workspace-9', 0), state);
  assert.equal(moveTab(state, 'workspace-1', -3), state); // before the start: first, where it is
  assert.equal(moveTab(state, 'workspace-1', Number.NaN), state);
});

test('renaming changes only that tab, keeps names short, and an empty name restores the default', () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  const renamed = renameTab(state, 'workspace-2', '  Acme  ');
  assert.deepEqual(renamed.tabs, [tab('workspace-1'), tab('workspace-2', { name: 'Acme' })]);
  assert.equal(renameTab(state, 'workspace-1', 'x'.repeat(80)).tabs[0].name.length, MAX_NAME_LENGTH);
  assert.equal(renameTab(renamed, 'workspace-2', '').tabs[1].name, null);
  assert.equal(renameTab(renamed, 'workspace-2', 42).tabs[1].name, null);
});

test("a tab's workspace memory changes only for that tab", () => {
  const state = { tabs: tabs('workspace-1', 'workspace-2'), active: 'workspace-1' };
  const next = setTabMemory(state, 'workspace-2', seedFor('ws-5'));
  assert.deepEqual(next.tabs[0], tab('workspace-1'));
  assert.deepEqual(next.tabs[1].memory, seedFor('ws-5'));
  assert.equal(setTabMemory(state, 'workspace-9', seedFor('ws-5')), state);
});

test("each tab takes the name of the workspace it shows, and the others keep theirs", () => {
  const state = {
    tabs: [
      tab('workspace-1', { memory: seedFor('ws-1'), workspaceName: 'Old name' }),
      tab('workspace-2', { memory: seedFor('ws-2'), workspaceName: 'Kept' }),
      tab('workspace-3'),
    ],
    active: 'workspace-1',
  };
  const named = nameWorkspaces(state, new Map([['ws-1', 'Acme'], ['ws-9', 'Elsewhere']]));
  assert.deepEqual(named.tabs.map((entry) => entry.workspaceName), ['Acme', 'Kept', null]);
});

test('the tab showing a workspace can be found, the one it last showed included', () => {
  const signedOut = applyWrite(seedFor('ws-2'), ACTIVE_WORKSPACE_KEY, null); // remembered only
  const state = { tabs: [tab('workspace-1', { memory: seedFor('ws-1') }), tab('workspace-2', { memory: signedOut })], active: 'workspace-1' };
  assert.equal(tabShowing(state, 'ws-1'), 'workspace-1');
  assert.equal(tabShowing(state, 'ws-2'), 'workspace-2');
  assert.equal(tabShowing(state, 'ws-3'), null);
  assert.equal(tabShowing({ tabs: tabs('workspace-1'), active: 'workspace-1' }, null), null); // a tab with no workspace yet
});

test('renaming a tab to the name it already shows keeps it following its workspace', () => {
  const long = 'Acme Dental Group of Greater Springfield Clinics'; // longer than a typed name may be
  const state = { tabs: [tab('workspace-1', { workspaceName: 'Acme' }), tab('workspace-2', { workspaceName: long }), tab('workspace-3')], active: 'workspace-1' };
  assert.equal(renameTab(state, 'workspace-1', 'Acme').tabs[0].name, null);
  assert.equal(renameTab(state, 'workspace-2', long).tabs[1].name, null);
  assert.equal(renameTab(state, 'workspace-3', 'Workspace 3').tabs[2].name, null);
  const renamed = renameTab(state, 'workspace-1', ' Acme ');
  assert.equal(labelFor(nameWorkspaces(setTabMemory(renamed, 'workspace-1', seedFor('ws-1')), new Map([['ws-1', 'Beta']])).tabs[0]), 'Beta');
});

test("a tab that moves to another workspace drops the old one's name until it learns the new one", () => {
  const state = { tabs: [tab('workspace-1', { memory: seedFor('ws-1'), workspaceName: 'Acme' })], active: 'workspace-1' };
  const moved = setTabMemory(state, 'workspace-1', applyWrite(seedFor('ws-1'), ACTIVE_WORKSPACE_KEY, 'ws-2'));
  assert.equal(moved.tabs[0].workspaceName, null);
  const signedOut = setTabMemory(state, 'workspace-1', applyWrite(seedFor('ws-1'), ACTIVE_WORKSPACE_KEY, null));
  assert.equal(signedOut.tabs[0].workspaceName, 'Acme'); // still the workspace it last showed
});

test('tabs saved when each had its own sign-in lose the names typed for tabs 2 to 9', () => {
  // Those tabs may have been signed in to other accounts; they now show the shared sign-in's workspace.
  const saved = { tabs: [{ id: 'workspace-1', name: 'Main' }, { id: 'workspace-2', name: 'Client B' }], active: 'workspace-2' };
  assert.deepEqual(readTabs(saved).tabs.map((entry) => entry.name), ['Main', null]);
  const current = { tabs: [{ id: 'workspace-1', name: 'Main', memory: null }, { id: 'workspace-2', name: 'Client B', memory: null }], active: 'workspace-2' };
  assert.deepEqual(readTabs(current).tabs.map((entry) => entry.name), ['Main', 'Client B']);
});
