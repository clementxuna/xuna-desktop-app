'use strict';

// Packaging settings other files depend on: Windows identity, the download link and the release flow.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const config = require('../src/config');

const build = pkg.build ?? {};

test('the installer uses the same app ID that Windows notifications are sent under', () => {
  assert.equal(build.appId, config.APP_ID);
});

test('names that key the install folder, updater cache and saved sign-in keep their released values', () => {
  assert.equal(pkg.name, 'xuna-desktop');
  assert.equal(pkg.productName, 'XUNA AI');
});

test('the installer keeps one fixed file name, so the "latest" download link never changes', () => {
  assert.equal(build.nsis?.artifactName, 'XUNA-AI-Setup.${ext}');
});

test('releases publish to this repo as drafts, which CI makes public once every file is uploaded', () => {
  assert.deepEqual(build.publish, [{ provider: 'github', owner: 'clementxuna', repo: 'xuna-desktop-app', releaseType: 'draft' }]);
});

test('only the shell source is packaged into the app', () => {
  assert.deepEqual(build.files, ['src/**/*', 'package.json']);
});

test('no npm script is named "release", which electron-builder would treat as publish-always', () => {
  assert.equal(pkg.scripts.release, undefined);
});

test("the download page's /download link points at the newest release's installer", () => {
  const site = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site', 'vercel.json'), 'utf8'));
  const { owner, repo } = build.publish[0];
  const installer = build.nsis.artifactName.replace('${ext}', 'exe');
  const redirect = site.redirects?.find((entry) => entry.source === '/download');
  assert.equal(redirect?.destination, `https://github.com/${owner}/${repo}/releases/latest/download/${installer}`);
  assert.equal(redirect?.permanent, false); // a 307, so browsers never cache where it points
});
