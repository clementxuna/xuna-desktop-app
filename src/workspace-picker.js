'use strict';

// What the + button's menu offers on Mac: the workspaces the signed-in account can open, grouped as
// XUNA's own switcher groups them. No Electron imports, so it is unit-tested in
// test/workspace-picker.test.js; src/main.js turns the items into a native menu.
//
// The list is the accessList of XUNA's sign-in check (POST /v2/auth/bootstrap), which every XUNA page
// makes as it starts and whenever it switches workspace. src/preload.js passes on each answer.

const FALLBACK_NAME = 'Company profile'; // what XUNA's switcher shows for a workspace with no name yet

const text = (value) => (typeof value === 'string' ? value.trim() : '');

// XUNA's switcher offers the platform, a workspace in Building Mode (run by its agency, so never
// onboarded), and any other workspace once its onboarding is complete.
function canOffer({ type, onboardingStatus, billing }) {
  return type === 'PLATFORM' || billing?.buildingMode === true || text(onboardingStatus).toUpperCase() === 'COMPLETED';
}

// The answer's text → { uid, workspaces: [{ id, name, type, parentId }] }, or null when it isn't XUNA's
// list, so the menu keeps what it had.
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
  for (const item of payload.accessList) {
    const workspace = item?.workspace;
    const id = text(workspace?.id);
    if (!id || workspaces.some((known) => known.id === id)) continue;
    const type = text(workspace.type).toUpperCase();
    if (!canOffer({ ...workspace, type })) continue;
    const name = text(workspace.companyName) || text(workspace.name) || FALLBACK_NAME;
    workspaces.push({ id, name, type, parentId: text(workspace.parentWorkspaceId) || null });
  }
  return { uid: text(payload.user?.uid) || null, workspaces };
}

const byName = (left, right) => left.name.localeCompare(right.name);

// workspaces: from parseBootstrap; undefined until XUNA has answered, null once it has signed out.
// openTabs: workspace id → the tab showing it. canOpenMore: false when every tab is in use.
// → [{ kind: 'header', label } | { kind: 'workspace', id, label, tabId, enabled } | { kind: 'note', label }]
function pickerItems({ workspaces, openTabs, canOpenMore }) {
  if (workspaces === undefined) return [{ kind: 'note', label: 'Loading your workspaces…' }];
  if (workspaces === null) return [{ kind: 'note', label: 'Sign in to XUNA to open your workspaces' }];
  if (workspaces.length === 0) return [{ kind: 'note', label: 'No workspaces to open' }];

  const item = (workspace) => {
    const tabId = openTabs.get(workspace.id) ?? null;
    return { kind: 'workspace', id: workspace.id, label: workspace.name, tabId, enabled: tabId !== null || canOpenMore };
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

module.exports = { parseBootstrap, pickerItems };
