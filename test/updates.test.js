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

function setUp({ platform = 'win32', inFront = true, results = [] } = {}) {
  const updater = new FakeUpdater(...results);
  const ui = fakeUi({ inFront });
  const updates = createUpdates({ updater, ui, version: '1.2.1', platform, checkEvery: 6 * HOURS });
  return { updater, ui, updates };
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

test('checks run at start-up and every few hours, and stop once an update is ready', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { updater, updates } = setUp();
  updates.start();
  assert.equal(updater.checks, 1);
  t.mock.timers.tick(6 * HOURS);
  assert.equal(updater.checks, 2);
  updater.emit('update-downloaded', { version: '1.2.2' });
  t.mock.timers.tick(12 * HOURS);
  assert.equal(updater.checks, 2);
});
