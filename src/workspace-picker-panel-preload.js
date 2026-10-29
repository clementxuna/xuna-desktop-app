'use strict';

// The workspace panel's link to the main process (see src/workspace-picker-panel.html and
// src/workspace-panel.js). It runs isolated from the panel and gives it window.workspacePanel. The
// calls are few on purpose: a page XUNA serves could take the panel's place and make the same ones.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workspacePanel', {
  // model: { items (pickerItems, then markOpenTabs, in src/workspace-picker.js), dark }.
  // fresh: the panel has just opened, rather than its list having changed while it was open.
  onShow: (callback) => ipcRenderer.on('xuna:workspace-panel-show', (_event, model, fresh) => callback(model, fresh)),
  choose: (id) => ipcRenderer.send('xuna:workspace-panel-choose', id),
  close: () => ipcRenderer.send('xuna:workspace-panel-close'),
  // The panel's height in pixels, so its view fits it.
  resize: (height) => ipcRenderer.send('xuna:workspace-panel-height', height),
});
