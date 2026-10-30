'use strict';

// The menu bar's layout. Only the template is checked: building a real menu needs Electron.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appMenuTemplate, tabMenuTemplate } = require('../src/menus');

// Each item as its role, its label or "separator".
const items = (menu) => menu.submenu.map((item) => item.role ?? item.label ?? item.type);
const menuNamed = (template, name) => template.find((menu) => (menu.label ?? menu.role) === name);

function template(platform) {
  const calls = { checks: 0 };
  const built = appMenuTemplate({ appContents: () => null, tabs: null, checkForUpdates: () => (calls.checks += 1), platform });
  return { built, calls };
}

test('right-clicking a workspace tab offers to rename it, close it, or close the others', () => {
  const calls = [];
  const menu = tabMenuTemplate({ count: 3, rename: () => calls.push('rename'), close: () => calls.push('close'), closeOthers: () => calls.push('others') });
  assert.deepEqual(menu.map((item) => item.label ?? item.type), ['Rename Tab…', 'separator', 'Close Tab', 'Close Other Tabs']);
  assert.ok(menu.filter((item) => item.label).every((item) => item.enabled !== false));
  for (const item of menu) item.click?.();
  assert.deepEqual(calls, ['rename', 'close', 'others']);
});

test("with one tab left, its menu can't close it or the others", () => {
  const menu = tabMenuTemplate({ count: 1, rename() {}, close() {}, closeOthers() {} });
  assert.equal(menu.find((item) => item.label === 'Close Tab').enabled, false);
  assert.equal(menu.find((item) => item.label === 'Close Other Tabs').enabled, false);
  assert.notEqual(menu.find((item) => item.label === 'Rename Tab…').enabled, false);
});

test('with one tab, which the bar still shows, the Window menu can rename it but not close it or step to another', () => {
  const tabs = { list: [{ id: 'workspace-1', label: 'Acme Agency', active: true }], pick() {}, close() {}, startRename() {}, cycle() {}, select() {} };
  const built = appMenuTemplate({ appContents: () => null, tabs, checkForUpdates() {}, platform: 'darwin' });
  const item = (label) => menuNamed(built, 'Window').submenu.find((entry) => entry.label === label);
  assert.notEqual(item('Rename Workspace Tab…').enabled, false);
  assert.equal(item('Close Workspace Tab').enabled, false);
  assert.equal(item('Show Next Workspace Tab').enabled, false);
});

test('on Mac, Check for Updates… sits under About in the app menu, which keeps its usual items', () => {
  const { built, calls } = template('darwin');
  const appMenu = built[0];
  assert.equal(appMenu.role, 'appMenu');
  // Electron's own app menu, with Check for Updates… added after About.
  assert.deepEqual(items(appMenu), ['about', 'Check for Updates…', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  appMenu.submenu[1].click();
  assert.equal(calls.checks, 1);
});

test('on Windows, Check for Updates… sits in the Help menu, above About', () => {
  const { built, calls } = template('win32');
  assert.deepEqual(built.map((menu) => menu.label ?? menu.role), ['File', 'editMenu', 'View', 'Help']);
  assert.deepEqual(items(menuNamed(built, 'File')), ['quit']);
  const help = menuNamed(built, 'Help');
  assert.deepEqual(items(help), ['Check for Updates…', 'separator', 'About XUNA AI']);
  help.submenu[0].click();
  assert.equal(calls.checks, 1);
});

test('the Mac menu bar keeps its Edit, View and Window menus', () => {
  const { built } = template('darwin');
  assert.deepEqual(built.map((menu) => menu.label ?? menu.role), ['appMenu', 'editMenu', 'View', 'Window']);
});

test('the View menu is the same on Mac and Windows', () => {
  const view = (platform) => items(menuNamed(template(platform).built, 'View'));
  const expected = ['Back', 'Forward', 'separator', 'Reload', 'Force Reload', 'Toggle Developer Tools', 'separator', 'resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'];
  assert.deepEqual(view('darwin'), expected);
  assert.deepEqual(view('win32'), expected);
});
