# XUNA AI for Mac and Windows

The desktop app for XUNA AI, for Mac and Windows. It is a small Electron shell that opens
[app.xuna.ai](https://app.xuna.ai) in its own window, so it always shows the newest
version of XUNA: web releases appear in the app without a desktop release. Both systems
build from the same code.

## How it works

- `src/main.js` opens app.xuna.ai and applies the rules in `src/policy.js`:
  - sign-in, payment and integration pop-ups stay inside the app; ordinary links open
    in the default browser
  - XUNA pages get the microphone (never the camera), notifications and speaker choice;
    any page may copy to the clipboard or go fullscreen, as in Chrome; everything else
    is refused, including for other sites' frames embedded in a XUNA page
  - the app presents a standard Chrome user agent so Google sign-in works
- On Windows, the window's title bar follows the app's theme: black in dark mode, white in
  light mode (Windows 11; Windows 10 keeps its standard title bar). `src/preload.js` reports
  the theme the page shows; it exposes nothing to the page. On Mac, the title bar follows
  macOS's light or dark mode.
- On Mac it behaves like a Mac app: closing the window keeps XUNA AI in the Dock, clicking
  the Dock icon opens it again, and it has the usual app and Window menus.
- Installed copies update themselves from this repo's GitHub Releases: they check at
  start-up and every 6 hours, download in the background and install when the app quits.
- `site/` is the download page, deployed separately (see below).

## Develop

```sh
npm install # also turns on the push guard (see "Where this repo pushes")
npm start   # opens app.xuna.ai using a separate "XUNA AI Dev" profile
npm test
```

To point a development run at another environment (installed copies ignore this):

```powershell
$env:XUNA_APP_URL = 'https://beta.xuna.ai'; npm start
```

`npm run dist` builds `dist/XUNA-AI-Setup.exe` locally without publishing it. The Mac app
can only be built on a Mac (`npm run dist:mac`); releases build it on Codemagic (see
"Mac builds").

## Where this repo pushes

Only to <https://github.com/clementxuna/xuna-desktop-app>, and nothing here can push anywhere
else by accident:

- `origin` is the only remote.
- `.githooks/pre-push` refuses a push to any other destination. `npm install` turns it on by
  pointing git's `core.hooksPath` at `.githooks`, so after a fresh clone run `npm install`
  before your first push.
- `npm test` fails if any file names a GitHub repository other than this one, or if another
  remote is added (`test/repo-safety.test.js`).
- Codemagic's GitHub token is a fine-grained token that can only write to this repo.
- The XUNA web app's code is not in this repo and is never pushed from here. Web app changes
  reach the desktop app through app.xuna.ai, with nothing to do in this repo.

## Release a new version

Only needed when the shell itself changes: its icon, its behaviour, or an Electron
update. Changes to the web app never need a desktop release.

```sh
npm version patch        # or minor: bumps package.json, commits and tags vX.Y.Z
git push --follow-tags   # GitHub Actions builds the installer and publishes the release
```

Pushing commits to `main` publishes nothing; only a `v*` tag does. The tag starts two
builds:

- GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer, uploads it
  to a draft release and makes the release public once every file is in place.
- Codemagic (`codemagic.yaml`) builds, signs and notarizes the Mac app, waits for that
  release to be public, then adds the Mac files to it. This takes about 20 minutes, so the
  Mac download link can 404 for a few minutes after the Windows files appear.

Both check the tag matches `package.json`. Installed copies pick the update up within hours.
If the Codemagic build fails, rebuild it from Codemagic: it replaces any Mac files already
uploaded.

To undo a bad release, publish a newer version: the updater never downgrades.

Electron bundles Chromium, so keep it current for security fixes, roughly every month or
two: `npm install --save-dev electron@latest`, check the app with `npm start`, then release.

## Mac builds

Signing a Mac app needs a Mac, so the Mac app is built on [Codemagic](https://codemagic.io),
by the `mac-release` workflow in `codemagic.yaml`, on an Apple silicon Mac mini.

- The Codemagic app is connected to this repository only. A `v*` tag starts the workflow.
- To test signing without releasing, start a `mac-release` build on a branch from
  Codemagic. It builds, signs, notarizes and checks the app, keeps the files as build
  artifacts and uploads nothing.
- The secrets are in the Codemagic environment group `xuna_mac_release`:

  | Variable | What it is |
  | --- | --- |
  | `CSC_LINK` | The Developer ID Application certificate and its private key, as a base64 `.p12` |
  | `CSC_KEY_PASSWORD` | The `.p12`'s password |
  | `APPLE_API_KEY_P8` | An App Store Connect API key (Developer role), as a base64 `.p8`, used to notarize |
  | `APPLE_API_KEY_ID` | That key's ID |
  | `APPLE_API_ISSUER` | The App Store Connect issuer ID |
  | `GH_TOKEN` | A fine-grained GitHub token for this repo only, with read and write access to Contents |

- The certificate is valid for five years and the GitHub token has an expiry date; see
  [docs/follow-ups.md](docs/follow-ups.md) for both dates. When either is renewed, replace
  its variable in Codemagic.
- No push notification setup is needed: XUNA's notifications come from the open page, and
  the Mac app shows them as native macOS notifications.

## Download link

- Direct:
  - Windows: <https://github.com/clementxuna/xuna-desktop-app/releases/latest/download/XUNA-AI-Setup.exe>
  - Mac: <https://github.com/clementxuna/xuna-desktop-app/releases/latest/download/XUNA-AI.dmg>
- Download page: <https://xuna-desktop-app.vercel.app>, served by a Vercel project that
  imports this repo with the default settings (leave Root Directory empty).
  - `vercel.json` at the repo root tells Vercel to skip installing and building and to serve
    the `site/` folder. `/download/mac` and `/download/windows` redirect to the newest
    installers; `/download`, the original link, still goes to the Windows one.
  - Every push to `main` redeploys the page. Optionally, set an Ignored Build Step so
    commits that touch neither `site/` nor `vercel.json` skip the redeploy.
  - Keep the project in the Pro team, because Vercel's Hobby plan is for non-commercial use.
- The page is a single full-screen view in www.xuna.ai's style: its type scale, brand blue
  and hero aurora video, with no navigation. It shows the Mac or Windows version depending
  on the visitor's computer and links to the other. Keep it in step with the site when the
  site changes.

## Values that must not change

`appId` (`ai.xuna.desktop`, also the Mac bundle ID), `name` (`xuna-desktop`) and
`productName` (`XUNA AI`) key the install folder, notifications, the update cache and every
user's saved sign-in. The installers' file names, `XUNA-AI-Setup.exe` and `XUNA-AI.dmg`, are
what the download links point at, and Mac copies update from `XUNA-AI-mac.zip`.

Also keep:

- `electronFuses.enableCookieEncryption: true`: this is one-way, and turning it off breaks
  every user's saved sign-in.
- `nsis.oneClick: true` and `nsis.perMachine: false`: changing the install scope breaks
  updates for everyone already installed.
- The `publish` owner and repo, and this repo staying public: installed copies and the
  download link both read its GitHub Releases without signing in.

`test/package.test.js` checks all of these except the repo's visibility.

## Troubleshooting

- **"Windows protected your PC"**: the installer is not code-signed yet. Choose
  More info, then Run anyway.
- **No Run anyway button**: Smart App Control blocks unsigned apps on that PC. Use
  app.xuna.ai in a browser there until the app is signed.
- **Microphone not working**: Windows Settings → Privacy & security → Microphone → turn on
  "Let desktop apps access your microphone". On Mac: System Settings → Privacy & Security →
  Microphone → turn on XUNA AI.
- **No notifications on Mac**: System Settings → Notifications → XUNA AI → Allow
  notifications.
- App data, including the saved sign-in, lives in `%APPDATA%\XUNA AI` on Windows and
  `~/Library/Application Support/XUNA AI` on Mac. On Windows the app installs per user to
  `%LOCALAPPDATA%\Programs\xuna-desktop`; on Mac it goes wherever the user drags it,
  normally Applications.

## More

- [docs/decisions.md](docs/decisions.md): why the app is built the way it is.
- [docs/follow-ups.md](docs/follow-ups.md): Windows code signing, renewal dates and known
  minor issues.
