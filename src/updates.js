'use strict';

// Installed copies check this repo's GitHub Releases at start-up, every half hour, when the computer
// wakes, when XUNA comes back to the front (unless they looked a few minutes before) and from Check for
// Updates… in the menu bar, and download an update in the background. Once it
// has downloaded, the app asks to restart for it, even in the middle of work. If XUNA isn't in front, a
// notification says the update is ready, and clicking it, or coming back to XUNA, asks. After Later it
// asks again a few hours on, while the app stays open; an update nobody restarts for installs when the
// app quits. The checks carry on meanwhile, so a newer release replaces the update waiting.
//
// updater is electron-updater's autoUpdater; ui shows the questions, messages and notification (src/main.js
// gives both). No Electron imports, so it is unit-tested in test/updates.test.js.

// recheckAfter: how long after a look coming back to XUNA looks again. schedule(run, wait): when to ask
// again after Later (setTimeout; tests pass their own).
function createUpdates({ updater, ui, version, platform, checkEvery, remindAfter, recheckAfter, schedule = setTimeout }) {
  let ready = null; // the version downloaded and waiting to install
  let asking = false; // the restart question is on screen
  let answers = 0; // how often it has been answered: a reminder is for the latest Later only
  let lastCheck = -Infinity; // when the updater last looked
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
    answers += 1;
    if (choice === 0) return restart();
    const answer = answers;
    schedule(() => {
      if (answer === answers) prompt();
    }, remindAfter);
  };

  // Asks straight away while XUNA is in front; otherwise a notification says the update is ready.
  const prompt = () => {
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

  // With an update waiting, the checks only look (on Mac, downloading the same update again would hand
  // the whole app to Squirrel again every time); a newer release is downloaded, and asks in its turn.
  const onDownloaded = (info) => {
    updater.autoDownload = false;
    if (info.version === ready) return;
    ready = info.version;
    prompt();
  };

  // asked: Check for Updates… was chosen, so the result is shown whatever it is.
  const check = async ({ asked = false } = {}) => {
    if (ready && asked) {
      ask(); // the update waiting; the checks on their own go on looking for a newer one
      return;
    }
    let result;
    lastCheck = Date.now();
    try {
      result = await updater.checkForUpdates();
    } catch {
      // The updater logs the error itself.
      if (asked) ui.tell({ type: 'warning', message: 'Couldn’t check for updates', detail: 'Check your internet connection and try again.' });
      return;
    }
    if (ready && result?.isUpdateAvailable && result.updateInfo?.version !== ready) updater.downloadUpdate().catch(() => {});
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
      setInterval(check, checkEvery);
      ui.onWake(() => check()); // asleep, the computer missed its checks
      // An update released while XUNA was in the background is asked about soon after you come back.
      ui.onFocus(() => {
        if (Date.now() - lastCheck >= recheckAfter) check();
      });
      check();
    },
  };
}

module.exports = { createUpdates };
