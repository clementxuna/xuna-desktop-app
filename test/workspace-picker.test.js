'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBootstrap, pickerItems, searchItems, avatarPalette, initialsOf, markOpenTabs } = require('../src/workspace-picker');

// An accessList entry as XUNA's POST /v2/auth/bootstrap returns it.
const entry = (id, type, { companyName, name, parent = null, onboarding = 'COMPLETED', buildingMode, photo } = {}) => ({
  workspace: {
    id,
    type,
    companyName,
    companyPhotoUrl: photo,
    name,
    parentWorkspaceId: parent,
    onboardingStatus: onboarding,
    ...(buildingMode === undefined ? {} : { billing: { buildingMode } }),
  },
  membership: { role: 'OWNER', status: 'ACTIVE' },
});

const bootstrap = (accessList, uid = 'uid-1') => JSON.stringify({ success: true, data: { user: { uid, email: 'a@b.c', name: 'A' }, accessList } });

const platformAccount = [
  entry('p1', 'PLATFORM', { companyName: 'XUNA HQ', onboarding: 'IN_PROGRESS' }), // always offered
  entry('a2', 'AGENCY', { companyName: 'Beta Agency' }),
  entry('a1', 'AGENCY', { companyName: 'Acme Agency' }),
  entry('a3', 'AGENCY', { companyName: 'Not Ready Agency', onboarding: 'IN_PROGRESS' }), // hidden until onboarded
  entry('c1', 'CLIENT', { companyName: 'Zed Dental', parent: 'a1' }),
  entry('c2', 'CLIENT', { companyName: 'Bright Smiles', parent: 'a1' }),
  entry('c4', 'CLIENT', { companyName: 'Half Done', parent: 'a1', onboarding: 'NOT_STARTED' }), // hidden
  entry('c5', 'CLIENT', { companyName: 'Built by Acme', parent: 'a1', onboarding: 'IN_PROGRESS', buildingMode: true }), // run by the agency, so never onboarded
  entry('c3', 'CLIENT', { companyName: 'Cafe', parent: 'a2' }),
  entry('c7', 'CLIENT', { name: 'Legacy Name', parent: 'a2' }), // no company name yet
  entry('c8', 'CLIENT', { parent: 'a2' }), // no name at all
  entry('c6', 'CLIENT', { companyName: 'Elsewhere Co', parent: 'a-not-mine' }), // an agency the user isn't in
];

const labels = (items) => items.map((item) => (item.kind === 'workspace' ? item.label : `[${item.kind}] ${item.label}`));

test("XUNA's sign-in check yields the account's workspaces, as XUNA's own switcher would offer them", () => {
  const parsed = parseBootstrap(bootstrap(platformAccount));
  assert.equal(parsed.uid, 'uid-1');
  assert.deepEqual(parsed.workspaces.map((workspace) => workspace.id).sort(), ['a1', 'a2', 'c1', 'c2', 'c3', 'c5', 'c6', 'c7', 'c8', 'p1']);
  assert.deepEqual(parsed.workspaces.find((workspace) => workspace.id === 'c1'), { id: 'c1', name: 'Zed Dental', type: 'CLIENT', parentId: 'a1', avatarUrl: null, buildingMode: false });
});

test("a workspace is called by its company's name, else its own name, else what XUNA shows", () => {
  const names = new Map(parseBootstrap(bootstrap(platformAccount)).workspaces.map((workspace) => [workspace.id, workspace.name]));
  assert.equal(names.get('c7'), 'Legacy Name');
  assert.equal(names.get('c8'), 'Company profile');
});

test('the same answer without its { data } wrapper is read too, and a workspace listed twice counts once', () => {
  const parsed = parseBootstrap(JSON.stringify({ user: { uid: 'uid-2' }, accessList: [entry('c1', 'CLIENT', { companyName: 'One' }), entry('c1', 'CLIENT', { companyName: 'Again' })] }));
  assert.equal(parsed.uid, 'uid-2');
  assert.deepEqual(parsed.workspaces, [{ id: 'c1', name: 'One', type: 'CLIENT', parentId: null, avatarUrl: null, buildingMode: false }]);
  assert.deepEqual([...parsed.names], [['c1', 'One']]);
});

test("an answer that isn't XUNA's list is ignored, so the menu keeps what it had", () => {
  for (const text of ['not json', '[]', 'null', '{"success":true,"data":{}}', JSON.stringify({ data: { accessList: 'x' } })]) {
    assert.equal(parseBootstrap(text), null, text);
  }
});

test('an account with no workspaces gets an empty list, and broken entries are skipped', () => {
  assert.deepEqual(parseBootstrap(bootstrap([])), { uid: 'uid-1', workspaces: [], names: new Map() });
  assert.deepEqual(parseBootstrap(bootstrap([null, { workspace: { id: '  ' } }, { membership: {} }])).workspaces, []);
});

test('the menu groups workspaces as XUNA does: the platform, each agency with its clients, then other clients', () => {
  const { workspaces } = parseBootstrap(bootstrap(platformAccount));
  const items = pickerItems({ workspaces, openTabs: new Map(), canOpenMore: true });
  assert.deepEqual(labels(items), [
    '[header] Platform',
    'XUNA HQ',
    '[header] Acme Agency',
    'Acme Agency',
    'Bright Smiles',
    'Built by Acme',
    'Zed Dental',
    '[header] Beta Agency',
    'Beta Agency',
    'Cafe',
    'Company profile',
    'Legacy Name',
    '[header] Other clients',
    'Elsewhere Co',
  ]);
});

test('an account that is in clients only gets them without headings', () => {
  const { workspaces } = parseBootstrap(bootstrap([entry('c1', 'CLIENT', { companyName: 'Zed Dental', parent: 'a1' }), entry('c2', 'CLIENT', { companyName: 'Bright Smiles', parent: 'a1' })]));
  assert.deepEqual(labels(pickerItems({ workspaces, openTabs: new Map(), canOpenMore: true })), ['Bright Smiles', 'Zed Dental']);
});

test('a workspace already open in a tab points at that tab, and the others open new tabs', () => {
  const { workspaces } = parseBootstrap(bootstrap(platformAccount));
  const items = pickerItems({ workspaces, openTabs: new Map([['c2', 'workspace-2']]), canOpenMore: true });
  const byId = new Map(items.filter((item) => item.kind === 'workspace').map((item) => [item.id, item]));
  assert.deepEqual(byId.get('c2'), { kind: 'workspace', id: 'c2', label: 'Bright Smiles', tabId: 'workspace-2', enabled: true, avatarUrl: null, badges: [] });
  assert.deepEqual(byId.get('c1'), { kind: 'workspace', id: 'c1', label: 'Zed Dental', tabId: null, enabled: true, avatarUrl: null, badges: [] });
});

test('with every tab in use, open workspaces can still be reached and the rest wait for a tab to close', () => {
  const { workspaces } = parseBootstrap(bootstrap(platformAccount));
  const items = pickerItems({ workspaces, openTabs: new Map([['c2', 'workspace-2']]), canOpenMore: false });
  const workspaceItems = items.filter((item) => item.kind === 'workspace');
  assert.deepEqual(workspaceItems.filter((item) => item.enabled).map((item) => item.id), ['c2']);
  assert.deepEqual(items.at(-1), { kind: 'note', label: 'Close a tab to open another workspace' });
});

test('before XUNA has said which workspaces there are, the menu says so', () => {
  assert.deepEqual(pickerItems({ workspaces: undefined, openTabs: new Map(), canOpenMore: true }), [{ kind: 'note', label: 'Loading your workspaces…' }]);
  assert.deepEqual(pickerItems({ workspaces: null, openTabs: new Map(), canOpenMore: true }), [{ kind: 'note', label: 'Sign in to XUNA to open your workspaces' }]);
  assert.deepEqual(pickerItems({ workspaces: [], openTabs: new Map(), canOpenMore: true }), [{ kind: 'note', label: 'No workspaces to open' }]);
});

test("the answer names every workspace in it, including ones the menu doesn't offer, for the tabs", () => {
  const { names } = parseBootstrap(bootstrap(platformAccount));
  assert.equal(names.get('c4'), 'Half Done'); // still onboarding, so not in the menu
  assert.equal(names.get('a3'), 'Not Ready Agency');
  assert.equal(names.get('c1'), 'Zed Dental');
  assert.equal(names.size, platformAccount.length);
});

test('a workspace brings its logo when XUNA has one on https, and a Building Mode workspace is badged', () => {
  const { workspaces } = parseBootstrap(bootstrap([
    entry('c1', 'CLIENT', { companyName: 'Zed Dental', photo: 'https://storage.example.com/zed.png' }),
    entry('c2', 'CLIENT', { companyName: 'Plain', photo: 'http://storage.example.com/plain.png' }),
    entry('c3', 'CLIENT', { companyName: 'Odd', photo: 'javascript:alert(1)' }),
    entry('c5', 'CLIENT', { companyName: 'Built by Acme', onboarding: 'IN_PROGRESS', buildingMode: true }),
  ]));
  const byId = new Map(pickerItems({ workspaces, openTabs: new Map(), canOpenMore: true }).filter((item) => item.kind === 'workspace').map((item) => [item.id, item]));
  assert.equal(byId.get('c1').avatarUrl, 'https://storage.example.com/zed.png');
  assert.equal(byId.get('c2').avatarUrl, null);
  assert.equal(byId.get('c3').avatarUrl, null);
  assert.deepEqual(byId.get('c5').badges, ['Build Mode']);
  assert.deepEqual(byId.get('c1').badges, []);
});

test('searching keeps the rows whose name matches, under their headings, whatever the case or accents', () => {
  const { workspaces } = parseBootstrap(bootstrap([...platformAccount, entry('c9', 'CLIENT', { companyName: 'Café Zoë', parent: 'a2' })]));
  const items = pickerItems({ workspaces, openTabs: new Map(), canOpenMore: true });
  assert.deepEqual(labels(searchItems(items, 'DENT')), ['[header] Acme Agency', 'Zed Dental']);
  assert.deepEqual(labels(searchItems(items, 'cafe')), ['[header] Beta Agency', 'Cafe', 'Café Zoë']);
  assert.deepEqual(labels(searchItems(items, '  agency ')), ['[header] Acme Agency', 'Acme Agency', '[header] Beta Agency', 'Beta Agency']);
  assert.deepEqual(searchItems(items, 'nothing like it'), []);
  assert.equal(searchItems(items, ''), items);
});

test("searching keeps the note about closing a tab while anything matches, and leaves the menu's messages alone", () => {
  const { workspaces } = parseBootstrap(bootstrap(platformAccount));
  const full = pickerItems({ workspaces, openTabs: new Map(), canOpenMore: false });
  assert.deepEqual(searchItems(full, 'zed').at(-1), { kind: 'note', label: 'Close a tab to open another workspace' });
  const loading = pickerItems({ workspaces: undefined, openTabs: new Map(), canOpenMore: true });
  assert.equal(searchItems(loading, 'zed'), loading);
});

test("a workspace without a logo gets XUNA's initials and the same colour XUNA gives it", () => {
  // XUNA's rule (src/utils/avatar-color.ts in the web app): FNV-1a of the trimmed, lower-cased name, over 12 palettes.
  const xuna = (seed) => {
    let hash = 0x811c9dc5;
    for (const char of seed.trim().toLowerCase()) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193);
    }
    return seed.trim() ? (hash >>> 0) % 12 : 0;
  };
  for (const name of ['Acme Agency', 'Zed Dental', 'XUNA HQ', 'Cafe & Co', 'a', '']) assert.equal(avatarPalette(name), xuna(name), name);
  assert.equal(avatarPalette('  ACME agency '), avatarPalette('Acme Agency'));
  assert.equal(initialsOf('Acme Dental Group'), 'AD');
  assert.equal(initialsOf('Zed'), 'Z');
  assert.equal(initialsOf(''), '');
});

test("the tab in front has a tick, and every other open tab shows its shortcut, as in XUNA's switcher", () => {
  const { workspaces } = parseBootstrap(bootstrap(platformAccount));
  const items = pickerItems({ workspaces, openTabs: new Map([['c2', 'workspace-1'], ['c3', 'workspace-3']]), canOpenMore: true });
  const marked = markOpenTabs(items, { tabOrder: ['workspace-1', 'workspace-3'], frontTabId: 'workspace-1', modifier: '⌘' });
  const byId = new Map(marked.filter((item) => item.kind === 'workspace').map((item) => [item.id, item]));
  assert.deepEqual([byId.get('c2').current, byId.get('c2').shortcut], [true, null]);
  assert.deepEqual([byId.get('c3').current, byId.get('c3').shortcut], [false, '⌘2']); // the second tab
  assert.deepEqual([byId.get('c1').current, byId.get('c1').shortcut], [false, null]);
  assert.equal(marked.find((item) => item.kind === 'header').label, 'Platform');
});
