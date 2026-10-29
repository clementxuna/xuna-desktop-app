'use strict';

// The Mac window's workspace tabs: which are open, which one is shown, what each is called and which
// profile it signs in with. No Electron imports, so it is unit-tested in test/workspace-tabs.test.js;
// src/main.js shows each tab as a XUNA page, and the title strip draws the buttons (src/title-strip.js).
//
// Each tab has its own profile: its own sign-in and its own remembered workspace. XUNA remembers the
// active workspace in the browser's storage and sends it with every request, so two tabs sharing a
// profile would switch each other's workspace, and one tab's changes could land in the other's.
// Tab 1 keeps the profile every copy of the app used before tabs, so nobody is signed out. A closed
// tab's profile is kept, sign-in included, and the next new tab picks it up again.

const MAX_TABS = 9; // one for each of ⌘1 to ⌘9
const MAX_NAME_LENGTH = 32;
const FIRST_TAB = 'workspace-1';

// 'workspace-3' → 3. Anything else → 0.
function slotOf(id) {
  const match = /^workspace-([1-9]\d*)$/.exec(String(id));
  return match ? Number(match[1]) : 0;
}

// The Electron session a tab signs in with: tab 1 uses the default session, every other tab its own
// persistent one.
function partitionFor(id) {
  const slot = slotOf(id);
  return slot > 1 ? `persist:workspace-${slot}` : undefined;
}

// A name typed into the strip, tidied. null when nothing is left, which brings back the default name.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return clean || null;
}

// The default name follows the tab's profile, so "Workspace 2" is always the same sign-in.
function labelFor(tab) {
  return tab.name ?? `Workspace ${slotOf(tab.id)}`;
}

// The saved tabs, as written by src/main.js. Entries that can't be trusted are dropped, and with none
// left the window opens with tab 1 alone.
function readTabs(saved) {
  const tabs = [];
  for (const entry of Array.isArray(saved?.tabs) ? saved.tabs : []) {
    const slot = slotOf(entry?.id);
    if (slot < 1 || slot > MAX_TABS || tabs.some((tab) => tab.id === entry.id)) continue;
    tabs.push({ id: entry.id, name: cleanName(entry.name) });
  }
  if (tabs.length === 0) tabs.push({ id: FIRST_TAB, name: null });
  const active = tabs.some((tab) => tab.id === saved?.active) ? saved.active : tabs[0].id;
  return { tabs, active };
}

// Adds a tab after the others and shows it. It takes the lowest-numbered profile no open tab is using.
// Returns null when the window already has as many tabs as it can take.
function addTab(state) {
  if (state.tabs.length >= MAX_TABS) return null;
  let slot = 1;
  while (state.tabs.some((tab) => slotOf(tab.id) === slot)) slot += 1;
  const id = `workspace-${slot}`;
  return { tabs: [...state.tabs, { id, name: null }], active: id };
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

function renameTab(state, id, name) {
  return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, name: cleanName(name) } : tab)) };
}

module.exports = {
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
};
