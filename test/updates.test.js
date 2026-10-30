'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/updates');

const HOURS = 60 * 60 * 1000;

// Stands in for electron-updater's autoUpdater: each check takes the next result, or fails with it.
class FakeUpdater extends EventEmitter {
  constructor(...results) {
    super();
    this.results = results;
    this.checks = 0;
    this.installs = [];
    this.autoDownload = true;
    this.downloads = 0;
  }

  downloadUpdate() {
    this.downloads += 1;
    return Promise.resolve([]);
  }

  checkForUpdates() {
    this.checks += 1;
    const next = this.results.shift() ?? { isUpdateAvailable: false, updateInfo: { version: '1.2.1' } };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }

  quitAndInstall(...args) {
    this.installs.push(args);
  }
}

// Stands in for the dialogs, notifications and windows. A question stays open until the test answers it.
function fakeUi({ inFront = true } = {}) {
  const ui = {
    front: inFront,
    questions: [],
    answers: [],
    messages: [],
    notifications: [],
    focusListeners: [],
    everyFocus: [],
    wakeListeners: [],
    quits: [],
    windowShown: 0,
    inFront: () => ui.front,
    ask: (options) => {
      ui.questions.push(options);
      return new Promise((resolve) => ui.answers.push(resolve));
    },
    tell: (options) => ui.messages.push(options),
    notify: (options) => ui.notifications.push(options),
    onNextFocus: (callback) => ui.focusListeners.push(callback),
    onFocus: (callback) => ui.everyFocus.push(callback),
    onWake: (callback) => ui.wakeListeners.push(callback),
    showWindow: () => {
      ui.windowShown += 1;
    },
    quitThen: (callback) => ui.quits.push(callback),
  };
  return ui;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const RESTART = 0;
const LATER = 1;

const REMIND_AFTER = 4 * HOURS;
const RECHECK_AFTER = 5 * 60 * 1000;

// Reminders wait in a list until the test runs them.
function setUp({ platform = 'win32', inFront = true, results = [] } = {}) {
  const updater = new FakeUpdater(...results);
  const reminders = [];
  const schedule = (run, wait) => reminders.push({ run, wait });
  const ui = fakeUi({ inFront });
  const updates = createUpdates({ updater, ui, version: '1.2.1', platform, checkEvery: HOURS / 2, remindAfter: REMIND_AFTER, recheckAfter: RECHECK_AFTER, schedule });
  return { updater, ui, updates, reminders };
}

const available = (version, downloadPromise = new Promise(() => {})) => ({ isUpdateAvailable: true, updateInfo: { version }, downloadPromise });

test('an update that finishes downloading while XUNA is in front asks to restart for it', async () => {
  const { updater, ui } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  await settle();
  assert.equal(ui.questions.length, 1);
  assert.match(ui.questions[0].message, /1\.2\.2/);
  assert.deepEqual(ui.questions[0].buttons, ['Restart Now', 'Later']);
  assert.equal(ui.notifications.length, 0);
});

test('Later leaves the update to install when the app quits', async () => {
  const { updater, ui } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](LATER);
  await settle();
  assert.deepEqual(updater.installs, []);
  assert.deepEqual(ui.quits, []);
});

test('Restart Now on Windows quits first, and installs only once the quit goes ahead', async () => {
  // The installer closes any copy still running, so starting it before a page has agreed to close
  // (see will-prevent-unload in src/main.js) would lose that page's unsaved changes.
  const { updater, ui } = setUp({ platform: 'win32' });
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](RESTART);
  await settle();
  assert.equal(ui.quits.length, 1);
  assert.deepEqual(updater.installs, []);
  ui.quits[0]();
  assert.deepEqual(updater.installs, [[true, true]]); // silently, then opens the new version
});

test('Restart Now on Mac hands over to the updater, which closes the windows before installing', async () => {
  const { updater, ui } = setUp({ platform: 'darwin' });
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](RESTART);
  await settle();
  assert.deepEqual(updater.installs, [[]]);
  assert.deepEqual(ui.quits, []);
});

test('when XUNA is not in front, a notification says the update is ready, and clicking it brings XUNA forward and asks', async () => {
  const { updater, ui } = setUp({ inFront: false });
  updater.emit('update-downloaded', { version: '1.2.2' });
  await settle();
  assert.equal(ui.questions.length, 0);
  assert.equal(ui.notifications.length, 1);
  assert.match(ui.notifications[0].body, /1\.2\.2/);
  ui.notifications[0].onClick();
  assert.equal(ui.windowShown, 1);
  assert.equal(ui.questions.length, 1);
});

test('coming back to XUNA after the notification asks too, without a second question on top of the first', async () => {
  const { updater, ui } = setUp({ inFront: false });
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.front = true;
  ui.focusListeners[0]();
  assert.equal(ui.questions.length, 1);
  ui.notifications[0].onClick(); // the question is still open
  assert.equal(ui.questions.length, 1);
  ui.answers[0](LATER);
  await settle();
  ui.notifications[0].onClick(); // clicking it again later asks again
  assert.equal(ui.questions.length, 2);
});

test('automatic checks say nothing unless an update is ready', async () => {
  const { updater, ui, updates } = setUp({ results: [{ isUpdateAvailable: false }, available('1.2.2'), new Error('offline')] });
  for (let i = 0; i < 3; i += 1) await updates.check();
  await settle();
  assert.equal(updater.checks, 3);
  assert.deepEqual(ui.messages, []);
  assert.deepEqual(ui.questions, []);
});

test('Check for Updates… says when XUNA is up to date', async () => {
  const { ui, updates } = setUp({ results: [{ isUpdateAvailable: false, updateInfo: { version: '1.2.1' } }] });
  await updates.check({ asked: true });
  assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].message, /up to date/);
  assert.match(ui.messages[0].detail, /1\.2\.1/);
});

test('Check for Updates… says an update is downloading, then asks to restart once it is ready', async () => {
  const { updater, ui, updates } = setUp({ results: [available('1.2.2')] });
  await updates.check({ asked: true });
  assert.equal(ui.messages.length, 1);
  assert.match(ui.messages[0].message, /Downloading.*1\.2\.2/);
  updater.emit('update-downloaded', { version: '1.2.2' });
  assert.equal(ui.questions.length, 1);
});

test('Check for Updates… once an update has downloaded asks to restart, without checking again', async () => {
  const { updater, ui, updates } = setUp({ inFront: false });
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.front = true;
  await updates.check({ asked: true });
  assert.equal(updater.checks, 0);
  assert.equal(ui.questions.length, 1);
  assert.equal(ui.messages.length, 0);
});

test('Check for Updates… says when the check fails', async () => {
  const { ui, updates } = setUp({ results: [new Error('net::ERR_INTERNET_DISCONNECTED')] });
  await updates.check({ asked: true });
  assert.equal(ui.messages.length, 1);
  assert.equal(ui.messages[0].type, 'warning');
  assert.match(ui.messages[0].message, /Couldn.t check for updates/);
});

test('Check for Updates… says when the download fails', async () => {
  const { ui, updates } = setUp({ results: [available('1.2.2', Promise.reject(new Error('net::ERR_CONNECTION_RESET')))] });
  await updates.check({ asked: true });
  await settle();
  assert.equal(ui.messages.length, 2); // "Downloading", then the failure
  assert.equal(ui.messages[1].type, 'warning');
  assert.match(ui.messages[1].message, /Couldn.t download/);
});

test('installed copies look for an update every half hour, so one released while XUNA is open turns up soon', () => {
  const config = require('../src/config');
  assert.equal(config.UPDATE_CHECK_INTERVAL_MS, 30 * 60 * 1000);
  assert.equal(config.UPDATE_REMIND_AFTER_MS, 4 * HOURS);
  assert.equal(config.UPDATE_RECHECK_AFTER_MS, RECHECK_AFTER);
});

test('coming back to XUNA looks for an update, unless it looked in the last five minutes', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { updater, ui, updates } = setUp();
  const comeBack = () => ui.everyFocus.forEach((callback) => callback());
  updates.start(); // a look at start-up
  t.mock.timers.tick(RECHECK_AFTER - 1);
  comeBack();
  assert.equal(updater.checks, 1);
  t.mock.timers.tick(1);
  comeBack();
  assert.equal(updater.checks, 2);
  comeBack(); // straight after that look
  assert.equal(updater.checks, 2);
});

test('the half-hourly look and the look on waking hold off the look on return too', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { updater, ui, updates } = setUp();
  const comeBack = () => ui.everyFocus.forEach((callback) => callback());
  updates.start();
  t.mock.timers.tick(HOURS / 2); // the half-hourly look
  comeBack();
  assert.equal(updater.checks, 2);
  t.mock.timers.tick(10 * 60 * 1000);
  ui.wakeListeners[0]();
  comeBack();
  assert.equal(updater.checks, 3);
});

test('a look that failed, before the network was back after waking say, does not hold off the look on return', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const { updater, ui, updates } = setUp({ results: [new Error('net::ERR_INTERNET_DISCONNECTED')] });
  const comeBack = () => ui.everyFocus.forEach((callback) => callback());
  updates.start(); // the look at start-up fails
  await settle();
  comeBack();
  assert.equal(updater.checks, 2);
});

test('checks run at start-up and every half hour, and carry on once an update is ready, so a newer one can replace it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { updater, updates } = setUp();
  updates.start();
  assert.equal(updater.checks, 1);
  t.mock.timers.tick(HOURS / 2);
  assert.equal(updater.checks, 2);
  updater.emit('update-downloaded', { version: '1.2.2' });
  t.mock.timers.tick(HOURS);
  assert.equal(updater.checks, 4);
});

test('a computer waking from sleep looks for an update straight away', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { updater, ui, updates } = setUp();
  updates.start();
  ui.wakeListeners[0]();
  assert.equal(updater.checks, 2);
});

test('an update found again on a later check is not asked about again', async () => {
  const { updater, ui } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](LATER);
  await settle();
  updater.emit('update-downloaded', { version: '1.2.2' });
  assert.equal(ui.questions.length, 1);
});

test('a newer update replaces the one waiting, and asks about it', async () => {
  const { updater, ui } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](LATER);
  await settle();
  updater.emit('update-downloaded', { version: '1.2.3' });
  assert.equal(ui.questions.length, 2);
  assert.match(ui.questions[1].message, /1\.2\.3/);
});

test('after Later, XUNA asks again a few hours on, even while it is being used', async () => {
  const { updater, ui, reminders } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](LATER);
  await settle();
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].wait, REMIND_AFTER);
  reminders[0].run();
  assert.equal(ui.questions.length, 2);
});

test('a reminder while XUNA is not in front comes as a notification, and a newer answer replaces an older reminder', async () => {
  const { updater, ui, reminders } = setUp();
  updater.emit('update-downloaded', { version: '1.2.2' });
  ui.answers[0](LATER);
  await settle();
  updater.emit('update-downloaded', { version: '1.2.3' }); // asked again, and Later again
  ui.answers[1](LATER);
  await settle();
  reminders[0].run(); // the first reminder is out of date
  assert.equal(ui.questions.length, 2);
  ui.front = false;
  reminders[1].run();
  assert.equal(ui.questions.length, 2);
  assert.equal(ui.notifications.length, 1);
  assert.match(ui.notifications[0].body, /1\.2\.3/);
});

test('with an update waiting, checks only look, and download again only for a newer release', async () => {
  // Downloading the same update again would hand the whole app to Squirrel again on Mac, every half hour.
  const { updater, updates } = setUp({ results: [available('1.2.2'), available('1.2.3')] });
  updater.emit('update-downloaded', { version: '1.2.2' });
  assert.equal(updater.autoDownload, false);
  await updates.check();
  assert.equal(updater.downloads, 0);
  await updates.check();
  assert.equal(updater.downloads, 1);
});
