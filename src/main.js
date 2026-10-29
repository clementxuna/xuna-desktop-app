'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, WebContentsView, dialog, ipcMain, nativeTheme, powerMonitor, pushNotifications, screen, session, shell, webContents } = require('electron');
const config = require('./config');
const { createPolicy, isSafeExternalUrl, chromeUserAgent } = require('./policy');
const { buildAppMenu, attachContextMenu } = require('./menus');
const { createUpdates } = require('./updates');
const { titleBarColor, macAppViewBounds } = require('./title-bar');
const { chooseBounds, readState, writeState } = require('./window-state');
const { MAX_TABS, labelFor, readTabs, addTab, closeTab, selectTab, cycleTab, renameTab, setTabMemory, nameWorkspaces, tabShowing } = require('./workspace-tabs');
const { ACTIVE_WORKSPACE_KEY, TAB_KEY_PREFIXES, readMemory, applyWrite, workspaceOf, seedFor, createIsolationGuard, memoryForPage } = require('./workspace-memory');
const { parseBootstrap, pickerItems, markOpenTabs } = require('./workspace-picker');
const { createWorkspacePanel } = require('./workspace-panel');

// XUNA_APP_URL points a development run at a preview or local deploy; installed copies always open the live app.
const APP_URL = (!app.isPackaged && process.env.XUNA_APP_URL) || config.APP_URL;
const policy = createPolicy({ appUrl: APP_URL, trustedDomain: config.TRUSTED_DOMAIN });
const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';
// The workspace tabs are Mac only. XUNA_WORKSPACE_TABS=1 shows them in a Windows development run too,
// under Windows' own title bar, so they can be worked on there.
const USE_TABS = IS_MAC || (!app.isPackaged && process.env.XUNA_WORKSPACE_TABS === '1');
// Every XUNA page: the main window's on Windows, each workspace tab's, and with tabs the pop-ups too.
const XUNA_PAGE_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: true,
  preload: path.join(__dirname, 'preload.js'),
};

// Development runs get their own profile, so they neither trip an installed copy's single-instance lock nor share its sign-in.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()} Dev`));

app.userAgentFallback = chromeUserAgent(process.versions.chrome, process.platform);
if (IS_WINDOWS) app.setAppUserModelId(config.APP_ID);

let mainWindow = null;
let titleBar = null; // XUNA's black or white for the title bars: Windows' own, and the strip on Mac
let pushRegistration = Promise.resolve(null); // where XUNA's servers send this Mac's push notifications (macOS only)
// On Mac the XUNA pages are views below the title strip, one per workspace tab (see addWorkspaceTabs);
// elsewhere the window's own page shows XUNA.
const workspaceTabs = new WeakMap(); // Mac main window → its workspace tabs
const pageColors = new WeakMap(); // XUNA page → the title bar colour for the theme it last reported
const guardedSessions = new WeakSet(); // sessions given the permission rules: the default one and each tab's own
let quitting = false; // a quit the XUNA page is holding up, to finish once the page has closed (macOS)
let afterQuit = null; // what a restart for an update does once nothing can stop the quit (Windows; see src/updates.js)
let updates = null; // installed copies' updates (see startAutoUpdates)
let updateNotification = null; // held, so a click on it still arrives
// The account's workspaces for the + menu (src/workspace-picker.js): undefined until XUNA has listed them,
// null once it has signed out.
let workspaceList;
let workspaceNames = new Map(); // every workspace in XUNA's list, offered or not, for naming the tabs
const isolationGuard = createIsolationGuard({ onBroken: () => turnOffTabs() });
const popupOwners = new WeakMap(); // pop-up page → the tab it was opened from (see memoryForPage)
let tabsTurnedOff = false; // the guard tripped (see turnOffTabs)

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('web-contents-created', (_event, contents) => harden(contents));
  // On macOS the app stays in the Dock after its last window closes, as Mac apps do.
  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
  // Electron applies a window's creation-time accentColor only on its first focus, so a window that
  // opens in the background would show Windows' own gray title bar. Applying it explicitly avoids that.
  app.on('browser-window-created', (_event, win) => {
    if (IS_WINDOWS && titleBar) win.setAccentColor(titleBar);
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => afterQuit?.());
  app.whenReady().then(() => {
    titleBar = titleBarColor({ prefersDark: nativeTheme.shouldUseDarkColors }); // until the page reports its theme
    ipcMain.on('xuna:page-appearance', onPageAppearance);
    ipcMain.on('xuna:workspace-tab-request', onWorkspaceTabRequest);
    ipcMain.on('xuna:workspace-memory', onWorkspaceMemoryRequest);
    ipcMain.on('xuna:workspace-memory-init', (event, values) => fromTabPage(event, (tabs, id) => tabs.adopt(id, values)));
    ipcMain.on('xuna:workspace-memory-write', onWorkspaceMemoryWrite);
    ipcMain.on('xuna:workspace-memory-read', (event) => fromTabPage(event, () => isolationGuard.pageRead(event.sender.id)));
    ipcMain.on('xuna:workspace-list', onWorkspaceList);
    guardSession(session.defaultSession);
    if (USE_TABS) {
      removeOldTabProfiles();
      watchSignInChecks();
    }
    updateAppMenu(null);
    mainWindow = createMainWindow();
    app.on('activate', showMainWindow); // clicking the Dock icon on macOS
    // Clicking a push notification brings the app to the front but opens no window, so open one if none is left.
    app.on('did-become-active', () => {
      if (BrowserWindow.getAllWindows().length === 0) showMainWindow();
    });
    ipcMain.handle('xuna:push-registration', (event) => (policy.isTrustedPage(event.senderFrame?.url) ? pushRegistration : null));
    registerForPush();
    startAutoUpdates();
  });
}

// Asks Apple for this Mac's device token. XUNA's servers send notifications to it through APNs, and macOS shows
// them even when the app is closed. Only signed copies can register: they carry the push entitlement and the
// provisioning profile that allows it (see build/entitlements.mac.plist). Development runs and Windows skip this.
function registerForPush() {
  if (!IS_MAC || !app.isPackaged) return;
  pushRegistration = pushNotifications
    .registerForAPNSNotifications()
    .then((token) => ({ platform: 'macos', token, topic: config.APP_ID, environment: 'production' }))
    .catch((error) => {
      console.error('[push]', error);
      return null;
    });
}

function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? config.BACKGROUND.dark : config.BACKGROUND.light;
}

// Colours the Windows title bar: black in dark mode, white in light mode. Windows only; on Mac the strip
// above the page takes the colour instead (see addWorkspaceTabs).
function titleBarOptions() {
  return IS_WINDOWS && titleBar ? { accentColor: titleBar } : {};
}

// The menu bar. tabs: the Mac main window's workspace tabs for its Window menu, which is rebuilt
// whenever they change; null while there is no main window, and on Windows.
function updateAppMenu(tabs) {
  Menu.setApplicationMenu(buildAppMenu(appContents, tabs, checkForUpdates));
}

// The page showing XUNA in a window: on Mac the workspace tab shown, otherwise the window's own page.
function appContents(win) {
  return workspaceTabs.get(win)?.activePage() ?? win.webContents;
}

// The window a page is shown in, the XUNA pages of a Mac window's workspace tabs included.
function windowOf(contents) {
  return BrowserWindow.getAllWindows().find((win) => win.webContents === contents || workspaceTabs.get(win)?.has(contents)) ?? null;
}

function openExternal(url) {
  if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
}

// src/preload.js reports the theme the XUNA page is showing; the title bars follow the page in front.
function onPageAppearance(event, appearance) {
  const win = windowOf(event.sender);
  if (!win || !policy.isTrustedPage(event.senderFrame?.url)) return;
  const color = titleBarColor(appearance);
  pageColors.set(event.sender, color);
  // A workspace tab in the background keeps its colour for when it is shown (each tab has its own sign-in and theme).
  if (appContents(win) === event.sender) setTitleBarColor(color);
}

function setTitleBarColor(color) {
  if (color === titleBar) return;
  titleBar = color;
  for (const win of BrowserWindow.getAllWindows()) {
    if (IS_WINDOWS) win.setAccentColor(color);
    workspaceTabs.get(win)?.setColor(color); // the tab strip shows the window's background
  }
}

// Applied to every page the app shows, pop-ups included.
function harden(contents) {
  // A pop-up remembers the tab it was opened from, and the tab's memory then, in case the tab closes.
  contents.on('did-create-window', (child) => {
    const owner = tabOf(contents) ?? popupOwners.get(contents);
    if (owner) popupOwners.set(child.webContents, { tabs: owner.tabs, id: owner.id, snapshot: owner.tabs.memoryOf(owner.id) ?? owner.snapshot ?? null });
  });

  contents.setWindowOpenHandler((details) => {
    const verdict = policy.windowOpen({ ...details, openerUrl: contents.getURL() });
    if (verdict === 'in-app') {
      // With workspace tabs a pop-up gets the XUNA preload too, so a XUNA page in it (an OAuth return,
      // say) reads the workspace of the tab that opened it, not the profile's shared one.
      const popupPreferences = USE_TABS ? { webPreferences: XUNA_PAGE_PREFERENCES } : {};
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: backgroundColor(), ...titleBarOptions(), ...popupPreferences } };
    }
    if (verdict === 'external') openExternal(details.url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event) => {
    const verdict = policy.navigation(event.url);
    if (verdict === 'allow') return;
    event.preventDefault();
    if (verdict === 'external') openExternal(event.url);
  });

  // The web app asks before leaving an editor with unsaved changes; without this Electron silently refuses to close.
  contents.on('will-prevent-unload', (event) => {
    const options = {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'Leave this page?',
      detail: 'Changes you made may not be saved.',
    };
    const owner = windowOf(contents);
    const tabs = owner ? workspaceTabs.get(owner) : null;
    tabs?.reveal(contents); // a workspace tab asking comes to the front, so its unsaved changes are in view
    const choice = owner ? dialog.showMessageBoxSync(owner, options) : dialog.showMessageBoxSync(options);
    if (choice === 0) event.preventDefault();
    else {
      quitting = false; // staying abandons any quit in progress
      afterQuit = null; // a restart for an update included: the update installs at the next quit instead
      tabs?.keepOpen(contents); // and the tab or window close it held up
    }
  });

  if (contents.getType() === 'window') attachContextMenu(contents, openExternal);
}

// The permission rules in src/policy.js, for the default session and for each workspace tab's own.
function guardSession(ses) {
  if (guardedSessions.has(ses)) return;
  guardedSessions.add(ses);
  const pageUrl = (contents, fallback) => (contents && !contents.isDestroyed() && contents.getURL()) || fallback || '';
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(policy.permission(permission, {
      pageUrl: pageUrl(contents, details.requestingUrl),
      requestingUrl: details.requestingUrl,
      externalUrl: details.externalURL,
      mediaTypes: details.mediaTypes,
    }));
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    return policy.permission(permission, {
      pageUrl: pageUrl(contents, requestingOrigin),
      requestingUrl: requestingOrigin,
      mediaTypes: details?.mediaType ? [details.mediaType] : undefined,
    });
  });
}

function createMainWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const { bounds, maximized } = chooseBounds(readState(stateFile), workAreas, { width: 1280, height: 820 });

  const stripPreferences = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    preload: path.join(__dirname, 'title-strip-preload.js'),
  };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 500,
    title: 'XUNA AI',
    backgroundColor: (USE_TABS && titleBar) || backgroundColor(),
    ...titleBarOptions(),
    ...(IS_MAC ? { titleBarStyle: 'hidden' } : {}),
    autoHideMenuBar: true,
    // On Mac the window's own page is the title strip, with the workspace tab buttons; XUNA gets views below it.
    webPreferences: USE_TABS ? stripPreferences : XUNA_PAGE_PREFERENCES,
  });
  if (USE_TABS) addWorkspaceTabs(win, XUNA_PAGE_PREFERENCES);
  else showXuna(win.webContents);
  if (maximized) win.maximize();
  win.on('close', () => writeState(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized() }));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    // Sign-in and connect pop-ups have no purpose without the main window. On macOS the app itself
    // stays in the Dock, and clicking its icon opens a new main window.
    if (!IS_MAC) app.quit();
    else {
      updateAppMenu(null); // the Window menu drops the closed window's tabs
      for (const other of BrowserWindow.getAllWindows()) other.close();
    }
  });

  // Mouse back/forward buttons.
  win.on('app-command', (_event, command) => {
    const history = appContents(win).navigationHistory;
    if (command === 'browser-backward' && history.canGoBack()) history.goBack();
    if (command === 'browser-forward' && history.canGoForward()) history.goForward();
  });

  return win;
}

// Opens XUNA in a page. A page that can't load shows the offline page, and one that crashes reloads.
function showXuna(contents) {
  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // -3 is an aborted load (a redirect or a superseded navigation), not a failure.
    if (!isMainFrame || errorCode === -3 || url.startsWith('file:')) return;
    const retryUrl = policy.isTrustedPage(url) ? url : APP_URL;
    contents.loadFile(path.join(__dirname, 'offline.html'), { query: { url: retryUrl } }).catch(() => {});
  });

  let lastCrash = 0;
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || Date.now() - lastCrash < 10_000) return; // don't loop on a page that keeps crashing
    lastCrash = Date.now();
    contents.reload();
  });

  contents.loadURL(APP_URL).catch(() => {}); // failures are handled by did-fail-load
}

// macOS draws its title bar in its own grey, whatever theme XUNA shows. So on Mac the window hides it,
// keeping the three buttons, over a strip in XUNA's black or white: the window's background, which
// setTitleBarColor keeps in step with the page shown. src/title-strip.html, the window's own page, makes
// the strip drag the window and draws the workspace tab buttons at its right end.
//
// Each workspace tab is a XUNA page in a view below the strip. The tabs share one sign-in, and each keeps
// its own workspace (see src/workspace-memory.js). Only the shown tab's view is visible; the others keep
// running, so a call or a draft carries on while another workspace is in front. The tabs, their names,
// their workspaces and the one shown are saved, and the window opens with them again. The + button opens
// a menu of the account's workspaces (src/workspace-picker.js).
function addWorkspaceTabs(win, webPreferences) {
  const stateFile = path.join(app.getPath('userData'), 'workspace-tabs.json');
  let state = readTabs(readState(stateFile));
  const views = new Map(); // tab id → { view, page }; the page is held, since view.webContents is undefined once it is destroyed
  const closingTabs = new Set(); // tabs being closed, whose page is deciding whether it may go
  let closingWindow = false; // the window is closing its pages, one at a time

  const pageOf = (id) => {
    const entry = views.get(id);
    return entry && !entry.page.isDestroyed() ? entry.page : null;
  };

  const layout = () => {
    const [width, height] = win.getContentSize();
    const bounds = macAppViewBounds({ width, height, fullScreen: win.isFullScreen(), tabCount: state.tabs.length });
    for (const { view } of views.values()) view.setBounds(bounds);
  };

  const sendToStrip = () => {
    win.webContents.send('xuna:workspace-tabs', {
      tabs: state.tabs.map((tab) => ({ id: tab.id, label: labelFor(tab), active: tab.id === state.active })),
      dark: titleBar === config.BACKGROUND.dark,
    });
  };

  // What the Window menu lists and does (see src/menus.js). ⌘W closes a tab only while this window is
  // in front, so pressing it in a sign-in pop-up never closes the tab behind.
  const menu = () => ({
    list: state.tabs.map((tab) => ({ id: tab.id, label: labelFor(tab), active: tab.id === state.active })),
    pick: () => win.webContents.send('xuna:workspace-picker-open'), // the strip opens it under its + button
    close: () => {
      if (BrowserWindow.getFocusedWindow() === win) tabs.close(state.active);
    },
    startRename: () => tabs.startRename(),
    cycle: (step) => tabs.cycle(step),
    select: (id) => tabs.select(id),
  });

  // After any change: shows the selected tab's page and hides the others, colours the strip for it,
  // saves the tabs, and redraws the strip and the Window menu.
  const refresh = () => {
    if (win.isDestroyed()) return;
    for (const [id, { view }] of views) view.setVisible(id === state.active);
    layout();
    const page = pageOf(state.active);
    if (page) {
      win.setTitle(page.getTitle() || 'XUNA AI');
      const color = pageColors.get(page);
      if (color) setTitleBarColor(color);
    }
    writeState(stateFile, state);
    sendToStrip();
    updateAppMenu(menu());
    panel.update(panelModel());
  };

  // Moves to a new state and puts the keyboard in the page it shows.
  const show = (next) => {
    state = next;
    if (!pageOf(state.active)) openPage(state.active);
    refresh();
    pageOf(state.active)?.focus();
  };

  // Opens a tab's XUNA page in a hidden view below the strip. Every tab shares the one sign-in.
  const openPage = (id) => {
    const view = new WebContentsView({ webPreferences });
    const page = view.webContents;
    view.setBackgroundColor(backgroundColor());
    view.setVisible(false);
    win.contentView.addChildView(view);
    views.set(id, { view, page });
    // The window takes the shown page's title, as it did when the page was its own (the Window menu shows it).
    page.on('page-title-updated', (_event, title) => {
      if (pageOf(state.active) === page) win.setTitle(title);
    });
    page.once('destroyed', () => onPageClosed(id, view));
    showXuna(page);
  };

  // A page has gone, because its tab was closed or because the window is closing. A page that
  // "Leave this page?" kept never gets here.
  const onPageClosed = (id, view) => {
    if (views.get(id)?.view === view) views.delete(id);
    if (win.isDestroyed()) return;
    win.contentView.removeChildView(view);
    if (closingTabs.delete(id)) {
      state = closeTab(state, id);
      refresh();
      pageOf(state.active)?.focus();
    }
    if (closingWindow) closeNextPage();
  };

  // Closing the window asks each XUNA page in turn, the shown one first, since any may have unsaved
  // changes (see will-prevent-unload). The window closes once they have all gone, and a quit they held
  // up carries on from there. The tabs stay saved, so the next window opens with them.
  const closeNextPage = () => {
    const next = [state.active, ...views.keys()].map(pageOf).find(Boolean);
    if (next) next.close({ waitForBeforeUnload: true });
    else if (quitting) app.quit();
    else if (!win.isDestroyed()) win.close();
  };

  // What the + panel lists (src/workspace-picker.js): the account's workspaces, those open in a tab
  // marked with it, and the panel in the strip's black or white.
  const panelModel = () => {
    const openTabs = new Map();
    for (const tab of state.tabs) {
      const workspaceId = workspaceOf(tab.memory);
      if (workspaceId && !openTabs.has(workspaceId)) openTabs.set(workspaceId, tab.id);
    }
    const items = tabsTurnedOff
      ? [{ kind: 'note', label: 'Workspace tabs are off. An update to XUNA AI will turn them back on.' }]
      : pickerItems({ workspaces: workspaceList, openTabs, canOpenMore: state.tabs.length < MAX_TABS });
    const modifier = IS_MAC ? '⌘' : 'Ctrl+';
    return { items: markOpenTabs(items, { tabOrder: state.tabs.map((tab) => tab.id), frontTabId: state.active, modifier }), dark: titleBar === config.BACKGROUND.dark };
  };
  const panel = createWorkspacePanel(win, {
    onChoose: (item) => (item.tabId ? tabs.select(item.tabId) : tabs.openWorkspace(item.id, item.label)),
    onClosed: (refocus) => {
      if (refocus) pageOf(state.active)?.focus();
    },
  });

  // A tab's page wrote to its workspace memory: the tab takes its workspace's name.
  const updateMemory = (id, memory) => {
    state = setTabMemory(state, id, memory);
    state = nameWorkspaces(state, workspaceNames);
    refresh();
  };

  const tabs = {
    has: (contents) => [...views.values()].some((entry) => entry.page === contents),
    idOf: (contents) => [...views].find(([, entry]) => entry.page === contents)?.[0] ?? null,
    activeId: () => state.active,
    count: () => state.tabs.length,
    memoryOf: (id) => state.tabs.find((tab) => tab.id === id)?.memory, // undefined for no such tab
    activePage: () => pageOf(state.active),
    setColor: (color) => {
      win.setBackgroundColor(color);
      sendToStrip();
    },
    select: (id) => show(selectTab(state, id)),
    cycle: (step) => show(cycleTab(state, step)),
    // A tab with no memory yet takes what its page found in the profile's storage, once.
    adopt: (id, values) => {
      const tab = state.tabs.find((entry) => entry.id === id);
      const memory = readMemory({ values, remembered: values?.[ACTIVE_WORKSPACE_KEY] });
      if (tab && !tab.memory && memory) updateMemory(id, memory);
    },
    remember: (id, key, value) => {
      const tab = state.tabs.find((entry) => entry.id === id);
      if (tab) updateMemory(id, applyWrite(tab.memory, key, value));
    },
    nameAll: (names) => {
      state = nameWorkspaces(state, names);
      refresh();
    },
    // The + menu, under the + button: anchor is its rectangle in the strip.
    // The + panel, under the + button: anchor is its rectangle in the strip. Pressed again, it closes.
    pick: (anchor) => {
      if (anchor) panel.toggle(anchor, panelModel());
    },
    // A workspace already open in a tab is shown there; otherwise it opens in a new tab, as a deliberate
    // choice, the way a click in XUNA's own switcher opens it.
    openWorkspace: (workspaceId, name) => {
      const existing = tabShowing(state, workspaceId);
      if (existing) return show(selectTab(state, existing));
      const next = tabsTurnedOff ? null : addTab(state, { memory: seedFor(workspaceId), workspaceName: name });
      if (next) show(next);
    },
    closeOthers: () => {
      for (const tab of state.tabs) if (tab.id !== state.active) tabs.close(tab.id);
    },
    // The page decides first, as it would if the window closed (see will-prevent-unload).
    close: (id) => {
      if (state.tabs.length < 2 || !state.tabs.some((tab) => tab.id === id)) return;
      const page = pageOf(id);
      if (!page) return show(closeTab(state, id));
      closingTabs.add(id);
      page.close({ waitForBeforeUnload: true });
    },
    rename: (id, name) => {
      state = renameTab(state, id, name);
      refresh();
      pageOf(state.active)?.focus();
    },
    // While a tab's name is typed the keys go to the strip; afterwards, back to XUNA.
    editing: (active) => (active ? win.webContents : pageOf(state.active))?.focus(),
    startRename: () => {
      if (state.tabs.length < 2) return; // with one tab the strip shows no tab to rename
      win.webContents.focus();
      win.webContents.send('xuna:workspace-tab-rename', state.active);
    },
    // A page asking "Leave this page?" is shown first.
    reveal: (contents) => {
      const id = [...views].find(([, entry]) => entry.page === contents)?.[0];
      if (id && id !== state.active) show(selectTab(state, id));
    },
    // The page answered Stay: it keeps its tab, and the window stays open. Pages the window closed before
    // this one asked open again, so no tab is left empty.
    keepOpen: (contents) => {
      for (const id of closingTabs) if (pageOf(id) === contents) closingTabs.delete(id);
      if (!closingWindow) return;
      closingWindow = false;
      for (const tab of state.tabs) if (!pageOf(tab.id)) openPage(tab.id);
      refresh();
    },
  };
  workspaceTabs.set(win, tabs);

  for (const tab of state.tabs) openPage(tab.id);
  for (const event of ['resize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, () => {
      layout();
      panel.close();
    });
  }
  win.on('focus', () => pageOf(state.active)?.focus()); // typing goes to XUNA, not the strip
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.on('did-finish-load', sendToStrip);
  win.on('close', (event) => {
    if (![...views.keys()].some(pageOf)) return;
    event.preventDefault();
    closingWindow = true;
    closeNextPage();
  });

  win.loadFile(path.join(__dirname, 'title-strip.html')).catch(() => {});
  refresh();
}

// Clicks on the title strip's tab buttons (src/title-strip.js). Only a Mac main window's own strip is heard.
function onWorkspaceTabRequest(event, request) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const tabs = win && win.webContents === event.sender ? workspaceTabs.get(win) : null;
  if (!tabs || typeof request?.type !== 'string') return;
  if (request.type === 'select') tabs.select(request.id);
  else if (request.type === 'add') tabs.pick(anchorOf(request.anchor));
  else if (request.type === 'close') tabs.close(request.id);
  else if (request.type === 'rename') tabs.rename(request.id, request.name);
  else if (request.type === 'editing') tabs.editing(request.active === true);
}

// The + button's rectangle as the strip measured it, or null.
function anchorOf(rect) {
  return rect && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key])) ? rect : null;
}

// The workspace tab whose page this is, as { tabs, id }, or null.
function tabOf(contents) {
  for (const win of BrowserWindow.getAllWindows()) {
    const tabs = workspaceTabs.get(win);
    const id = tabs?.idOf(contents) ?? null;
    if (id) return { tabs, id };
  }
  return null;
}

// Messages only a workspace tab's own XUNA page may send.
function fromTabPage(event, act) {
  const found = policy.isAppPage(event.senderFrame?.url) ? tabOf(event.sender) : null;
  if (found) act(found.tabs, found.id);
}

// What src/preload.js asks as each page starts: the memory a workspace tab's page reads its workspace
// from, or null for a page that keeps the profile's shared storage. A pop-up gets a copy of the memory
// of the tab that opened it, or else of the tab in front, and keeps its own writes.
function onWorkspaceMemoryRequest(event) {
  let memory = null;
  try {
    memory = workspaceMemoryFor(event.sender, event.senderFrame?.url);
  } catch (error) {
    console.error('[workspace tabs]', error);
  }
  // The page waits for this answer, so it always gets one. Setting returnValue sends it, so it is set
  // once: a page is sent whatever was set first.
  event.returnValue = memory;
}

// Only the app's own pages share the tabs' storage, so only they get a tab's memory.
function workspaceMemoryFor(contents, url) {
  if (!USE_TABS || !policy.isAppPage(url)) return null;
  const own = tabOf(contents);
  if (own) isolationGuard.pageStarted(contents.id); // a new page in the tab, which must read its workspace
  const record = own ? null : popupOwners.get(contents);
  const openedFrom = record ? (record.tabs.memoryOf(record.id) ?? record.snapshot ?? null) : undefined;
  let openerTab;
  for (let opener = contents, depth = 0; !own && !record && openerTab === undefined && opener && depth < 8; depth += 1) {
    opener = opener.opener ? webContents.fromFrame(opener.opener) : null;
    const found = opener ? tabOf(opener) : null;
    if (found) openerTab = found.tabs.memoryOf(found.id);
  }
  const front = mainWindow && !mainWindow.isDestroyed() ? workspaceTabs.get(mainWindow) : null;
  const page = memoryForPage({
    ownTab: own ? own.tabs.memoryOf(own.id) : undefined,
    openedFrom,
    openerTab,
    frontTab: front ? front.memoryOf(front.activeId()) : undefined,
  });
  if (!page) return null;
  return {
    prefixes: TAB_KEY_PREFIXES,
    activeKey: ACTIVE_WORKSPACE_KEY,
    values: page.memory ? { ...page.memory.values } : null,
    remembered: page.memory?.remembered ?? null,
    report: page.report,
  };
}

// XUNA removes the current workspace when it signs out, in every tab, since they share the sign-in. The
// + menu then waits for the next sign-in to list the workspaces again.
function onWorkspaceMemoryWrite(event, key, value) {
  if (typeof key !== 'string' || (value !== null && typeof value !== 'string')) return;
  fromTabPage(event, (tabs, id) => {
    if (key === ACTIVE_WORKSPACE_KEY && value === null) workspaceList = null;
    tabs.remember(id, key, value);
  });
}

// An answer to XUNA's sign-in check, from any of the app's pages: the workspaces the + menu offers, and
// the names of all the account's workspaces, for the tabs.
function onWorkspaceList(event, responseText) {
  if (!USE_TABS || typeof responseText !== 'string' || !policy.isAppPage(event.senderFrame?.url)) return;
  const parsed = parseBootstrap(responseText);
  if (!parsed) return;
  workspaceList = parsed.workspaces;
  workspaceNames = parsed.names;
  for (const win of BrowserWindow.getAllWindows()) workspaceTabs.get(win)?.nameAll(workspaceNames);
}

// See createIsolationGuard in src/workspace-memory.js: a tab's page whose sign-in check completes without
// its having read its workspace keeps the workspace somewhere every tab shares. The page is checked,
// not the request, so the guard holds wherever XUNA's API is.
function watchSignInChecks() {
  session.defaultSession.webRequest.onCompleted({ urls: ['*://*/v2/auth/bootstrap*'] }, (details) => {
    if (details.method !== 'POST' || details.statusCode < 200 || details.statusCode >= 300) return;
    const contents = details.webContentsId ? webContents.fromId(details.webContentsId) : null;
    if (contents && tabOf(contents) && policy.isAppPage(contents.getURL())) isolationGuard.bootstrapCompleted(contents.id);
  });
}

// XUNA changed how it remembers the current workspace, so tabs would share one, and a change made in
// one tab could be saved to another's workspace. The app says so once, closes the other tabs (each page
// is asked first, as when a tab closes), and the + menu opens no more.
function turnOffTabs() {
  if (tabsTurnedOff) return;
  tabsTurnedOff = true;
  console.error('[workspace tabs] a page checked its sign-in without reading its workspace; tabs turned off');
  const tabs = mainWindow && !mainWindow.isDestroyed() ? workspaceTabs.get(mainWindow) : null;
  if (!tabs || tabs.count() < 2) return;
  showMessage({
    type: 'warning',
    message: 'Workspace tabs are turned off',
    detail: 'XUNA has changed how it keeps track of your workspace, so XUNA AI can no longer keep your tabs apart. Your other tabs will close, so nothing you do is saved to the wrong workspace. An update to XUNA AI will turn tabs back on.',
    buttons: ['Close Other Tabs'],
    noLink: true,
  }).then(() => tabs.closeOthers());
}

// Tabs used to have a profile each (Electron's persist:workspace-2 to -9), with a sign-in of their own.
// They now share the first, so those profiles are deleted.
function removeOldTabProfiles() {
  for (let slot = 2; slot <= MAX_TABS; slot += 1) {
    try {
      fs.rmSync(path.join(app.getPath('userData'), 'Partitions', `workspace-${slot}`), { recursive: true, force: true });
    } catch (error) {
      console.error('[workspace tabs]', error);
    }
  }
}

function showMainWindow() {
  // The main window can be gone while the app keeps running, if quitting was cancelled by a pop-up's
  // "Leave this page?" prompt. Opening the app again then brings back a main window.
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Installed copies keep themselves up to date and ask to restart for an update (see src/updates.js).
// Development runs skip this.
function startAutoUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  updates = createUpdates({
    updater: autoUpdater,
    version: app.getVersion(),
    platform: process.platform,
    checkEvery: config.UPDATE_CHECK_INTERVAL_MS,
    remindAfter: config.UPDATE_REMIND_AFTER_MS,
    ui: {
      inFront: () => BrowserWindow.getFocusedWindow() !== null,
      onNextFocus: (callback) => app.once('browser-window-focus', () => callback()),
      onWake: (callback) => powerMonitor.on('resume', () => callback()),
      ask: (options) => showMessage({ type: 'info', defaultId: 0, cancelId: 1, noLink: true, ...options }).then(({ response }) => response),
      tell: (options) => showMessage({ type: 'info', ...options }),
      notify: ({ title, body, onClick }) => {
        if (!Notification.isSupported()) return;
        updateNotification = new Notification({ title, body });
        updateNotification.on('click', onClick);
        updateNotification.show();
      },
      showWindow: showMainWindow,
      quitThen: (callback) => {
        afterQuit = callback;
        app.quit();
      },
    },
  });
  updates.start();
}

// Check for Updates… in the menu bar.
function checkForUpdates() {
  if (updates) updates.check({ asked: true });
  else showMessage({ type: 'info', message: 'Updates are off in development runs', detail: 'Installed copies of XUNA AI check for updates.' });
}

// A message box over the window in front, or over the main window while XUNA isn't in front.
function showMessage(options) {
  const owner = BrowserWindow.getFocusedWindow() ?? mainWindow;
  return owner && !owner.isDestroyed() ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
}
