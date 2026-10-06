'use strict';

// Packaging settings other files depend on: Windows identity, the download link and the release flow.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const config = require('../src/config');

const build = pkg.build ?? {};
const readRepoFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

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
  const workflow = readRepoFile('.github', 'workflows', 'release.yml');
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

test('the release job keeps its write token away from install scripts and checks the tag before installing anything', () => {
  const workflow = readRepoFile('.github', 'workflows', 'release.yml');
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.ok(workflow.indexOf('Check the tag matches package.json') < workflow.indexOf('run: npm ci'), 'tag check runs before npm ci');
});

test('settings every installed copy depends on keep their released values', () => {
  assert.equal(build.electronFuses?.enableCookieEncryption, true); // one-way: turning it off breaks every saved sign-in
  assert.equal(build.nsis?.oneClick, true);
  assert.equal(build.nsis?.perMachine, false); // changing the install scope breaks updates
});

test('Vercel serves the site/ folder from the repo root, with no install or build step', () => {
  // Vercel reads vercel.json from the project's root folder, so the download page works with the
  // project's default settings (Root Directory left empty).
  const site = JSON.parse(readRepoFile('vercel.json'));
  assert.equal(site.outputDirectory, 'site');
  assert.equal(site.framework, null); // "Other": a plain static site
  assert.equal(site.installCommand, ''); // an empty string skips installing the Electron toolchain
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'site', 'vercel.json')), 'one Vercel config, at the repo root');
});

test("the download page's /download link points at the newest release's installer", () => {
  const site = JSON.parse(readRepoFile('vercel.json'));
  const { owner, repo } = build.publish[0];
  const installer = build.nsis.artifactName.replace('${ext}', 'exe');
  const redirect = site.redirects?.find((entry) => entry.source === '/download');
  assert.equal(redirect?.destination, `https://github.com/${owner}/${repo}/releases/latest/download/${installer}`);
  assert.equal(redirect?.permanent, false); // a 307, so browsers never cache where it points
});
