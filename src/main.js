'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, WebContentsView, dialog, ipcMain, nativeTheme, powerMonitor, pushNotifications, screen, session, shell, webContents } = require('electron');
const config = require('./config');
const { createPolicy, isSafeExternalUrl, chromeUserAgent, isFromOwnPage } = require('./policy');
const { buildAppMenu, attachContextMenu, tabMenuTemplate } = require('./menus');
const { createUpdates } = require('./updates');
const { reloadOnCrash } = require('./reload-on-crash');
const { MAC_TITLE_STRIP_HEIGHT, MAC_TRAFFIC_LIGHTS, titleBarColor, macWindowLayout, headerReport, clusterReport, rememberedBar, askAiState } = require('./title-bar');
const { shownTabs } = require('./title-strip-layout');
const { chooseBounds, readState, writeState } = require('./window-state');
const { MAX_TABS, labelFor, readTabs, addTab, closeTab, selectTab, cycleTab, renameTab, moveTab, setTabMemory, nameWorkspaces, tabShowing } = require('./workspace-tabs');
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
// With workspace tabs the window's own page stays empty, under the title strip's view and the XUNA pages'.
const WINDOW_PAGE_PREFERENCES = { contextIsolation: true, sandbox: true, nodeIntegration: false };
// What makes room in XUNA's header for the strip in one row, and hides XUNA's logo while the bar shows its
// own, put into each tab's page (see src/one-row.css).
const ONE_ROW_CSS = fs.readFileSync(path.join(__dirname, 'one-row.css'), 'utf8');

// Development runs get their own profile, so they neither trip an installed copy's single-instance lock nor share its sign-in.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()} Dev`));

app.userAgentFallback = chromeUserAgent(process.versions.chrome, process.platform);
if (IS_WINDOWS) app.setAppUserModelId(config.APP_ID);

let mainWindow = null;
let titleBar = null; // XUNA's black or white for the title bars: Windows' own, and the strip on Mac
let pushRegistration = Promise.resolve(null); // where XUNA's servers send this Mac's push notifications (macOS only)
// On Mac the XUNA pages are views under the title strip's, one per workspace tab (see addWorkspaceTabs);
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
    ipcMain.on('xuna:workspace-memory', onWorkspaceMemoryRequest);
    ipcMain.on('xuna:workspace-memory-init', (event, values) => fromTabPage(event, (tabs, id) => tabs.adopt(id, values)));
    ipcMain.on('xuna:workspace-memory-write', onWorkspaceMemoryWrite);
    ipcMain.on('xuna:workspace-memory-read', (event) => fromTabPage(event, () => isolationGuard.pageRead(event.sender.id)));
    ipcMain.on('xuna:workspace-list', onWorkspaceList);
    ipcMain.on('xuna:ask-ai-state', (event, report) => fromTabPage(event, (tabs, id) => tabs.setAskAi(id, report)));
    ipcMain.on('xuna:title-bar-header', (event, report, waiting) => fromTabPage(event, (tabs, id) => tabs.setHeader(id, report, waiting)));
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
  // With workspace tabs the window opens with the bar as the last one closed with it (rememberedBar in
  // src/title-bar.js): in XUNA's black or white, and in one row if it was, the three buttons already there.
  const remembered = USE_TABS ? rememberedBar(readState(titleBarFile())) : null;
  if (typeof remembered?.dark === 'boolean') titleBar = remembered.dark ? config.BACKGROUND.dark : config.BACKGROUND.light;
  const lights = remembered ? macWindowLayout({ width: bounds.width, height: bounds.height, fullScreen: false, header: remembered.header, cluster: remembered.cluster }).trafficLights : MAC_TRAFFIC_LIGHTS;

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 500,
    title: 'XUNA AI',
    backgroundColor: (USE_TABS && titleBar) || backgroundColor(),
    ...titleBarOptions(),
    ...(IS_MAC ? { titleBarStyle: 'hidden', trafficLightPosition: lights } : {}),
    autoHideMenuBar: true,
    // With workspace tabs the title strip and the XUNA pages are views over the window's own page.
    webPreferences: USE_TABS ? WINDOW_PAGE_PREFERENCES : XUNA_PAGE_PREFERENCES,
  });
  if (USE_TABS) addWorkspaceTabs(win, XUNA_PAGE_PREFERENCES, remembered);
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

// Where a window with workspace tabs keeps the bar as it closed with it (rememberedBar in src/title-bar.js).
function titleBarFile() {
  return path.join(app.getPath('userData'), 'title-bar.json');
}

// Opens XUNA in a page. A page that can't load shows the offline page, and one that crashes reloads.
function showXuna(contents) {
  contents.on('did-fail-load', (_event, errorCode, _description, url, isMainFrame) => {
    // -3 is an aborted load (a redirect or a superseded navigation), not a failure.
    if (!isMainFrame || errorCode === -3 || url.startsWith('file:')) return;
    const retryUrl = policy.isTrustedPage(url) ? url : APP_URL;
    contents.loadFile(path.join(__dirname, 'offline.html'), { query: { url: retryUrl } }).catch(() => {});
  });
  reloadOnCrash(contents);
  contents.loadURL(APP_URL).catch(() => {}); // failures are handled by did-fail-load
}

// macOS draws its title bar in its own grey, whatever theme XUNA shows. So on Mac the window hides it,
// keeping the three buttons over a bar in XUNA's own colours, drawn by src/title-strip.html in a view
// above the XUNA pages. Where the tab in front shows XUNA's header, that header is the bar, in one row:
// the page fills the window, and the strip's view covers only the bar's left end, with XUNA's logo, Back
// and Forward, the workspace tabs and +. Elsewhere the strip runs above the page, in XUNA's black or white (see
// macWindowLayout in src/title-bar.js).
//
// Each workspace tab is a XUNA page in a view of its own. The tabs share one sign-in, and each keeps
// its own workspace (see src/workspace-memory.js). Only the shown tab's view is visible; the others keep
// running, so a call or a draft carries on while another workspace is in front. The tabs, their names,
// their workspaces and the one shown are saved, and the window opens with them again. The + button opens
// a menu of the account's workspaces (src/workspace-picker.js).
//
// The window opens with the bar as the last one closed with it (remembered: rememberedBar in
// src/title-bar.js), so the bar is drawn once, in its place, rather than as the strip first and in one row
// once XUNA has drawn its header. A tab whose page hasn't shown XUNA's header yet, or whose header XUNA
// has taken away for a moment, as while XUNA loads or switches workspace, keeps the bar's place for it
// (the header last seen, for a page that has said nothing yet), and the bar lets the page show through
// meanwhile.
function addWorkspaceTabs(win, webPreferences, remembered) {
  const stateFile = path.join(app.getPath('userData'), 'workspace-tabs.json');
  let state = readTabs(readState(stateFile));
  const views = new Map(); // tab id → { view, page }; the page is held, since view.webContents is undefined once it is destroyed
  const closingTabs = new Set(); // tabs being closed, whose page is deciding whether it may go
  const askAi = new Map(); // tab id → what its page says about XUNA's Ask AI (askAiState in src/title-bar.js)
  let closingWindow = false; // the window is closing its pages, one at a time
  const headers = new Map(); // tab id → XUNA's header, as its page reports it (headerReport in src/title-bar.js), or null for none
  let lastHeader = remembered?.header ?? null; // XUNA's header as last seen in any tab, or as the window opened with it
  const headerShown = new Set(); // tabs whose page shows XUNA's header, and has since it last loaded
  let cluster = remembered?.cluster ?? null; // the room the bar's left end needs in one row, as the strip measures it (clusterReport)
  let bar = null; // where everything goes (macWindowLayout in src/title-bar.js)
  let lightsAt = (IS_MAC && win.getWindowButtonPosition?.()) || MAC_TRAFFIC_LIGHTS; // where the three buttons are
  const rowsSent = new WeakMap(); // XUNA page → what it was last told about the room in its header (see sendRows)
  const headerOf = (id) => (headers.has(id) ? headers.get(id) : lastHeader);

  // The title strip, in a view kept above the tabs' pages. Its page talks only to this window's tabs, and
  // loads again if it crashes.
  const strip = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'title-strip-preload.js') },
  });
  strip.setBackgroundColor('#00000000'); // the window's colour shows through until the strip is told the bar's
  win.contentView.addChildView(strip);
  const stripPage = strip.webContents;
  let stripUrl = null; // the strip page's address once it has started: only that page is heard (see isFromOwnPage)
  reloadOnCrash(stripPage);

  const pageOf = (id) => {
    const entry = views.get(id);
    return entry && !entry.page.isDestroyed() ? entry.page : null;
  };

  // Places the views for the tab in front (macWindowLayout in src/title-bar.js), moves the three buttons
  // with the bar, and tells each tab's page the room made in its header. The + panel closes when the
  // bar changes under it, which would leave it out of place and its top over the bar. True when the
  // bar's mode or height changed, which the strip then has to be told.
  const arrange = () => {
    if (win.isDestroyed()) return false;
    const [width, height] = win.getContentSize();
    const before = bar;
    const zoom = pageOf(state.active)?.getZoomFactor() ?? 1;
    bar = macWindowLayout({ width, height, fullScreen: win.isFullScreen(), tabCount: state.tabs.length, header: headerOf(state.active), cluster, zoom });
    for (const { view } of views.values()) view.setBounds(bar.page);
    if (bar.strip) strip.setBounds(bar.strip);
    strip.setVisible(Boolean(bar.strip));
    if (IS_MAC && (bar.trafficLights.x !== lightsAt.x || bar.trafficLights.y !== lightsAt.y)) {
      lightsAt = bar.trafficLights;
      win.setWindowButtonPosition(lightsAt);
    }
    if (before && (before.mode !== bar.mode || before.barBottom !== bar.barBottom)) panel.close();
    sendRows();
    return before?.mode !== bar.mode || before?.barHeight !== bar.barHeight;
  };

  // Each tab's page applies the room made in XUNA's header for the strip (see watchHeader in
  // src/preload.js). Wherever the strip shows, it shows XUNA's logo, and XUNA's header hides its own
  // (src/one-row.css). A page hears again only when that changes, or once it has loaded afresh.
  const sendRows = () => {
    const row = bar?.mode === 'one-row' ? { inset: bar.inset } : null;
    const message = { ...row, logo: Boolean(bar?.strip) };
    const word = JSON.stringify(message);
    for (const { page } of views.values()) {
      if (page.isDestroyed() || rowsSent.get(page) === word) continue;
      rowsSent.set(page, word);
      page.send('xuna:title-bar-row', message);
    }
  };

  // The tabs as the strip draws them (shownTabs in src/title-strip-layout.js). known: the tab stands for a
  // workspace you are in, by its name or its workspace's, as you are signed in: XUNA has listed your
  // workspaces, or, until it has this run, shows its header (or is expected to, as the window opens). Not
  // on a new copy's sign-in page, signed out, or with tabs turned off, when a tab on its own isn't drawn.
  const stripTabs = () => {
    const signedIn = Array.isArray(workspaceList) || (workspaceList === undefined && headerOf(state.active) !== null);
    return state.tabs.map((tab) => ({
      id: tab.id,
      label: labelFor(tab),
      active: tab.id === state.active,
      known: !tabsTurnedOff && signedIn && Boolean(tab.name || tab.workspaceName),
    }));
  };

  const sendToStrip = () => {
    if (stripPage.isDestroyed()) return;
    const page = pageOf(state.active);
    const header = headerOf(state.active);
    const oneRow = bar?.mode === 'one-row';
    // In one row the bar is XUNA's header: it takes the header's colours, and looks covered when the page
    // is. While the page doesn't show its header, as while XUNA's loader shows, the bar lets the page show
    // through instead, so its left end doesn't stand out as a box of its own.
    const asHeader = oneRow && headerShown.has(state.active);
    stripPage.send('xuna:workspace-tabs', {
      tabs: stripTabs(),
      dark: titleBar === config.BACKGROUND.dark,
      askAi: askAiState(askAi.get(state.active)),
      bar: {
        mode: oneRow ? 'one-row' : 'strip',
        height: bar?.barHeight ?? MAC_TITLE_STRIP_HEIGHT,
        background: oneRow ? (asHeader && (header?.background || titleBar)) || null : titleBar || backgroundColor(),
        border: (asHeader && header?.border) || null,
        lights: IS_MAC,
        cover: (asHeader && header?.cover) || null,
      },
      history: { back: Boolean(page?.navigationHistory.canGoBack()), forward: Boolean(page?.navigationHistory.canGoForward()) },
    });
  };

  // What the Window menu lists and does (see src/menus.js). ⌘W closes a tab only while this window is
  // in front, so pressing it in a sign-in pop-up never closes the tab behind.
  const menu = () => ({
    list: state.tabs.map((tab) => ({ id: tab.id, label: labelFor(tab), active: tab.id === state.active })),
    pick: () => stripPage.send('xuna:workspace-picker-open'), // the strip opens it under its + button
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
    arrange();
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

  // Opens a tab's XUNA page in a hidden view, under the strip's. Every tab shares the one sign-in.
  const openPage = (id) => {
    const view = new WebContentsView({ webPreferences });
    const page = view.webContents;
    view.setBackgroundColor(titleBar || backgroundColor()); // XUNA's black or white, until XUNA draws
    view.setVisible(false);
    win.contentView.addChildView(view);
    win.contentView.addChildView(strip); // again, which keeps the strip above every tab's page
    views.set(id, { view, page });
    // In one row XUNA's header makes room for the strip (src/one-row.css), once its page is told how much.
    // The page in front places the bar first, at the zoom Chromium gave it as it started.
    page.on('dom-ready', () => {
      if (policy.isAppPage(page.getURL())) page.insertCSS(ONE_ROW_CSS).catch(() => {});
      rowsSent.delete(page);
      if (pageOf(state.active) !== page) sendRows();
      else if (arrange()) sendToStrip(); // which tells the pages too
    });
    // Back and Forward follow the page in front. A new page draws XUNA's header afresh. A page outside
    // XUNA's app, such as the offline page or a payment provider's, has no XUNA header to be the bar, and
    // says nothing about one.
    const onNavigated = () => {
      if (pageOf(state.active) === page) sendToStrip();
    };
    page.on('did-navigate', (_event, url) => {
      headerShown.delete(id);
      if (!policy.isAppPage(url)) {
        headers.set(id, null);
        if (pageOf(state.active) === page) arrange();
      }
      onNavigated();
    });
    page.on('did-navigate-in-page', onNavigated);
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
    askAi.delete(id);
    headers.delete(id);
    headerShown.delete(id);
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
    barBottom: () => bar?.barBottom ?? 0, // it opens below the bar
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
    // What a tab's page says about XUNA's own Ask AI (see watchAskAi in src/preload.js).
    setAskAi: (id, report) => {
      askAi.set(id, askAiState(report));
      if (id === state.active) sendToStrip();
    },
    // The strip's Ask AI: XUNA's own button, pressed in the tab in front, and the keyboard there.
    askAi: () => {
      const page = pageOf(state.active);
      if (!page || !askAi.get(state.active)?.available) return;
      page.send('xuna:ask-ai-toggle');
      page.focus();
    },
    // The strip's XUNA logo: XUNA's home in the tab in front, as XUNA's own logo link goes there. A page
    // outside XUNA's app, such as a payment provider's or the offline page, goes back to XUNA.
    home: () => {
      const page = pageOf(state.active);
      if (!page) return;
      if (policy.isAppPage(page.getURL())) page.send('xuna:go-home');
      else page.loadURL(APP_URL).catch(() => {}); // a page that can't load shows the offline page (see showXuna)
      page.focus();
    },
    // What a tab's page says about XUNA's header (see watchHeader in src/preload.js): the header, or none.
    // waiting: none just now, but XUNA may yet draw it, so the bar keeps its place for it.
    setHeader: (id, report, waiting) => {
      const header = headerReport(report);
      if (header) {
        headers.set(id, header);
        lastHeader = { ...header, cover: null };
        headerShown.add(id);
      } else {
        if (waiting !== true) headers.set(id, null);
        headerShown.delete(id);
      }
      if (id !== state.active) return;
      arrange();
      sendToStrip();
    },
    // The strip's measure of the bar's left end in one row (see measure in src/title-strip.js).
    measure: (widths) => {
      const next = clusterReport(widths);
      if (JSON.stringify(next) === JSON.stringify(cluster)) return;
      cluster = next;
      if (arrange()) sendToStrip();
    },
    back: () => {
      const page = pageOf(state.active);
      if (page?.navigationHistory.canGoBack()) page.navigationHistory.goBack();
      page?.focus();
    },
    forward: () => {
      const page = pageOf(state.active);
      if (page?.navigationHistory.canGoForward()) page.navigationHistory.goForward();
      page?.focus();
    },
    // A tab right-clicked in the strip (tabMenuTemplate in src/menus.js).
    tabMenu: (id) => {
      if (!state.tabs.some((tab) => tab.id === id)) return;
      const template = tabMenuTemplate({ count: state.tabs.length, rename: () => tabs.startRename(id), close: () => tabs.close(id), closeOthers: () => tabs.closeOthers(id) });
      Menu.buildFromTemplate(template).popup({ window: win });
    },
    // A tab dragged to a new place. A drop that changes nothing redraws the strip, which waits to hear.
    move: (id, index) => {
      const next = moveTab(state, id, index);
      if (next === state) return sendToStrip();
      state = next;
      refresh();
    },
    // Every tab but keep: the one shown, unless another is named, which is then shown.
    closeOthers: (keep = state.active) => {
      if (keep !== state.active) tabs.select(keep);
      for (const tab of state.tabs) if (tab.id !== keep) tabs.close(tab.id);
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
    editing: (active) => (active ? stripPage : pageOf(state.active))?.focus(),
    // The tab shown, unless another is named (from its own menu).
    // Only a tab the bar shows: none while the bar is hidden (full screen with one tab), and not a tab on its
    // own that isn't drawn yet, or the keyboard would go to the strip with no name field to type in.
    startRename: (id = state.active) => {
      if (!bar?.strip || !shownTabs(stripTabs()).some((tab) => tab.id === id)) return;
      stripPage.focus();
      stripPage.send('xuna:workspace-tab-rename', id);
    },
    // The strip draws the tabs again, after something they depend on changed outside them.
    redraw: () => sendToStrip(),
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

  // What the strip's buttons ask for (src/title-strip.js). Only this window's own strip is heard.
  stripPage.ipc.on('xuna:workspace-tab-request', (event, request) => {
    if (!isFromOwnPage(event.senderFrame, stripUrl) || typeof request?.type !== 'string') return;
    if (request.type === 'select') tabs.select(request.id);
    else if (request.type === 'add') tabs.pick(anchorOf(request.anchor));
    else if (request.type === 'close') tabs.close(request.id);
    else if (request.type === 'rename') tabs.rename(request.id, request.name);
    else if (request.type === 'editing') tabs.editing(request.active === true);
    else if (request.type === 'ask-ai') tabs.askAi();
    else if (request.type === 'home') tabs.home();
    else if (request.type === 'back') tabs.back();
    else if (request.type === 'forward') tabs.forward();
    else if (request.type === 'measure') tabs.measure(request.widths);
    else if (request.type === 'tab-menu') tabs.tabMenu(request.id);
    else if (request.type === 'move') tabs.move(request.id, request.index);
  });

  for (const tab of state.tabs) openPage(tab.id);
  for (const event of ['resize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, () => {
      if (arrange()) sendToStrip();
      panel.close();
    });
  }
  // Typing goes to XUNA, not the strip.
  win.on('focus', () => pageOf(state.active)?.focus());
  win.on('page-title-updated', (event) => event.preventDefault());
  // The strip's page is known by its address as soon as it starts, before its scripts run: it can
  // measure and take clicks long before it finishes loading, which waits for XUNA's font. It is told
  // what to draw as soon as its script is listening, and shows nothing till then.
  stripPage.on('did-navigate', () => {
    stripUrl ??= stripPage.getURL();
  });
  stripPage.on('dom-ready', sendToStrip);
  win.once('closed', () => {
    if (!stripPage.isDestroyed()) stripPage.close(); // on Mac the app stays open after its window closes
  });
  // The next window opens with the bar as this one leaves it, kept as the window starts closing, while
  // every page is still there. Signed in, it opens on XUNA's app, with its header, whatever the tab in
  // front shows now (the offline page say); otherwise as the tab in front is.
  win.on('close', (event) => {
    if (![...views.keys()].some(pageOf)) return;
    event.preventDefault();
    if (!closingWindow) {
      const header = Array.isArray(workspaceList) ? lastHeader : headerOf(state.active);
      writeState(titleBarFile(), rememberedBar({ header, cluster, dark: titleBar === config.BACKGROUND.dark }));
    }
    closingWindow = true;
    closeNextPage();
  });

  stripPage.loadFile(path.join(__dirname, 'title-strip.html')).catch(() => {});
  refresh();
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
  tabs?.redraw(); // a tab on its own stops showing, as its name would no longer follow its workspace
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
    recheckAfter: config.UPDATE_RECHECK_AFTER_MS,
    ui: {
      inFront: () => BrowserWindow.getFocusedWindow() !== null,
      onNextFocus: (callback) => app.once('browser-window-focus', () => callback()),
      onFocus: (callback) => app.on('browser-window-focus', () => callback()),
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
