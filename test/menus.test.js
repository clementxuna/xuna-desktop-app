'use strict';

// The menu bar's layout. Only the template is checked: building a real menu needs Electron.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appMenuTemplate } = require('../src/menus');

// Each item as its role, its label or "separator".
const items = (menu) => menu.submenu.map((item) => item.role ?? item.label ?? item.type);
const menuNamed = (template, name) => template.find((menu) => (menu.label ?? menu.role) === name);

function template(platform) {
  const calls = { checks: 0 };
  const built = appMenuTemplate({ appContents: () => null, tabs: null, checkForUpdates: () => (calls.checks += 1), platform });
  return { built, calls };
}

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
