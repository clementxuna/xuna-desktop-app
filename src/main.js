'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, WebContentsView, dialog, ipcMain, nativeTheme, pushNotifications, screen, session, shell } = require('electron');
const config = require('./config');
const { createPolicy, isSafeExternalUrl, chromeUserAgent } = require('./policy');
const { buildAppMenu, attachContextMenu } = require('./menus');
const { titleBarColor, macAppViewBounds } = require('./title-bar');
const { chooseBounds, readState, writeState } = require('./window-state');

// XUNA_APP_URL points a development run at a preview or local deploy; installed copies always open the live app.
const APP_URL = (!app.isPackaged && process.env.XUNA_APP_URL) || config.APP_URL;
const policy = createPolicy({ appUrl: APP_URL, trustedDomain: config.TRUSTED_DOMAIN });
const IS_MAC = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

// Development runs get their own profile, so they neither trip an installed copy's single-instance lock nor share its sign-in.
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()} Dev`));

app.userAgentFallback = chromeUserAgent(process.versions.chrome, process.platform);
if (IS_WINDOWS) app.setAppUserModelId(config.APP_ID);

let mainWindow = null;
let titleBar = null; // XUNA's black or white for the title bars: Windows' own, and the strip on Mac
let pushRegistration = Promise.resolve(null); // where XUNA's servers send this Mac's push notifications (macOS only)
// On Mac the XUNA page is a view below the title strip (see addMacAppView); elsewhere it is the window's own page.
const appPages = new WeakMap(); // Mac main window → its XUNA view's web contents
let quitting = false; // a quit the XUNA page is holding up, to finish once the page has closed (macOS)

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
  app.whenReady().then(() => {
    titleBar = titleBarColor({ prefersDark: nativeTheme.shouldUseDarkColors }); // until the page reports its theme
    ipcMain.on('xuna:page-appearance', onPageAppearance);
    installPermissionHandlers();
    Menu.setApplicationMenu(buildAppMenu(appContents));
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
// above the page takes the colour instead (see addMacAppView).
function titleBarOptions() {
  return IS_WINDOWS && titleBar ? { accentColor: titleBar } : {};
}

// The page showing XUNA in a window: the view below the strip on Mac, otherwise the window's own page.
function appContents(win) {
  const page = appPages.get(win);
  return page && !page.isDestroyed() ? page : win.webContents;
}

// The window a page is shown in, the XUNA view of a Mac window included.
function windowOf(contents) {
  return BrowserWindow.getAllWindows().find((win) => win.webContents === contents || appContents(win) === contents) ?? null;
}

function openExternal(url) {
  if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
}

// src/preload.js reports the theme the XUNA page is showing; the title bars follow it.
function onPageAppearance(event, appearance) {
  if (!windowOf(event.sender) || !policy.isTrustedPage(event.senderFrame?.url)) return;
  const color = titleBarColor(appearance);
  if (color === titleBar) return;
  titleBar = color;
  for (const win of BrowserWindow.getAllWindows()) {
    if (IS_WINDOWS) win.setAccentColor(color);
    else if (appPages.has(win)) win.setBackgroundColor(color); // the Mac strip shows the window's background
  }
}

// Applied to every page the app shows, pop-ups included.
function harden(contents) {
  contents.setWindowOpenHandler((details) => {
    const verdict = policy.windowOpen({ ...details, openerUrl: contents.getURL() });
    if (verdict === 'in-app') {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: backgroundColor(), ...titleBarOptions() } };
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
    const choice = owner ? dialog.showMessageBoxSync(owner, options) : dialog.showMessageBoxSync(options);
    if (choice === 0) event.preventDefault();
    else quitting = false; // staying abandons any quit in progress
  });

  if (contents.getType() === 'window') attachContextMenu(contents, openExternal);
}

function installPermissionHandlers() {
  const pageUrl = (contents, fallback) => (contents && !contents.isDestroyed() && contents.getURL()) || fallback || '';
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(policy.permission(permission, {
      pageUrl: pageUrl(contents, details.requestingUrl),
      requestingUrl: details.requestingUrl,
      externalUrl: details.externalURL,
      mediaTypes: details.mediaTypes,
    }));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
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

  const appPreferences = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: true,
    preload: path.join(__dirname, 'preload.js'),
  };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 500,
    title: 'XUNA AI',
    backgroundColor: (IS_MAC && titleBar) || backgroundColor(),
    ...titleBarOptions(),
    ...(IS_MAC ? { titleBarStyle: 'hidden' } : {}),
    autoHideMenuBar: true,
    // On Mac the window's own page is the title strip, which needs nothing; XUNA gets a view below it.
    webPreferences: IS_MAC ? { contextIsolation: true, sandbox: true, nodeIntegration: false } : appPreferences,
  });
  const contents = IS_MAC ? addMacAppView(win, appPreferences) : win.webContents;
  if (maximized) win.maximize();
  win.on('close', () => writeState(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized() }));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    // Sign-in and connect pop-ups have no purpose without the main window. On macOS the app itself
    // stays in the Dock, and clicking its icon opens a new main window.
    if (!IS_MAC) app.quit();
    else for (const other of BrowserWindow.getAllWindows()) other.close();
  });

  // Mouse back/forward buttons.
  win.on('app-command', (_event, command) => {
    const history = contents.navigationHistory;
    if (command === 'browser-backward' && history.canGoBack()) history.goBack();
    if (command === 'browser-forward' && history.canGoForward()) history.goForward();
  });

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
  return win;
}

// macOS draws its title bar in its own grey, whatever theme XUNA shows. So on Mac the window hides it,
// keeping the three buttons, over a strip in XUNA's black or white: the window's background, which
// onPageAppearance keeps in step with the page. src/title-strip.html, the window's own page, makes the
// strip drag the window. XUNA's page is a view below the strip. Returns that view's web contents.
function addMacAppView(win, webPreferences) {
  const view = new WebContentsView({ webPreferences });
  const page = view.webContents; // held here: once the page is destroyed, view.webContents is undefined
  view.setBackgroundColor(backgroundColor());
  win.contentView.addChildView(view);
  appPages.set(win, page);

  const layout = () => {
    const [width, height] = win.getContentSize();
    view.setBounds(macAppViewBounds({ width, height, fullScreen: win.isFullScreen() }));
  };
  layout();
  for (const event of ['resize', 'enter-full-screen', 'leave-full-screen']) win.on(event, layout);
  win.on('focus', () => {
    if (!page.isDestroyed()) page.focus(); // typing goes to XUNA, not the strip
  });

  // The window takes the XUNA page's title, as it did when the page was its own (the Window menu shows it).
  win.on('page-title-updated', (event) => event.preventDefault());
  page.on('page-title-updated', (_event, title) => win.setTitle(title));

  // Closing the window asks the XUNA page first, which may have unsaved changes (see will-prevent-unload);
  // the window closes once the page has gone. A quit the page held up carries on from there.
  win.on('close', (event) => {
    if (page.isDestroyed()) return;
    event.preventDefault();
    page.close({ waitForBeforeUnload: true });
  });
  page.once('destroyed', () => {
    if (quitting) app.quit();
    else if (!win.isDestroyed()) win.close();
  });

  win.loadFile(path.join(__dirname, 'title-strip.html')).catch(() => {});
  return page;
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

// Installed copies check GitHub Releases at start-up and every few hours, download in the background
// and install when the app quits. Development runs skip this.
function startAutoUpdates() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch((error) => console.error('[updater]', error));
  autoUpdater.on('error', (error) => console.error('[updater]', error));
  const timer = setInterval(check, config.UPDATE_CHECK_INTERVAL_MS);
  autoUpdater.once('update-downloaded', () => clearInterval(timer));
  check();
}
