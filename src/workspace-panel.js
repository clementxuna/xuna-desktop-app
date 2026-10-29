'use strict';

// The + button's panel of workspaces on Mac: a small page (src/workspace-picker-panel.html) in a view
// over the XUNA page, below the + button, drawn as XUNA's own workspace picker is. It closes when a
// workspace is picked, on Escape, and when anything else is clicked, which takes the focus from it.
// Its page talks only to this window's panel, through src/workspace-picker-panel-preload.js; a
// workspace it names is opened only if the panel offered it.

const path = require('node:path');
const { WebContentsView } = require('electron');
const { pickerPanelBounds } = require('./title-bar');

const FIRST_HEIGHT = 380; // until the page has measured itself
const REOPEN_AFTER_MS = 300; // a click on + that closed the panel by taking its focus doesn't reopen it

// onChoose(item): a workspace row was picked. onClosed(refocus): the panel closed; refocus is true when
// the keyboard should go back to XUNA (Escape), false when the user clicked elsewhere or picked.
// barBottom(): where the window's bar ends, which the panel opens below.
function createWorkspacePanel(win, { onChoose, onClosed, barBottom = () => 0 }) {
  let view = null;
  let ready = false;
  let open = false;
  let anchor = null;
  let height = FIRST_HEIGHT;
  let model = null;
  let blurredAt = 0;

  const place = () => {
    if (!view || !anchor || win.isDestroyed()) return;
    const [width, contentHeight] = win.getContentSize();
    view.setBounds(pickerPanelBounds({ anchor, width, height: contentHeight, panelHeight: height, barBottom: barBottom() }));
  };

  const show = (fresh) => {
    if (!ready || !open) return;
    view.webContents.send('xuna:workspace-panel-show', model, fresh);
    if (fresh) view.webContents.focus();
  };

  const close = (refocus) => {
    if (!open) return;
    open = false;
    view.setVisible(false);
    onClosed(refocus);
  };

  const create = () => {
    view = new WebContentsView({
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'workspace-picker-panel-preload.js') },
    });
    view.setBackgroundColor('#00000000'); // clear round the panel, for its shadow
    view.setVisible(false);
    const page = view.webContents;
    page.ipc.on('xuna:workspace-panel-choose', (_event, id) => {
      const item = model?.items.find((entry) => entry.kind === 'workspace' && entry.id === id && entry.enabled);
      if (!item) return;
      close(false);
      onChoose(item);
    });
    page.ipc.on('xuna:workspace-panel-close', () => close(true));
    page.ipc.on('xuna:workspace-panel-height', (_event, value) => {
      if (!Number.isFinite(value) || value <= 0 || value > 2000) return;
      height = value;
      place();
    });
    page.on('blur', () => {
      if (!open) return;
      blurredAt = Date.now();
      close(false);
    });
    page.once('did-finish-load', () => {
      ready = true;
      show(true);
    });
    page.loadFile(path.join(__dirname, 'workspace-picker-panel.html')).catch(() => {});
    // The page goes with its window: on Mac the app stays open after its window closes.
    win.once('closed', () => {
      if (!page.isDestroyed()) page.close();
    });
  };

  return {
    // anchor: the + button's rectangle in the strip. model: { items, dark } (see the preload).
    toggle: (nextAnchor, nextModel) => {
      if (open) return close(true);
      if (Date.now() - blurredAt < REOPEN_AFTER_MS) return;
      if (!view) create();
      anchor = nextAnchor;
      model = nextModel;
      open = true;
      win.contentView.addChildView(view); // again, which puts it above every tab's view
      place();
      view.setVisible(true);
      show(true);
    },
    // The list changed while the panel is open: it redraws, keeping what was typed.
    update: (nextModel) => {
      if (!open) return;
      model = nextModel;
      show(false);
    },
    close: () => close(false),
  };
}

module.exports = { createWorkspacePanel };
