# XUNA AI Beta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship XUNA AI Beta, a second Mac and Windows app that wraps https://beta.xuna.ai in the same shell, released from a `beta` branch without touching production.

**Architecture:** `main` stays production and is never pushed. A new `beta` branch adds one build overlay, `electron-builder.beta.js`, which gives the same code a second identity at build time, while `package.json` keeps production's values. `beta-v*` tags build through new GitHub Actions and Codemagic workflows that can only upload to one rolling pre-release, `beta-latest`, which is also beta's update feed. The download page reaches `main` only through a pull request the user merges.

**Tech Stack:** Electron 44, electron-builder 26.17, electron-updater 6.8, `node --test`, GitHub Actions, Codemagic, a static Vercel site.

**Spec:** `docs/superpowers/specs/2026-11-01-beta-desktop-app-design.md`

## Global Constraints

- Never push to `main`. Never push a `v*` tag. The only things pushed are the `beta` branch, `beta-v*` tags and the `beta-download-page` branch.
- The web app's repo is read only: no push, no fetch, no edits. No Vercel tools or CLI.
- On `beta`, `package.json` keeps `main`'s identity and version, and `test/package.test.js` stays unchanged. Never run `npm version` on `beta`.
- Not touched: `src/title-bar.js`, `src/title-strip*`, `src/one-row.css`, `src/preload.js`, `src/policy.js`, `src/workspace-*`, `src/menus.js`, `src/updates.js`, `src/offline.html`.
- Beta styling goes on the app icon only. No beta wording or anything else different in the platform or shell (the user's decision, 2026-11-01).
- Beta's values: `appId` `ai.xuna.desktop.beta`, `productName` `XUNA AI Beta`, `name` `xuna-beta`, files `XUNA-AI-Beta-Setup.exe`, `XUNA-AI-Beta.dmg`, `XUNA-AI-Beta-mac.zip`, icons `build/icon-beta.png`, `build/icon-mac-beta.png`.
- `name` must not start with `xuna-desktop` and must not be a prefix of it.
- The rolling release's tag is `beta-latest`. It is created once by hand with `--prerelease --latest=false`. CI only runs `gh release upload`.
- Beta's versions come from the tag and are plain `x.y.z`. The first is `beta-v1.0.0`.
- The repo stays public and names no other GitHub repository. Before every push, `git grep -niE "xuna-ai[/]|xuna-app[.]git"` returns nothing and `npm test` passes.
- The user is often at this PC. Say before opening windows or driving the mouse, and check over CDP where possible (see `docs/follow-ups.md` and the project notes on CDP runs).
- Commit subjects are plain sentences like the repo's own. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run commands from the repo root.

## Review Focus

1. An installed production copy on a computer where `XUNA_CHANNEL=beta` happens to be set must stay production (test in Task 1).
2. A tag that isn't plain `x.y.z`, such as `beta-v1.0` or `beta-v1.0.0-rc.1`, must stop the build before anything is uploaded (test in Task 3).
3. If `beta-latest` is ever deleted, CI must fail rather than create a release that could become "latest" (test in Task 4).
4. Beta's notifications and taskbar grouping must belong to beta: `config.APP_ID` and the overlay's `appId` must agree, or Windows sends beta's toasts to production (test in Task 3).
5. Merging `beta` into `main` must leave a production build's identity alone: with no channel in `package.json`, config answers production's values (test in Task 1) and `test/package.test.js` stays unchanged.

---

## File Structure

On `beta`:

| File | Responsibility |
| --- | --- |
| `electron-builder.beta.js` (new) | The only place beta's build identity lives |
| `src/config.js` | Answers which app this is, at run time |
| `src/main.js` | Skips push on beta; names the development profile after the app |
| `build/icon-beta.png`, `build/icon-mac-beta.png` (new) | Production's icons with a BETA pill |
| `.github/workflows/beta-release.yml` (new) | Windows build for `beta-v*` tags |
| `.github/workflows/release.yml` | One new step: stop unless the tagged commit is on `main` |
| `codemagic.yaml` | New `mac-beta-release` workflow, after `mac-release` |
| `test/beta.test.js` (new) | Everything beta-specific |
| `docs/beta-web-hooks.md` (new) | What the shell needs from XUNA's page |
| `README.md`, `docs/decisions.md`, `docs/follow-ups.md` | How beta works and how to release it |

On `beta-download-page`, branched from `main`: `site/beta/index.html` (new), `site/index.html`, `vercel.json`, `test/package.test.js`.

---

### Task 1: Start `beta`, and let config say which app this is

**Files:**
- Modify: `src/config.js`
- Test: `test/beta.test.js` (create)

**Interfaces:**
- Produces: `identityFor({ packageChannel, defaultApp, envChannel })` returning `{ APP_ID, APP_URL, PRODUCT_NAME, MAC_PUSH }`. `src/config.js` also exports those four keys for the running app, plus `identityFor` and everything it exports today.

- [ ] **Step 1: Branch and commit the design**

Confirm `git rev-parse --short HEAD` is `a3cf0f6` and `git status --short` shows only `docs/superpowers/`. Then:

```bash
git switch -c beta
git add docs/superpowers
git commit -m "Add the design and plan for XUNA AI Beta"
```

- [ ] **Step 2: Write the failing tests**

```js
const { identityFor } = require('../src/config');

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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test test/beta.test.js`
Expected: FAIL with "identityFor is not a function"

- [ ] **Step 4: Implement `identityFor` in `src/config.js`**

Hold the two identities in a table. Beta wins when `packageChannel === 'beta'`, or when `defaultApp` is truthy and `envChannel === 'beta'`. The module's own values come from `identityFor({ packageChannel: require('../package.json').xunaChannel, defaultApp: process.defaultApp, envChannel: process.env.XUNA_CHANNEL })`. `process.defaultApp` is set only when Electron is started on a folder, never in an installed copy. Update the file's opening comment so it covers both apps.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass, with the 5 new tests added to today's 237.

- [ ] **Step 6: Commit**

```bash
git add src/config.js test/beta.test.js
git commit -m "Let config say whether this copy is production or beta"
```

---

### Task 2: Skip push on beta, and keep beta's development profile apart

The user narrowed this task during the run: an earlier version put "XUNA AI Beta" in dialogs, menus and the offline page, and was undone. See the ledger's ruling and the commit "Keep the shell's words as production's". The final state is below.

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `config.PRODUCT_NAME`, `config.MAC_PUSH` from Task 1.

- [ ] **Step 1: Make the two changes in `src/main.js`**

The development profile becomes `` `${config.PRODUCT_NAME} Dev` `` (the same folder as today in production). `registerForPush` also returns early when `!config.MAC_PUSH`.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Check that nothing visible changed**

Run: `git diff --stat main -- src`
Expected: only `src/config.js` and `src/main.js`.

---

### Task 3: Build overlay and icons, proved by a local install

**Files:**
- Create: `electron-builder.beta.js`, `build/icon-beta.png`, `build/icon-mac-beta.png`
- Test: `test/beta.test.js`

**Interfaces:**
- Consumes: `identityFor` from Task 1.
- Produces: `betaBuild(version: string)` returning the electron-builder config; `betaVersion(value)` returning `value` or throwing; a default export function reading `process.env.XUNA_BETA_VERSION`. electron-builder calls a function export to get its config.

- [ ] **Step 1: Write the failing tests**

```js
const { betaBuild, betaVersion } = require('../electron-builder.beta.js');
const pkg = require('../package.json');
const FEED = 'https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest';
const beta = betaBuild('1.2.3');
const pngSize = (file) => fs.readFileSync(path.join(__dirname, '..', file)).readUInt32BE(16);

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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/beta.test.js`
Expected: FAIL with "Cannot find module '../electron-builder.beta.js'"

- [ ] **Step 3: Implement `electron-builder.beta.js`**

Spread `package.json`'s `build` and change only the values the tests pin, removing `provisioningProfile` from `mac` by destructuring. `betaVersion` matches `/^\d+\.\d+\.\d+$/` and its error says "x.y.z", and `betaBuild` passes its version through it, so a bad tag stops the build. Export `module.exports = () => betaBuild(process.env.XUNA_BETA_VERSION)` with `betaBuild` and `betaVersion` as properties of that function. Open the file with a comment saying why identity lives here and not in `package.json`.

- [ ] **Step 4: Draw the icons**

Overlay a pill on the existing PNGs, which stay unchanged, using the Playwright browser tool on a throwaway page in the scratchpad, with a transparent background and Inter Tight 600 at +0.08em tracking in white on #2849F7:

| File | Canvas | Pill centre x | Pill top | Pill height | Type size | Side padding |
| --- | --- | --- | --- | --- | --- | --- |
| `build/icon-mac-beta.png` | 1024 | 512 | 632 | 116 | 78px | 44px |
| `build/icon-beta.png` | 512 | 256 | 326 | 68 | 46px | 26px |

View both at full size and at 256, 64 and 32px. The corners must stay transparent, and BETA must read at 64px.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron-builder.beta.js build/icon-beta.png build/icon-mac-beta.png test/beta.test.js
git commit -m "Add the beta build overlay and icons"
```

- [ ] **Step 7: Build the Windows installer locally**

Run: `$env:XUNA_BETA_VERSION = '0.0.1'; npx electron-builder --win --publish never --config electron-builder.beta.js`
Expected: `dist/XUNA-AI-Beta-Setup.exe`, its `.blockmap`, and `dist/latest.yml` with `version: 0.0.1`.

- [ ] **Step 8: Check what was packaged**

- `dist/win-unpacked/resources/app-update.yml` has `provider: generic`, the feed URL, `useMultipleRangeRequest: false` and `updaterCacheDirName: xuna-beta-updater`.
- The `package.json` inside `app.asar` (read with `@electron/asar`) has `name: xuna-beta`, `productName: XUNA AI Beta`, `version: 0.0.1`, `xunaChannel: beta`.

- [ ] **Step 9: Install beside production and check it**

Tell the user first, because a window will open. Note `LastWriteTime` of `%LOCALAPPDATA%\Programs\xuna-desktop\XUNA AI.exe`. Run the installer with `/S`, then start `%LOCALAPPDATA%\Programs\xuna-beta\XUNA AI Beta.exe --remote-debugging-port=9333`. Expected:

- The page's URL over CDP is on `https://beta.xuna.ai`.
- `%APPDATA%\XUNA AI Beta` exists, and `%LOCALAPPDATA%\Programs\xuna-desktop` is unchanged.
- With beta running, the exact check production's installer runs finds nothing:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\xuna-desktop"
Get-CimInstance -ClassName Win32_Process | Where-Object { $_.Path -and $_.Path.StartsWith($dir, 'CurrentCultureIgnoreCase') }
```

- [ ] **Step 10: Check the offline page, then remove the test install**

In a development run with `$env:XUNA_CHANNEL = 'beta'; $env:XUNA_APP_URL = 'http://127.0.0.1:9'`, read the page over CDP. Expected: its heading is production's "Can't reach XUNA AI", and its `url` query parameter is the address that failed, so Try again retries that address and not production. Then close beta, run `Uninstall XUNA AI Beta.exe /S`, delete `%APPDATA%\XUNA AI Beta`, and confirm production's `LastWriteTime` is unchanged.

---

### Task 4: Beta release pipeline, with the guard and the docs

**Files:**
- Create: `.github/workflows/beta-release.yml`, `docs/beta-web-hooks.md`
- Modify: `.github/workflows/release.yml`, `codemagic.yaml`, `README.md`, `docs/decisions.md`, `docs/follow-ups.md`
- Test: `test/beta.test.js`

**Interfaces:**
- Consumes: `electron-builder.beta.js` and `XUNA_BETA_VERSION` from Task 3.

- [ ] **Step 1: Write the failing tests**

`readRepoFile` as in `test/package.test.js`; `macBeta` is `codemagic.yaml` from `mac-beta-release:` to its end.

```js
test('a beta tag builds Windows with the overlay, and can only upload', () => {
  const workflow = readRepoFile('.github', 'workflows', 'beta-release.yml');
  assert.match(workflow, /tags: \['beta-v\*'\]/);
  assert.match(workflow, /electron-builder --win --publish never --config electron-builder\.beta\.js/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /gh release upload beta-latest/);
  assert.doesNotMatch(workflow, /gh release create|--latest|--publish always/);
  assert.ok(workflow.indexOf('XUNA_BETA_VERSION') < workflow.indexOf('run: npm ci'), 'the tag is read before installing');
  assert.ok(workflow.indexOf('dist/XUNA-AI-Beta-Setup.exe') < workflow.indexOf('dist/latest.yml'), 'the manifest goes last');
});

test('a beta tag builds the Mac app with the overlay, checks it, and can only upload', () => {
  assert.match(macBeta, /pattern: 'beta-v\*'/);
  assert.match(macBeta, /electron-builder --mac --publish never --config electron-builder\.beta\.js/);
  assert.match(macBeta, /xcrun stapler validate/);
  assert.match(macBeta, /CFBundleIdentifier/);
  assert.match(macBeta, /XUNA AI Beta\.app/);
  assert.doesNotMatch(macBeta, /gh release create|--latest|--publish always|aps-environment/);
  assert.ok(macBeta.indexOf('Check the app opens') < macBeta.indexOf('gh release upload beta-latest'));
  assert.ok(macBeta.indexOf('dist/XUNA-AI-Beta-mac.zip') < macBeta.indexOf('dist/latest-mac.yml'), 'the manifest goes last');
});

test('a production release stops unless the tagged commit is on main', () => {
  const workflow = readRepoFile('.github', 'workflows', 'release.yml');
  assert.match(workflow, /compare\/main\.\.\./);
  assert.ok(workflow.indexOf('Check the tag is on main') < workflow.indexOf('Check the tag matches package.json'));
});

test('beta tags match neither production trigger', () => {
  assert.match(readRepoFile('.github', 'workflows', 'release.yml'), /tags: \['v\*'\]/);
  assert.match(readRepoFile('codemagic.yaml').split('mac-beta-release:')[0], /pattern: 'v\*'/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/beta.test.js`
Expected: FAIL with ENOENT for `beta-release.yml`

- [ ] **Step 3: Add `.github/workflows/beta-release.yml`**

Start from `release.yml`, with these differences: name "Beta release"; `tags: ['beta-v*']`; concurrency group `beta-release`. In place of the tag check, a bash step writes `XUNA_BETA_VERSION=${GITHUB_REF_NAME#beta-v}` to `$GITHUB_ENV`. The build is `npx electron-builder --win --publish never --config electron-builder.beta.js`. The last step, with the same `GH_TOKEN` and `GH_REPO`, runs:

```bash
gh release upload beta-latest --clobber dist/XUNA-AI-Beta-Setup.exe dist/XUNA-AI-Beta-Setup.exe.blockmap
gh release upload beta-latest --clobber dist/latest.yml
```

- [ ] **Step 4: Add the guard to `release.yml`**

A first step after `setup-node`, named "Check the tag is on main". With `GH_TOKEN: ${{ github.token }}`, it reads `gh api "repos/$GITHUB_REPOSITORY/compare/main...$GITHUB_SHA" --jq .status` and succeeds only on `behind` or `identical`. A comment says why: GitHub runs this file from the tagged commit, so the production release command run by mistake on `beta` must publish nothing, and Codemagic then has no release to add to.

- [ ] **Step 5: Add `mac-beta-release` to `codemagic.yaml`, after `mac-release`**

Start from `mac-release`, with these differences:

- Name "Mac beta release"; tag pattern `beta-v*`; same `xuna_mac_release` group and `GH_REPO`.
- The first step, "Read the version from the tag", appends `XUNA_BETA_VERSION=${CM_TAG#beta-v}` to `$CM_ENV`. With no tag it uses `0.0.0` and says the app is built and checked but not uploaded.
- The build uses `--config electron-builder.beta.js`.
- The checks use `dist/mac-universal/XUNA AI Beta.app` and its binary `XUNA AI Beta`. Keep the signature, hardened runtime, staple and both architecture checks, and drop the three push checks. Add: `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist"` must print `ai.xuna.desktop.beta`.
- "Check the app opens" uses that binary.
- The upload needs no waiting. With no `CM_TAG` it skips; otherwise it uploads `dist/XUNA-AI-Beta.dmg dist/XUNA-AI-Beta-mac.zip dist/XUNA-AI-Beta-mac.zip.blockmap` to `beta-latest` with `--clobber`, then `dist/latest-mac.yml`.
- Artifacts: the same three beta files.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: all pass, including `test/package.test.js` unchanged.

- [ ] **Step 7: Write the docs**

- `docs/beta-web-hooks.md`: the list under "Keeping beta in step with the web app later" in the spec, with what each hook does when it goes missing.
- `README.md`: a section "XUNA AI Beta" covering what it is; `main` for production and `beta` for beta; the release commands; numbers only go up; never `npm version` on `beta`; `git merge main` to take production fixes and `git merge beta` to promote; `$env:XUNA_CHANNEL = 'beta'; npm start`, with `XUNA_APP_URL` for a local web dev server; and the identity values that must not change once released.
- `docs/decisions.md`: a "Beta" section with the why of the overlay, the rolling release, `xuna-beta`, and no push.
- `docs/follow-ups.md`: the Mac beta checks, and adding push to beta when XUNA's servers send it.

- [ ] **Step 8: Commit**

```bash
git add .github codemagic.yaml docs README.md test/beta.test.js
git commit -m "Add the beta release pipeline, and keep production's to main"
```

---

### Task 5: Review, publish `beta`, and release 1.0.0

Nothing before this task leaves this PC.

**Interfaces:**
- Consumes: the finished `beta` branch.
- Produces: the public `beta` branch, the `beta-latest` pre-release, and version 1.0.0 in it.

- [ ] **Step 1: Review the whole branch**

Use superpowers:requesting-code-review with a fresh reviewer on `main..beta`, and fix what it finds before going on. Then run `npm test` and the `git grep` from Global Constraints.

- [ ] **Step 2: Push the branch, with no tags**

Run: `git push -u origin beta`
Expected: `gh run list --limit 3` shows no new run, because the workflows fire only on tags.

- [ ] **Step 3: Check the guard's logic, read-only**

```powershell
gh api repos/clementxuna/xuna-desktop-app/compare/main...v1.6.2 --jq .status  # behind: allowed
gh api repos/clementxuna/xuna-desktop-app/compare/main...main --jq .status    # identical: allowed
gh api repos/clementxuna/xuna-desktop-app/compare/main...beta --jq .status    # ahead: refused
```

- [ ] **Step 4: Create the rolling release**

```powershell
gh release create beta-latest --repo clementxuna/xuna-desktop-app --target beta --prerelease --latest=false --title "XUNA AI Beta" --notes "The newest XUNA AI Beta. Each beta build replaces these files."
```

- [ ] **Step 5: Confirm production hasn't moved**

- `gh api repos/clementxuna/xuna-desktop-app/releases/latest --jq .tag_name` prints `v1.6.3`.
- `https://github.com/clementxuna/xuna-desktop-app/releases/latest/download/latest.yml` still redirects to a file that says `version: 1.6.3`.
- `https://install.xuna.ai/download/mac` still answers 307 to the `releases/latest` URL.

- [ ] **Step 6: Release 1.0.0**

```bash
git tag beta-v1.0.0
git push origin beta-v1.0.0
```

- [ ] **Step 7: Watch both builds**

`gh run watch` for Windows. If no Mac files arrive and Codemagic shows no build within a few minutes, this is the spec's Risk 1: in Codemagic's web UI, start a build on tag `beta-v1.0.0` with workflow "Mac beta release", through the local Playwright browser. If Codemagic can't see the workflow there either, stop and ask the user. Don't touch `main`.

- [ ] **Step 8: Confirm the release**

- `beta-latest` holds exactly `XUNA-AI-Beta-Setup.exe`, its blockmap, `latest.yml`, `XUNA-AI-Beta.dmg`, `XUNA-AI-Beta-mac.zip`, its blockmap and `latest-mac.yml`.
- Both manifests say `version: 1.0.0`, and their file sizes match the uploads.
- Repeat Step 5.

---

### Task 6: Prove it on Windows with a real update

**Interfaces:**
- Consumes: 1.0.0 in `beta-latest` from Task 5.

- [ ] **Step 1: Install from the real link**

Tell the user first. Download `https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest/XUNA-AI-Beta-Setup.exe` and run it. Ask the user to sign in with their beta account. Expected: XUNA opens signed in, the Windows bar follows XUNA's theme, and Help ▸ About shows version 1.0.0.

- [ ] **Step 2: Check the one-row bar on real beta**

With the user's help for one sign-in, in a development run with `$env:XUNA_CHANNEL = 'beta'; $env:XUNA_WORKSPACE_TABS = '1'` and the inspector ports. Over CDP, expected: `<html>` has `data-xuna-desktop-row`, XUNA's `<header>` has `data-xuna-desktop-bar`, and the tab's view fills the window (`bar.mode` is one-row). This is the check that the top bar really carries over. Windows' frame ignores drag areas, so dragging waits for Mac.

- [ ] **Step 3: Release 1.0.1 from the same commit**

```bash
git tag beta-v1.0.1 beta-v1.0.0
git push origin beta-v1.0.1
```

- [ ] **Step 4: Watch the update arrive**

Once `latest.yml` says 1.0.1, use Help ▸ Check for Updates… in the installed app. Expected: "XUNA AI 1.0.1 is ready to install". Restart Now reopens the app, and the exe's version is 1.0.1. A full download is expected on this first update.

- [ ] **Step 5: Confirm production is untouched**

With beta open, run the process check from Task 3 Step 9 again: it finds nothing. Repeat Task 5 Step 5, and confirm the production exe's `LastWriteTime` is unchanged.

---

### Task 7: The user tries it on a Mac

**Interfaces:**
- Consumes: 1.0.1 in `beta-latest`.

- [ ] **Step 1: Give the user the direct link**

`https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest/XUNA-AI-Beta.dmg`. Ask them to install it beside XUNA AI and check that it opens without a warning, the bar matches production's, the window drags by the header, tabs and + work, Ask AI opens, and both apps run at once with separate sign-ins.

- [ ] **Step 2: Release 1.0.2 from the same commit**

```bash
git tag beta-v1.0.2 beta-v1.0.0
git push origin beta-v1.0.2
```

- [ ] **Step 3: The user checks the update**

Once `latest-mac.yml` says 1.0.2, the user chooses Check for Updates…, then Restart Now. Expected: XUNA AI Beta reopens on 1.0.2. Fix anything found on `beta`, then re-release. If the update works, mark "Check the first Mac update" and "Check the restart prompt on Mac" in `docs/follow-ups.md` on `beta` as seen on beta.

---

### Task 8: Download page

Steps 1 to 9 can run while Task 7 waits for the user, so they can see the page in Vercel's preview. Only the merge has to wait for the Mac check.

**Files:**
- Create: `site/beta/index.html`
- Modify: `site/index.html`, `vercel.json`
- Test: `test/package.test.js`

**Interfaces:**
- Consumes: the file names in `beta-latest`.

- [ ] **Step 1: Branch from `main`**

Run: `git switch -c beta-download-page main`

- [ ] **Step 2: Write the failing test in `test/package.test.js`**

```js
test("the beta page's links point at the beta files", () => {
  const site = JSON.parse(readRepoFile('vercel.json'));
  const beta = `https://github.com/${build.publish[0].owner}/${build.publish[0].repo}/releases/download/beta-latest/`;
  const expected = { '/beta/download/windows': 'XUNA-AI-Beta-Setup.exe', '/beta/download/mac': 'XUNA-AI-Beta.dmg' };
  for (const [source, file] of Object.entries(expected)) {
    const redirect = site.redirects?.find((entry) => entry.source === source);
    assert.equal(redirect?.destination, beta + file, source);
    assert.equal(redirect?.permanent, false, source);
  }
  const page = readRepoFile('site', 'beta', 'index.html');
  for (const source of Object.keys(expected)) assert.ok(page.includes(`href="${source}"`), source);
  assert.ok(readRepoFile('site', 'index.html').includes('href="/beta"'), 'the main page links to the beta page');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/package.test.js`
Expected: FAIL, the redirect is undefined.

- [ ] **Step 4: Add the redirects to `vercel.json`**

The two 307 redirects the test pins, after the existing ones.

- [ ] **Step 5: Write `site/beta/index.html`**

A copy of `site/index.html`, keeping its head script, styles, video and badges, with these changes:

- Title "Download the beta for Mac and Windows | XUNA AI". The description and `og:description` read "Try XUNA AI Beta on your Mac or Windows PC. It installs next to XUNA AI, has its own sign-in, and updates itself."
- Headline "XUNA AI Beta for Mac" or "for Windows", with the same accent.
- Lede: "Try what's coming next in XUNA, in its own window. It installs next to XUNA AI, has its own sign-in, and updates itself."
- Buttons point at `/beta/download/mac` and `/beta/download/windows`. "Open in your browser" and the note for other devices go to `https://beta.xuna.ai`, and the note says "XUNA AI Beta in your browser".
- The Mac install note names **XUNA AI Beta**. The Windows note stays as it is.
- A "Back to XUNA AI" link to `/` at the end of each badges list, styled as in Step 6.

- [ ] **Step 6: Add the link to `site/index.html`**

At the end of both `.badges` lists: `<li class="badge-link"><a href="/beta">Try the beta</a></li>`. `.badge-link { margin-left: auto; }`, keeping the badges' 11px uppercase type. It underlines on hover, with a visible focus ring from the existing `:focus-visible` rule. On a narrow screen it wraps with the row.

- [ ] **Step 7: Check both pages**

Serve `site/` locally and view `/` and `/beta/` with the Playwright browser at 1440px and 390px, as Mac and as Windows user agents. Expected: the type, colours and aurora match the live page, no horizontal scroll at 390px, the headline wraps cleanly, and the main page looks unchanged apart from the new link.

- [ ] **Step 8: Run all tests and commit**

Run: `npm test`
Expected: all pass.

```bash
git add site vercel.json test/package.test.js
git commit -m "Add the beta download page and link to it from the main page"
```

- [ ] **Step 9: Push and open the pull request**

```bash
git push -u origin beta-download-page
gh pr create --base main --title "Add the XUNA AI Beta download page" --body-file <scratchpad file>
```

The body says what changes, that merging only redeploys the page, and to merge after the Mac check. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. **Do not merge it.**

- [ ] **Step 10: After the user merges, check it live**

- `https://install.xuna.ai/beta` answers 200.
- `/beta/download/windows` and `/beta/download/mac` answer 307 to `beta-latest`.
- `/download/windows` and `/download/mac` are unchanged.
- Bring the page into `beta`: `git switch beta`, `git merge main`, `npm test`, `git push origin beta`.

- [ ] **Step 11: Update the project notes**

Record the final state in the memory files: `beta-desktop-app`, `xuna-desktop-layout`, and the Codemagic answer from Task 5.
