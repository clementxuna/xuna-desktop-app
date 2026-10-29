'use strict';

// Where each workspace tab keeps XUNA's memory of its current workspace. No Electron imports, so it is
// unit-tested in test/workspace-memory.test.js.
//
// All the tabs share one profile, so one sign-in. XUNA remembers the current workspace in the browser's
// storage, which a profile's pages share, and reads it before every request to say which workspace the
// request is for. src/preload.js gives each tab's page its own copy of the few keys involved, held by
// the main process and saved with the tab (see src/workspace-tabs.js), so tabs never switch each other's
// workspace. Every other key stays shared: it is a setting, or it already names its workspace.

const ACTIVE_WORKSPACE_KEY = 'xuna_active_workspace_id';
const EXPLICIT_KEY = `${ACTIVE_WORKSPACE_KEY}:explicit`;

// Keys starting with these. The first also covers its ":explicit" flag (a deliberate switch) and the
// copies XUNA keeps for custom domains; the last two are what XUNA's switcher has selected.
const TAB_KEY_PREFIXES = [ACTIVE_WORKSPACE_KEY, 'xuna_branding_workspace_id', 'xuna_sidebar_selected_agency:', 'xuna_sidebar_selected_client:'];

const MAX_VALUE_LENGTH = 256;
const MAX_KEYS = 32;

function isTabKey(key) {
  return typeof key === 'string' && TAB_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

const isValue = (value) => typeof value === 'string' && value.length <= MAX_VALUE_LENGTH;

// A tab's saved memory: { values: { key: text }, remembered }, where remembered is the last workspace
// the tab showed. null when the tab has none yet, in which case its page starts from what the profile
// already held.
function readMemory(saved) {
  const source = saved?.values;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const values = {};
  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(values).length >= MAX_KEYS) break;
    if (isTabKey(key) && isValue(value)) values[key] = value;
  }
  return { values, remembered: isValue(saved.remembered) ? saved.remembered : null };
}

// What the page wrote (value null for a removal). Signing out removes the current workspace, but the
// tab still remembers it: its page offers it as a hint at the next sign-in, so the tab comes back to
// its own workspace.
function applyWrite(memory, key, value) {
  const current = memory ?? { values: {}, remembered: null };
  if (!isTabKey(key) || (value !== null && !isValue(value))) return current;
  const values = { ...current.values };
  if (value === null) delete values[key];
  else if (key in values || Object.keys(values).length < MAX_KEYS) values[key] = value;
  const remembered = key === ACTIVE_WORKSPACE_KEY && value !== null ? value : current.remembered;
  return { values, remembered };
}

// The workspace a tab is showing, or last showed.
function workspaceOf(memory) {
  return memory?.values?.[ACTIVE_WORKSPACE_KEY] ?? memory?.remembered ?? null;
}

// A new tab for a workspace picked from the menu. It opens as a deliberate choice, as a click in XUNA's
// own switcher does, so XUNA opens that workspace rather than treating it as a hint.
function seedFor(workspaceId) {
  return { values: { [ACTIVE_WORKSPACE_KEY]: workspaceId, [EXPLICIT_KEY]: '1' }, remembered: workspaceId };
}

// Notices if XUNA stops reading the key the tabs keep apart. XUNA reads it before every request, so a
// page whose sign-in check completes without having read it now keeps its workspace somewhere else,
// which every tab would share. Pages are numbered by their WebContents id.
function createIsolationGuard() {
  const readSinceStart = new Map();
  return {
    pageStarted: (id) => readSinceStart.set(id, false),
    pageRead: (id) => {
      if (readSinceStart.has(id)) readSinceStart.set(id, true);
    },
    bootstrapCompleted: (id) => readSinceStart.get(id) === false,
  };
}

module.exports = {
  ACTIVE_WORKSPACE_KEY,
  TAB_KEY_PREFIXES,
  isTabKey,
  readMemory,
  applyWrite,
  workspaceOf,
  seedFor,
  createIsolationGuard,
};
