'use strict';

const { app, BrowserWindow, Menu, clipboard, dialog } = require('electron');

function focusedHistory() {
  return BrowserWindow.getFocusedWindow()?.webContents.navigationHistory;
}

function showAbout() {
  const options = { type: 'info', title: 'About XUNA AI', message: 'XUNA AI', detail: `Version ${app.getVersion()}` };
  const owner = BrowserWindow.getFocusedWindow();
  if (owner) dialog.showMessageBox(owner, options);
  else dialog.showMessageBox(options);
}

// The menu bar stays hidden (Alt shows it); it is mostly here for its keyboard shortcuts.
function buildAppMenu() {
  return Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Back', accelerator: 'Alt+Left', click: () => { const history = focusedHistory(); if (history?.canGoBack()) history.goBack(); } },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => { const history = focusedHistory(); if (history?.canGoForward()) history.goForward(); } },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn', accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Help', submenu: [{ label: 'About XUNA AI', click: showAbout }] },
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
