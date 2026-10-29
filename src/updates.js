'use strict';

// Installed copies check this repo's GitHub Releases at start-up, every few hours and from Check for
// Updates… in the menu bar, and download an update in the background. Once it has downloaded, the app
// asks to restart for it. If XUNA isn't in front, a notification says the update is ready, and clicking
// it, or coming back to XUNA, asks. An update nobody restarts for installs when the app quits.
//
// updater is electron-updater's autoUpdater; ui shows the questions, messages and notification (src/main.js
// gives both). No Electron imports, so it is unit-tested in test/updates.test.js.

function createUpdates({ updater, ui, version, platform, checkEvery }) {
  let ready = null; // the version downloaded and waiting to install
  let asking = false; // the restart question is on screen
  let timer = null;
  const quitWord = platform === 'darwin' ? 'quit' : 'close'; // closing the window quits the app on Windows

  const restart = () => {
    // On Mac the updater closes the windows, each XUNA page agreeing first as it does when the window
    // closes, then installs and opens the new version. On Windows the installer closes any copy still
    // running, so the app quits first and starts it only once every page has agreed to close.
    if (platform === 'darwin') updater.quitAndInstall();
    else ui.quitThen(() => updater.quitAndInstall(true, true)); // silently, then opens the new version
  };

  const ask = async () => {
    if (!ready || asking) return;
    asking = true;
    const choice = await ui.ask({
      message: `XUNA AI ${ready} is ready to install`,
      detail: `Restart XUNA AI to update now, or the update will install the next time you ${quitWord} it.`,
      buttons: ['Restart Now', 'Later'],
    });
    asking = false;
    if (choice === 0) restart();
  };

  const onDownloaded = (info) => {
    ready = info.version;
    clearInterval(timer); // nothing newer to look for until this one is installed
    if (ui.inFront()) {
      ask();
      return;
    }
    const onClick = () => {
      ui.showWindow();
      ask();
    };
    ui.notify({ title: 'An update is ready', body: `Click to restart XUNA AI and update to version ${ready}.`, onClick });
    ui.onNextFocus(ask);
  };

  // asked: Check for Updates… was chosen, so the result is shown whatever it is.
  const check = async ({ asked = false } = {}) => {
    if (ready) {
      if (asked) ask();
      return;
    }
    let result;
    try {
      result = await updater.checkForUpdates();
    } catch {
      // The updater logs the error itself.
      if (asked) ui.tell({ type: 'warning', message: 'Couldn’t check for updates', detail: 'Check your internet connection and try again.' });
      return;
    }
    result?.downloadPromise?.catch(() => {
      if (asked) ui.tell({ type: 'warning', message: 'Couldn’t download the update', detail: 'Check your internet connection and try again.' });
    });
    if (!asked) return;
    if (!result?.isUpdateAvailable) ui.tell({ message: 'You’re up to date', detail: `XUNA AI ${version} is the newest version.` });
    else if (!ready) ui.tell({ message: `Downloading XUNA AI ${result.updateInfo.version}…`, detail: 'You’ll be asked to restart once it has downloaded.' });
  };

  updater.on('update-downloaded', onDownloaded);
  updater.on('error', (error) => console.error('[updater]', error));

  return {
    check,
    start: () => {
      timer = setInterval(check, checkEvery);
      check();
    },
  };
}

module.exports = { createUpdates };
