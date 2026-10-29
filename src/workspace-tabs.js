'use strict';

// The Mac window's workspace tabs: which are open, which one is shown, what each is called and which
// workspace each shows. No Electron imports, so it is unit-tested in test/workspace-tabs.test.js;
// src/main.js shows each tab as a XUNA page, and the title strip draws the buttons (src/title-strip.js).
//
// Every tab signs in with the one profile the app has always used. Each keeps its own copy of XUNA's
// memory of the current workspace (see src/workspace-memory.js), saved here with the tab, so it opens
// in its own workspace again. Its name is the one typed for it, else its workspace's.

const { readMemory, workspaceOf } = require('./workspace-memory');

const MAX_TABS = 9; // one for each of ⌘1 to ⌘9
const MAX_NAME_LENGTH = 32;
const MAX_WORKSPACE_NAME_LENGTH = 64;
const FIRST_TAB = 'workspace-1';

// 'workspace-3' → 3. Anything else → 0.
function slotOf(id) {
  const match = /^workspace-([1-9]\d*)$/.exec(String(id));
  return match ? Number(match[1]) : 0;
}

// A name typed into the strip, tidied. null when nothing is left, which brings back the default name.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return clean || null;
}

const cleanWorkspaceName = (name) => (typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_WORKSPACE_NAME_LENGTH) : null);

// "Workspace N" only until the tab's workspace is known.
const defaultLabel = (tab) => tab.workspaceName ?? `Workspace ${slotOf(tab.id)}`;

function labelFor(tab) {
  return tab.name ?? defaultLabel(tab);
}

// The saved tabs, as written by src/main.js. Entries that can't be trusted are dropped, and with none
// left the window opens with tab 1 alone.
function readTabs(saved) {
  const entries = Array.isArray(saved?.tabs) ? saved.tabs : [];
  // Tabs saved before they shared a sign-in each had their own, so a name typed for tabs 2 to 9 may
  // name another account's workspace. Tab 1 kept the sign-in it has now.
  const ownSignIns = !entries.some((entry) => entry && typeof entry === 'object' && 'memory' in entry);
  const tabs = [];
  for (const entry of entries) {
    const slot = slotOf(entry?.id);
    if (slot < 1 || slot > MAX_TABS || tabs.some((tab) => tab.id === entry.id)) continue;
    const name = ownSignIns && entry.id !== FIRST_TAB ? null : cleanName(entry.name);
    tabs.push({ id: entry.id, name, memory: readMemory(entry.memory), workspaceName: cleanWorkspaceName(entry.workspaceName) });
  }
  if (tabs.length === 0) tabs.push(newTab(FIRST_TAB));
  const active = tabs.some((tab) => tab.id === saved?.active) ? saved.active : tabs[0].id;
  return { tabs, active };
}

// memory: the tab's copy of XUNA's workspace memory, null until its page has one.
function newTab(id, { memory = null, workspaceName = null } = {}) {
  return { id, name: null, memory, workspaceName };
}

// Adds a tab after the others and shows it, with the lowest number no open tab is using. A tab for a
// workspace picked from the menu starts with that workspace (seedFor in src/workspace-memory.js).
// Returns null when the window already has as many tabs as it can take.
function addTab(state, options) {
  if (state.tabs.length >= MAX_TABS) return null;
  let slot = 1;
  while (state.tabs.some((tab) => slotOf(tab.id) === slot)) slot += 1;
  const id = `workspace-${slot}`;
  return { tabs: [...state.tabs, newTab(id, options)], active: id };
}

// Closing the tab that is shown shows the next one along, or the one before it when it was last.
// The last tab left never closes.
function closeTab(state, id) {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0 || state.tabs.length < 2) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const active = state.active === id ? tabs[Math.min(index, tabs.length - 1)].id : state.active;
  return { tabs, active };
}

function selectTab(state, id) {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, active: id } : state;
}

// step: 1 for the next tab, -1 for the one before. It wraps around at either end.
function cycleTab(state, step) {
  const count = state.tabs.length;
  const index = state.tabs.findIndex((tab) => tab.id === state.active);
  return { ...state, active: state.tabs[(((index + step) % count) + count) % count].id };
}

// A tab dragged along the strip to index, its place in the new order: the others keep their order, and
// the tab shown stays shown. ⌘1 to ⌘9 follow the new order.
function moveTab(state, id, index) {
  const from = state.tabs.findIndex((tab) => tab.id === id);
  if (from < 0 || !Number.isFinite(index)) return state;
  const to = Math.max(0, Math.min(Math.trunc(index), state.tabs.length - 1));
  if (to === from) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  tabs.splice(to, 0, state.tabs[from]);
  return { ...state, tabs };
}

// A tab renamed to the name it already shows keeps following its workspace's name.
function renameTab(state, id, name) {
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) return tab;
      const typed = cleanName(name);
      return { ...tab, name: typed === cleanName(defaultLabel(tab)) ? null : typed };
    }),
  };
}

// What the tab's page wrote to its workspace memory (see applyWrite in src/workspace-memory.js). A tab
// that moved to another workspace drops the old one's name until nameWorkspaces knows the new one's.
function setTabMemory(state, id, memory) {
  if (!state.tabs.some((tab) => tab.id === id)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) return tab;
      const moved = workspaceOf(memory) !== workspaceOf(tab.memory);
      return { ...tab, memory, workspaceName: moved ? null : tab.workspaceName };
    }),
  };
}

// names: workspace id → name, for every workspace in XUNA's list of the account's (see parseBootstrap).
// Tabs showing a workspace that isn't listed keep the name they had.
function nameWorkspaces(state, names) {
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      const name = cleanWorkspaceName(names.get(workspaceOf(tab.memory)));
      return name && name !== tab.workspaceName ? { ...tab, workspaceName: name } : tab;
    }),
  };
}

// The first tab showing this workspace, or the one that last showed it, if any.
function tabShowing(state, workspaceId) {
  if (!workspaceId) return null;
  return state.tabs.find((tab) => workspaceOf(tab.memory) === workspaceId)?.id ?? null;
}

module.exports = {
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
};
