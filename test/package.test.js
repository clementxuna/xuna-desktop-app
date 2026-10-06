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

test('installed copies update from this repo, and a manual electron-builder publish can only create a draft', () => {
  assert.deepEqual(build.publish, [{ provider: 'github', owner: 'clementxuna', repo: 'xuna-desktop-app', releaseType: 'draft' }]);
});

test('CI publishes the installer, its blockmap and latest.yml together in one gh release, never through electron-builder', () => {
  // electron-builder's own publisher uploads files in parallel and can split them across duplicate releases.
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const installer = build.nsis.artifactName.replace('${ext}', 'exe');
  assert.match(workflow, /electron-builder --win --publish never/);
  assert.doesNotMatch(workflow, /--publish always/);
  assert.match(workflow, /gh release create/);
  for (const file of [installer, `${installer}.blockmap`, 'latest.yml']) assert.ok(workflow.includes(`dist/${file}`), `uploads dist/${file}`);
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
