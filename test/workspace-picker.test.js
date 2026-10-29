'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBootstrap, pickerItems } = require('../src/workspace-picker');

// An accessList entry as XUNA's POST /v2/auth/bootstrap returns it.
const entry = (id, type, { companyName, name, parent = null, onboarding = 'COMPLETED', buildingMode } = {}) => ({
  workspace: {
    id,
    type,
    companyName,
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
  assert.deepEqual(parsed.workspaces.find((workspace) => workspace.id === 'c1'), { id: 'c1', name: 'Zed Dental', type: 'CLIENT', parentId: 'a1' });
});

test("a workspace is called by its company's name, else its own name, else what XUNA shows", () => {
  const names = new Map(parseBootstrap(bootstrap(platformAccount)).workspaces.map((workspace) => [workspace.id, workspace.name]));
  assert.equal(names.get('c7'), 'Legacy Name');
  assert.equal(names.get('c8'), 'Company profile');
});

test('the same answer without its { data } wrapper is read too, and a workspace listed twice counts once', () => {
  const parsed = parseBootstrap(JSON.stringify({ user: { uid: 'uid-2' }, accessList: [entry('c1', 'CLIENT', { companyName: 'One' }), entry('c1', 'CLIENT', { companyName: 'Again' })] }));
  assert.equal(parsed.uid, 'uid-2');
  assert.deepEqual(parsed.workspaces, [{ id: 'c1', name: 'One', type: 'CLIENT', parentId: null }]);
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
  assert.deepEqual(byId.get('c2'), { kind: 'workspace', id: 'c2', label: 'Bright Smiles', tabId: 'workspace-2', enabled: true });
  assert.deepEqual(byId.get('c1'), { kind: 'workspace', id: 'c1', label: 'Zed Dental', tabId: null, enabled: true });
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
