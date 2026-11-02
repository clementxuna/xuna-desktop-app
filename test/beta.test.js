'use strict';

// XUNA AI Beta is production's code with a second identity (see "XUNA AI Beta" in the README). These checks
// keep the two apps apart: anything that let one reach the other's users, sign-ins or updates fails here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { identityFor } = require('../src/config');
const { betaBuild, betaVersion } = require('../electron-builder.beta.js');
const pkg = require('../package.json');

const FEED = 'https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest';
const beta = betaBuild('1.2.3');
const pngSize = (file) => fs.readFileSync(path.join(__dirname, '..', file)).readUInt32BE(16);

test('a copy built without a channel is production', () => {
  assert.deepEqual(identityFor({}), { APP_ID: 'ai.xuna.desktop', APP_URL: 'https://app.xuna.ai', PRODUCT_NAME: 'XUNA AI', MAC_PUSH: true });
});

test('a copy built for beta is beta', () => {
  assert.deepEqual(identityFor({ packageChannel: 'beta' }), { APP_ID: 'ai.xuna.desktop.beta', APP_URL: 'https://beta.xuna.ai', PRODUCT_NAME: 'XUNA AI Beta', MAC_PUSH: false });
});

test('a development run can ask for beta', () => {
  assert.equal(identityFor({ defaultApp: true, envChannel: 'beta' }).PRODUCT_NAME, 'XUNA AI Beta');
});

test('an installed production copy ignores XUNA_CHANNEL', () => {
  assert.equal(identityFor({ envChannel: 'beta' }).APP_ID, 'ai.xuna.desktop');
});

test('an unknown channel is production', () => {
  assert.equal(identityFor({ packageChannel: 'nightly', defaultApp: true, envChannel: 'nightly' }).APP_ID, 'ai.xuna.desktop');
});

test('the beta app has its own identity, and the version it was given', () => {
  assert.equal(beta.appId, 'ai.xuna.desktop.beta');
  assert.equal(beta.productName, 'XUNA AI Beta');
  assert.deepEqual(beta.extraMetadata, { name: 'xuna-beta', productName: 'XUNA AI Beta', version: '1.2.3', xunaChannel: 'beta' });
});

test('config and the build agree, or Windows would send beta’s notifications elsewhere', () => {
  const identity = identityFor({ packageChannel: beta.extraMetadata.xunaChannel });
  assert.equal(identity.APP_ID, beta.appId);
  assert.equal(identity.PRODUCT_NAME, beta.productName);
});

test('neither install folder name is the start of the other, or one app’s installer would close the other', () => {
  assert.ok(!beta.extraMetadata.name.startsWith(pkg.name));
  assert.ok(!pkg.name.startsWith(beta.extraMetadata.name));
});

test('beta’s files have their own fixed names', () => {
  assert.equal(beta.nsis.artifactName, 'XUNA-AI-Beta-Setup.${ext}');
  assert.equal(beta.dmg.artifactName, 'XUNA-AI-Beta.${ext}');
  assert.equal(beta.mac.artifactName, 'XUNA-AI-Beta-mac.${ext}');
});

test('beta updates from beta-latest, one range at a time, as GitHub’s file host requires', () => {
  assert.deepEqual(beta.publish, [{ provider: 'generic', url: FEED, useMultipleRangeRequest: false }]);
});

test('the Mac beta claims no push, so it needs no provisioning profile', () => {
  assert.equal('provisioningProfile' in beta.mac, false);
  assert.equal(beta.mac.entitlements, 'build/entitlements.mac.inherit.plist');
  assert.equal(beta.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');
  assert.equal(beta.mac.notarize, true);
  assert.equal(beta.mac.hardenedRuntime, true);
});

test('the build refuses anything but a plain x.y.z version', () => {
  for (const bad of [undefined, '', '1.0', 'v1.0.0', '1.0.0-rc.1', '1.0.0\n']) assert.throws(() => betaVersion(bad), /x\.y\.z/, String(bad));
  assert.equal(betaVersion('1.0.0'), '1.0.0');
});

test('everything else is built as production is', () => {
  for (const key of ['copyright', 'files', 'directories', 'electronFuses']) assert.deepEqual(beta[key], pkg.build[key], key);
  assert.equal(beta.nsis.oneClick, true);
  assert.equal(beta.nsis.perMachine, false);
  assert.deepEqual(beta.win.target, pkg.build.win.target);
  assert.deepEqual(beta.mac.target, pkg.build.mac.target);
});

test('beta has icons of the sizes production’s have', () => {
  assert.equal(beta.win.icon, 'build/icon-beta.png');
  assert.equal(beta.mac.icon, 'build/icon-mac-beta.png');
  assert.equal(pngSize(beta.win.icon), 512);
  assert.equal(pngSize(beta.mac.icon), 1024);
});
