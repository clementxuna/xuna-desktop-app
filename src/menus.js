'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog } = require('electron');

const IS_MAC = process.platform === 'darwin';

function showAbout() {
  const options = { type: 'info', title: 'About XUNA AI', message: 'XUNA AI', detail: `Version ${app.getVersion()}` };
  const owner = BrowserWindow.getFocusedWindow();
  if (owner) dialog.showMessageBox(owner, options);
  else dialog.showMessageBox(options);
}

// The Mac Window menu, with the main window's workspace tabs (see addWorkspaceTabs in src/main.js):
// ⌘T opens one, ⌘W closes the one shown, ⌘1 to ⌘9 show one and ⌃Tab steps through them, as in Safari.
// tabs is null while no main window is open.
function macWindowMenu(tabs) {
  const items = [{ role: 'minimize' }, { role: 'zoom' }];
  if (tabs) {
    const several = tabs.list.length > 1;
    items.push(
      { type: 'separator' },
      { label: 'New Workspace Tab', accelerator: 'Cmd+T', enabled: tabs.canAdd, click: () => tabs.add() },
      { label: 'Close Workspace Tab', accelerator: 'Cmd+W', enabled: several, click: () => tabs.close() },
      { label: 'Rename Workspace Tab…', enabled: several, click: () => tabs.startRename() },
      { type: 'separator' },
      { label: 'Show Next Workspace Tab', accelerator: 'Ctrl+Tab', enabled: several, click: () => tabs.cycle(1) },
      { label: 'Show Previous Workspace Tab', accelerator: 'Ctrl+Shift+Tab', enabled: several, click: () => tabs.cycle(-1) },
      { type: 'separator' },
      ...tabs.list.map((tab, index) => ({
        label: tab.label,
        type: 'checkbox',
        checked: tab.active,
        accelerator: `Cmd+${index + 1}`,
        click: () => tabs.select(tab.id),
      })),
    );
  }
  items.push({ type: 'separator' }, { role: 'front' });
  return { label: 'Window', role: 'window', submenu: items };
}

// On Windows the menu bar stays hidden (Alt shows it); it is mostly here for its keyboard shortcuts.
// On macOS it is the usual menu bar, with the app menu (About, Hide, Quit) and the Window menu.
// appContents(win) is the page showing XUNA in a window, which on Mac is not the window's own page (see
// src/main.js), so the page commands go to it rather than to Electron's roles for them.
// tabs: the Mac main window's workspace tabs, for the Window menu (see macWindowMenu).
function buildAppMenu(appContents, tabs = null) {
  const focusedPage = () => {
    const win = BrowserWindow.getFocusedWindow();
    return win ? appContents(win) : null;
  };
  return Menu.buildFromTemplate([
    IS_MAC ? { role: 'appMenu' } : { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: IS_MAC ? 'Cmd+[' : 'Alt+Left', click: () => { const history = focusedPage()?.navigationHistory; if (history?.canGoBack()) history.goBack(); } },
        { label: 'Forward', accelerator: IS_MAC ? 'Cmd+]' : 'Alt+Right', click: () => { const history = focusedPage()?.navigationHistory; if (history?.canGoForward()) history.goForward(); } },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => focusedPage()?.reload() },
        { label: 'Force Reload', accelerator: 'Shift+CmdOrCtrl+R', click: () => focusedPage()?.reloadIgnoringCache() },
        { label: 'Toggle Developer Tools', accelerator: IS_MAC ? 'Alt+Command+I' : 'Ctrl+Shift+I', click: () => focusedPage()?.toggleDevTools() },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    IS_MAC ? macWindowMenu(tabs) : { label: 'Help', submenu: [{ label: 'About XUNA AI', click: showAbout }] },
  ]);
}

// Right-click menu: spelling fixes, link actions and the usual edit commands.
function attachContextMenu(contents, openExternal) {
  contents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      items.push(
        { label: 'Add to dictionary', click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }
    if (params.linkURL) {
      items.push(
        { label: 'Open link in browser', click: () => openExternal(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      );
    }
    if (params.isEditable) {
      items.push(
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    while (items.at(-1)?.type === 'separator') items.pop();
    if (items.length > 0) Menu.buildFromTemplate(items).popup();
  });
}

module.exports = { buildAppMenu, attachContextMenu };
