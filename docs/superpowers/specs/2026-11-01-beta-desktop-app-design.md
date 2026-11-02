# XUNA AI Beta: design

Date: 2026-11-01. Status: approved by the user on 2026-11-01.

## What this is and why

XUNA AI has a production desktop app for Mac and Windows, an Electron shell around
app.xuna.ai. The user wants a second installable app, **XUNA AI Beta**, that wraps
<https://beta.xuna.ai> in the same shell with the same title bar. From then on the bar and the
UI can change on beta without touching what production users get. Beta web work comes later,
and the beta shell has to be able to follow it.

People install it from a page linked at the foot of install.xuna.ai, which offers both the Mac
and the Windows download.

## Goals

- Beta looks and behaves exactly like production on day one. On Mac that is the one-row bar,
  workspace tabs, the + panel and Ask AI. On Windows it is Windows' own recoloured bar, which is
  what production shows there today: the one-row bar and the tabs are Mac only in production too.
- It installs beside production. Both can run at once, with separate sign-ins, data and updates.
- Beta shell changes and releases never reach production, and production's never force beta's.
- It releases the way production does: a git tag, GitHub Actions for Windows, Codemagic for a
  signed, notarized Mac app.
- No new accounts, secrets, Apple portal work or Vercel settings.

## Non-goals

- No change to the production app and no production release.
- No beta wording or anything else different in the shell or the platform (the user's decision,
  2026-11-01). The BETA pill on the app icon is the only beta styling. Dialogs, menus, the title bar
  and the offline page keep production's words. The app's name in the Dock, the Start menu and the
  install folder stays XUNA AI Beta, because that is what lets the two apps install side by side.
- No Mac push notifications on beta (see "Mac signing").
- No one-row bar on Windows, and no Windows code signing. Both match production as it is.
- No switch inside the production app to move to beta.

## Anti-goals

Any of these makes this a failure, even if the beta app works:

- A production copy of XUNA AI updates to a beta build, or stops finding updates.
- GitHub's "latest" release moves off the production release, or the production buttons on
  install.xuna.ai change what they serve.
- Beta code reaches production users through a mistaken tag or a careless merge.
- Anything is pushed to, or changed in, the web app's repo, on any branch.

## Constraints

Decided by the user:

- Everything lives in this repo, clementxuna/xuna-desktop-app.
- Beta wraps https://beta.xuna.ai.
- The title bar starts as an exact copy of production's.
- Beta styling goes on the app icon only: no other beta text or difference in the platform or shell.
- Mac and Windows, with the same setup as production.
- The download is a button or page reached from the foot of the download site.
- "Never push to main or make any changes to the other repo that the web app is currently on."

How that last line is applied: the web app's repo is read only, on every branch. This design
also never pushes to `main` of this repo. The download page has to reach `main` to go live,
because install.xuna.ai deploys from there, so that part is a pull request for the user to merge
(see "Download page").

From earlier in the project:

- This repo must stay public, and must name no other GitHub repository (`test/repo-safety.test.js`).
- The download page must match www.xuna.ai's real design. App icons use the white "xuna"
  wordmark, never the logomark.
- Vercel is hands-off: repo-side config only, no Vercel tools.

## The design

Everything below is the designer's call unless listed under "Constraints".

### One repo, two long-lived branches

`main` stays production. A new `beta` branch starts from `main` at v1.6.3 (a3cf0f6). This
mirrors the web app, which also has `main` for production and `beta` for beta, so a beta web
change and the shell change that goes with it live on branches of the same name.

- Beta-only shell work goes on `beta`.
- Production fixes reach beta with `git merge main`.
- Beta work ready for production goes across with `git merge beta` into `main`, then a normal
  production release.

Rejected: a separate repo (new Codemagic app, new token, and the user asked for this repo), and
beta flags on `main` (touches `main`, and every UI change would need an `if`).

### Identity in one build overlay

Editing `package.json` on `beta` would be dangerous. A later `git merge beta` into `main` would
silently take beta's app ID, name and version wherever `main` hadn't changed those lines, and
would bring beta's edited tests with it, so nothing would catch it. Beta's lower version number
would also stop every production update.

So `package.json` on `beta` keeps `main`'s identity and version, and its production tests keep
passing there. A new file, `electron-builder.beta.js`, spreads `package.json`'s `build` block
and changes only this:

| Setting | Production | Beta |
| --- | --- | --- |
| `appId` (also the Mac bundle ID) | `ai.xuna.desktop` | `ai.xuna.desktop.beta` |
| `productName` | `XUNA AI` | `XUNA AI Beta` |
| `name` (via `extraMetadata`) | `xuna-desktop` | `xuna-beta` |
| Windows installer | `XUNA-AI-Setup.exe` | `XUNA-AI-Beta-Setup.exe` |
| Mac download | `XUNA-AI.dmg` | `XUNA-AI-Beta.dmg` |
| Mac update file | `XUNA-AI-mac.zip` | `XUNA-AI-Beta-mac.zip` |
| Icons | `build/icon.png`, `build/icon-mac.png` | `build/icon-beta.png`, `build/icon-mac-beta.png` |
| Mac entitlements | with push, plus the provisioning profile | `build/entitlements.mac.inherit.plist` for both, no profile |
| `publish` | GitHub provider | generic provider (see "Updates") |
| version | `package.json` | from the tag, via `XUNA_BETA_VERSION` and `extraMetadata.version` |

The name, app ID and product name key the install folder, the profile, the update cache and the
single-instance lock, so these give a separate app. The same mechanism (`--config` plus
`extraMetadata`) has already produced separate side-by-side test builds on this PC.
electron-builder 26.17 reads a `.js` config.

**`name` must not start with `xuna-desktop`, and must not be a prefix of it.** The Windows install
folder comes from `name`. Before it installs, updates or uninstalls, electron-builder's installer
stops every process whose path starts with its install folder, with no trailing separator
(`$_.Path.StartsWith('$INSTDIR', ...)` in `allowOnlyOneInstallerInstance.nsh`). Production is in
`%LOCALAPPDATA%\Programs\xuna-desktop`, so a beta in `...\xuna-desktop-beta` would match: every
production update would close a running beta with no prompt, losing unsaved work or a live call.
A name like `xuna` would do the same to production. Production's installer is already out, so the
fix has to be on beta's side, and before `beta-v1.0.0`, because reinstalls reuse the folder saved in
the registry and a later rename wouldn't move existing copies.

The overlay refuses to build without a plain `x.y.z` version. A pre-release suffix would make
electron-builder write `beta.yml` instead of `latest.yml` and change the updater's behaviour, and
the updater can't read a version with a leading zero.

`extraMetadata` also writes `"xunaChannel": "beta"` into the packaged `package.json`.
`src/config.js` reads that field and answers `APP_ID`, `APP_URL`, `PRODUCT_NAME` and whether Mac
push registers. Without the field it answers production's values, so a production build behaves
exactly as today and a merge into `main` changes nothing.

### Shell source changes

Small, and all default to production:

- `src/config.js`: as above.
- `src/main.js`: skip push registration on beta, and name the development profile after the
  product so a beta development run gets `XUNA AI Beta Dev`.

Neither shows anything to people. Dialogs, menus and the offline page keep saying XUNA AI, so with
both apps open their update prompts read alike. That is the user's decision.

The title bar code is not touched: `title-bar.js`, `title-strip.*`, `one-row.css`, `preload.js`
and the `workspace-*` files. That is what makes the design exact. `policy.js` needs no change:
it trusts every `xuna.ai` subdomain and takes the app's own origin from `APP_URL`.

Development: `$env:XUNA_CHANNEL = 'beta'; npm start` runs the beta identity. Installed copies
must ignore this variable, as they already ignore `XUNA_APP_URL`. `XUNA_APP_URL` still works on
top of it, which is how the beta shell points at a local web dev server later.

### Updates

Production copies read GitHub's "latest" release. Only one release can be latest, so beta can't
share that. electron-updater's GitHub provider doesn't fit either: with pre-releases on, it takes
the newest suitable entry in the repo's release feed, production releases included, and would
look for beta's manifest in them.

Instead there is one permanent GitHub pre-release with the tag **`beta-latest`**, created once by
hand with `--prerelease --latest=false`. Every beta build replaces its files. Beta's feed is:

```js
{ provider: 'generic', url: 'https://github.com/clementxuna/xuna-desktop-app/releases/download/beta-latest', useMultipleRangeRequest: false }
```

`useMultipleRangeRequest: false` is required: GitHub's asset host answers multi-range requests
with 501, and the generic provider sends them by default. The GitHub provider turns this off for
itself, which is why production never needed it.

CI only ever runs `gh release upload`, never `gh release create`, so a beta build can't become
"latest" and a missing `beta-latest` release fails the build.

Accepted consequences:

- Installers of older betas aren't kept. The tags keep the code, and a bad beta is undone by
  publishing a newer one, as on production.
- While a file is replaced, its link can 404 for about a minute. Upload the binaries first and the
  manifest last. An updater caught in that window fails and retries at its next check.
- File names carry no version, so the first update after a fresh install downloads in full.
  electron-updater 6.8 then keeps a blockmap in its cache, so later updates download only the
  changes.

### Releasing a beta

```sh
git switch beta
git tag beta-v1.0.1
git push origin beta beta-v1.0.1
```

The first release is `beta-v1.0.0`. Numbers are independent of production's.

- `beta-v*` doesn't match production's `v*` trigger in GitHub Actions or Codemagic.
- GitHub runs a tag's workflows from the tagged commit, so the new workflow works from `beta`
  without being on `main`.
- New `.github/workflows/beta-release.yml`: production's job with `npm ci`, `npm test`,
  `electron-builder --win --publish never --config electron-builder.beta.js`, then upload.
- New Codemagic workflow `mac-beta-release` in `codemagic.yaml`: `mac-release`'s steps with beta's
  app path and file names, without the push checks, uploading to `beta-latest`. It uses the same
  environment group. Started by hand from a branch, it builds and checks but uploads nothing, as
  `mac-release` does.

The two builds don't wait for each other, since the release already exists.

### Guard against a production release from `beta`

Production's release command, `npm version patch && git push --follow-tags`, run on `beta` by
mistake would put a `v*` tag on beta code, and GitHub would run the workflow from that commit. So
on `beta`, `release.yml` and `mac-release` each gain one step, before anything else: stop unless
the tagged commit is on `main`. The Mac job needs it as well because it waits half an hour for a
release with its tag's name, and a real release that reused the name meanwhile would take that
build's files. The steps reach `main` with the first merge of `beta`, and pass there.

### Mac signing

The same Developer ID certificate and notarization, with no new secrets and nothing to do in
Apple's portal. A Developer ID app needs a registered App ID only for capabilities such as push.

No push on beta, because it would need a new App ID, a profile and an APNs key, and neither the
live production bundle nor the live beta bundle reads `window.xunaDesktop` yet, so it would do
nothing today. `getPushRegistration()` answers null on beta, as it does on Windows. Push can be
added in a later shell update without a reinstall.

### Icons

Production's black tile and white wordmark, with a small brand-blue (#2849F7) pill reading BETA
in white. The Mac icon stays on Apple's grid. It should be recognisable in the Dock and the
taskbar at normal sizes; at 16px the wordmark does the work.

### Download page

On a separate short branch, as a pull request to `main` for the user to merge:

- `site/beta/index.html`: production's page with the same type, colours, aurora and system
  detection. Headline "XUNA AI Beta for Mac" or "for Windows", both download buttons, and
  "Open in your browser" going to https://beta.xuna.ai. The copy says it installs next to XUNA AI
  and has its own sign-in, and it links back to `/`.
- `site/index.html`: a small "Try the beta" link at the end of the badges row, in the badges'
  11px uppercase style. The page has no footer today, and that row is its foot.
- `vercel.json`: `/beta/download/windows` and `/beta/download/mac`, as 307 redirects to the files
  in `beta-latest`.
- `test/package.test.js`: a test that those links point at the beta files.

A push to `main` only redeploys this page. It can't release an app, because only tags do. The pull
request is merged only after both platforms' files are in `beta-latest`, so the buttons never 404.
Vercel builds a preview of the branch by itself, so the page can be looked at first.

### Keeping beta in step with the web app later

The shell relies on these in XUNA's page. If beta's web work changes one, the shell change goes on
`beta`. Until then the Mac bar falls back to the 40px strip or, for the storage key, tabs turn
themselves off. Nothing breaks silently.

- A `<header>` along the top of the page, 40 to 80px tall, holding `a[aria-label="Go to home"]`.
- `button[aria-label="Ask AI"]`, its `aria-pressed`, and the `.siri-orb` colours `--c1` to `--c4`.
- The localStorage keys in `TAB_KEY_PREFIXES` (`src/workspace-memory.js`).
- `POST /v2/auth/bootstrap` answering with `accessList`.
- The pages without a header, listed in `PAGES_WITHOUT_HEADER` (`src/preload.js`).
- `#root`, and toasts in `[data-sonner-toaster]`.

This list goes in `docs/`, so it is on hand when the web work starts.

## What has been checked

- Live production and live beta bundles (49 files each, compared on 2026-11-01) contain every string
  above the same number of times, and the app header's class list is identical. The local beta
  checkout is behind the deployed beta, so the deployed bundles were compared, not the local files.
- beta.xuna.ai and auth-beta.xuna.ai both answer 200, with no gate in front.
- Production copies read `/releases/latest` (`GitHubProvider.getLatestTagName`), which skips
  pre-releases.
- Release immutability is off on this repo, so assets can be replaced.
- `beta-v*` tags and `beta*` branches don't exist yet.

## Risks still open

1. **Codemagic and tags.** Answered on 2026-11-01: `beta-v1.0.0` started `mac-beta-release` by
   itself, so a tag build reads `codemagic.yaml` from the tagged commit.
2. **First notarization.** Answered on 2026-11-01: the first Mac build with the new bundle ID took
   about 5 minutes from start to upload.
3. **Accounts.** The user confirmed that beta and production accounts are separate. Anyone with
   only a production account has to sign up on beta, so the page says the beta has its own sign-in.

## Order of work

1. Create `beta` locally. Overlay, config, strings, icons, tests.
2. `npm test`. Build the Windows installer locally with the overlay, install it beside production
   and check both run.
3. Push the `beta` branch, with no tags. This creates only a Vercel preview.
4. Create the `beta-latest` pre-release. Confirm `releases/latest` is still v1.6.3.
5. Push `beta-v1.0.0`. Watch both builds. Confirm all files are in `beta-latest`.
6. On this PC, install from the real URL, sign in and check the app. Push `beta-v1.0.1` and watch
   a real update arrive and install.
7. The user installs the Mac build from its direct link and tries it. Push `beta-v1.0.2`, which
   changes only the version, so the user sees the restart prompt and a real update on a Mac. The
   follow-ups still list that as untried, and installed copies can only be fixed through the
   updater, so it comes before anyone can install from the public page.
8. Open the download page pull request. The user merges it, and `/beta` goes live. The user can
   merge sooner if they accept the risk of an untested Mac update.

## How it's verified

- `npm test`, with a new `test/beta.test.js` covering: every overlay value differs from production
  where it must; neither `name` is a prefix of the other; the feed URL and
  `useMultipleRangeRequest: false`; no provisioning profile; the build refuses a bad version; config
  answers production's values without `xunaChannel`; the beta workflows upload to `beta-latest`,
  never create a release and never pass `--latest`; `release.yml` has the `main` guard. Today's 237
  tests keep passing unchanged.
- End to end on Windows: side-by-side install, separate sign-ins, a real update through
  `beta-latest`, uninstalling beta leaving production alone, and, with beta open, the exact process
  check production's installer runs finding nothing. That check is read-only: running the real
  installer would upgrade the real production install on this PC, which is on 1.2.1.
- Codemagic's existing checks prove signing, notarization, both architectures and that the app opens.
- After the first beta release, production is checked directly: `releases/latest`, both production
  download links and the update manifests are unchanged.
- The Mac bar on real beta is checked by the user on a Mac: it can't be checked on Windows.

## Left to the builder

- The exact page copy, within the points above, and how the pill is rendered.
- Whether `codemagic.yaml` shares steps with YAML anchors or repeats them.
- How `src/config.js` tells a development run from an installed copy, as long as an installed
  production copy can never be flipped by an environment variable.
- How the `main` guard checks the commit.
- Whether CI refuses a tag that isn't higher than the version already in `beta-latest`.
- README, `docs/decisions.md` and `docs/follow-ups.md` updates, on `beta`.
