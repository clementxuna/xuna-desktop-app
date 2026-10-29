'use strict';

// What the + button's panel offers on Mac: the workspaces the signed-in account can open, grouped as
// XUNA's own switcher groups them, and searched the way it searches them. No Electron imports, so it is
// unit-tested in test/workspace-picker.test.js. src/main.js builds the items; the panel itself
// (src/workspace-picker-panel.js) loads this file too, for search and for XUNA's avatars.
//
// The list is the accessList of XUNA's sign-in check (POST /v2/auth/bootstrap), which every XUNA page
// makes as it starts and whenever it switches workspace. src/preload.js passes on each answer.

const FALLBACK_NAME = 'Company profile'; // what XUNA's switcher shows for a workspace with no name yet

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// A logo the panel may show: XUNA's own storage serves them over https; anything else is dropped.
function httpsUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// XUNA's switcher offers the platform, a workspace in Building Mode (run by its agency, so never
// onboarded), and any other workspace once its onboarding is complete.
function canOffer({ type, onboardingStatus, billing }) {
  return type === 'PLATFORM' || billing?.buildingMode === true || text(onboardingStatus).toUpperCase() === 'COMPLETED';
}

// The answer's text → { uid, workspaces: [{ id, name, type, parentId, avatarUrl, buildingMode }], names }, or null when it isn't
// XUNA's list, so the menu keeps what it had. workspaces is what the menu offers; names (id → name)
// covers every workspace in the answer, for naming the tabs whatever workspace they show.
function parseBootstrap(responseText) {
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    return null;
  }
  const payload = body?.data && typeof body.data === 'object' ? body.data : body;
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.accessList)) return null;
  const workspaces = [];
  const names = new Map();
  for (const item of payload.accessList) {
    const workspace = item?.workspace;
    const id = text(workspace?.id);
    if (!id || names.has(id)) continue;
    const name = text(workspace.companyName) || text(workspace.name) || FALLBACK_NAME;
    names.set(id, name);
    const type = text(workspace.type).toUpperCase();
    if (!canOffer({ ...workspace, type })) continue;
    workspaces.push({
      id,
      name,
      type,
      parentId: text(workspace.parentWorkspaceId) || null,
      avatarUrl: httpsUrl(workspace.companyPhotoUrl),
      buildingMode: workspace.billing?.buildingMode === true,
    });
  }
  return { uid: text(payload.user?.uid) || null, workspaces, names };
}

const byName = (left, right) => left.name.localeCompare(right.name);

// workspaces: from parseBootstrap; undefined until XUNA has answered, null once it has signed out.
// openTabs: workspace id → the tab showing it. canOpenMore: false when every tab is in use.
// → [{ kind: 'header', label } | { kind: 'workspace', id, label, tabId, enabled, avatarUrl, badges } | { kind: 'note', label }]
function pickerItems({ workspaces, openTabs, canOpenMore }) {
  if (workspaces === undefined) return [{ kind: 'note', label: 'Loading your workspaces…' }];
  if (workspaces === null) return [{ kind: 'note', label: 'Sign in to XUNA to open your workspaces' }];
  if (workspaces.length === 0) return [{ kind: 'note', label: 'No workspaces to open' }];

  const item = (workspace) => {
    const tabId = openTabs.get(workspace.id) ?? null;
    return {
      kind: 'workspace',
      id: workspace.id,
      label: workspace.name,
      tabId,
      enabled: tabId !== null || canOpenMore,
      avatarUrl: workspace.avatarUrl ?? null,
      badges: workspace.buildingMode ? ['Build Mode'] : [], // as XUNA's switcher marks them
    };
  };
  const platforms = workspaces.filter((workspace) => workspace.type === 'PLATFORM').sort(byName);
  const agencies = workspaces.filter((workspace) => workspace.type === 'AGENCY').sort(byName);
  const agencyIds = new Set(agencies.map((agency) => agency.id));
  const clients = workspaces.filter((workspace) => workspace.type !== 'PLATFORM' && workspace.type !== 'AGENCY').sort(byName);
  const others = clients.filter((client) => !agencyIds.has(client.parentId));

  const items = [];
  if (platforms.length > 0) items.push({ kind: 'header', label: 'Platform' }, ...platforms.map(item));
  for (const agency of agencies) {
    items.push({ kind: 'header', label: agency.name }, item(agency), ...clients.filter((client) => client.parentId === agency.id).map(item));
  }
  if (others.length > 0) {
    // An account that is only in clients has nothing else to group them against.
    if (items.length > 0) items.push({ kind: 'header', label: 'Other clients' });
    items.push(...others.map(item));
  }
  if (!canOpenMore && items.some((entry) => entry.kind === 'workspace' && !entry.enabled)) {
    items.push({ kind: 'note', label: 'Close a tab to open another workspace' });
  }
  return items;
}

// Lower case, without accents, so "cafe" finds "Café".
const comparable = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// The panel's search: the rows whose name holds what was typed, each still under its heading. As in
// XUNA's switcher, headings themselves aren't searched. A menu showing only a message is left as it is.
function searchItems(items, query) {
  const wanted = comparable(query ?? '');
  if (!wanted || !items.some((item) => item.kind === 'workspace')) return items;
  const found = [];
  let heading = null;
  for (const item of items) {
    if (item.kind === 'header') heading = item;
    else if (item.kind === 'workspace' && comparable(item.label).includes(wanted)) {
      if (heading) found.push(heading);
      heading = null;
      found.push(item);
    } else if (item.kind === 'note' && found.length > 0) found.push(item);
  }
  return found;
}

// XUNA's avatars for a workspace with no logo (src/utils/avatar-color.ts and src/lib/initials.ts in the
// web app): one of twelve palettes, picked by an FNV-1a hash of the name, so a workspace has the same
// colour here as in XUNA; and the first letters of its first two words.
const AVATAR_PALETTES = 12;

function avatarPalette(name) {
  const seed = String(name ?? '').trim().toLowerCase();
  if (!seed) return 0;
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % AVATAR_PALETTES;
}

function initialsOf(name) {
  const [first = '', second] = String(name ?? '').split(' ');
  return first.charAt(0) + (second ? second.charAt(0) : '');
}

// The rows open in a tab: the tab in front has XUNA's tick, the others the shortcut that shows them.
// tabOrder: the tab ids in order, as ⌘1 to ⌘9 reach them. modifier: '⌘' on Mac.
function markOpenTabs(items, { tabOrder, frontTabId, modifier }) {
  return items.map((item) => {
    if (item.kind !== 'workspace') return item;
    const current = item.tabId !== null && item.tabId === frontTabId;
    const number = item.tabId ? tabOrder.indexOf(item.tabId) + 1 : 0;
    return { ...item, current, shortcut: !current && number > 0 ? `${modifier}${number}` : null };
  });
}

const api = { parseBootstrap, pickerItems, searchItems, avatarPalette, initialsOf, markOpenTabs };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.workspacePicker = api; // the panel page loads this as a plain script
