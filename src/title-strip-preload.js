'use strict';

// The Mac title strip's link to the main process (see src/title-strip.html and addWorkspaceTabs in
// src/main.js). It runs isolated from the strip and gives it window.workspaceTabs: the tabs to draw,
// and what the strip's buttons ask for. The main process acts only on the strip of its own window.

const { contextBridge, ipcRenderer } = require('electron');

const ask = (request) => ipcRenderer.send('xuna:workspace-tab-request', request);

contextBridge.exposeInMainWorld('workspaceTabs', {
  // state: { tabs: [{ id, label, active }], dark }
  onChange: (callback) => ipcRenderer.on('xuna:workspace-tabs', (_event, state) => callback(state)),
  // The Window menu's "Rename Workspace Tab…" (id: the tab shown).
  onRename: (callback) => ipcRenderer.on('xuna:workspace-tab-rename', (_event, id) => callback(id)),
  // The Window menu's "Open Workspace…" (⌘T): the strip answers with add(), from its + button.
  onPick: (callback) => ipcRenderer.on('xuna:workspace-picker-open', () => callback()),
  select: (id) => ask({ type: 'select', id }),
  // anchor: the + button's { x, y, width, height } in the strip, where the menu opens.
  add: (anchor) => ask({ type: 'add', anchor }),
  close: (id) => ask({ type: 'close', id }),
  rename: (id, name) => ask({ type: 'rename', id, name }),
  editing: (active) => ask({ type: 'editing', active }),
});
