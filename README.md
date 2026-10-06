# XUNA AI for Windows

The Windows desktop app for XUNA AI. It is a small Electron shell that opens
[app.xuna.ai](https://app.xuna.ai) in its own window, so it always shows the newest
version of XUNA: web releases appear in the app without a desktop release.

## How it works

- `src/main.js` opens app.xuna.ai and applies the rules in `src/policy.js`:
  - sign-in, payment and integration pop-ups stay inside the app; ordinary links open
    in the default browser
  - XUNA pages get the microphone (never the camera), notifications and speaker choice;
    any page may copy to the clipboard or go fullscreen, as in Chrome; everything else
    is refused, including for other sites' frames embedded in a XUNA page
  - the app presents a standard Chrome user agent so Google sign-in works
- The window's title bar follows the app's theme: black in dark mode, white in light
  mode (Windows 11; Windows 10 keeps its standard title bar). `src/preload.js` reports the
  theme the page shows; it exposes nothing to the page.
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

`npm run dist` builds `dist/XUNA-AI-Setup.exe` locally without publishing it.

## Where this repo pushes

Only to <https://github.com/clementxuna/xuna-desktop-app>, and nothing here can push anywhere
else by accident:

- `origin` is the only remote.
- `.githooks/pre-push` refuses a push to any other destination. `npm install` turns it on by
  pointing git's `core.hooksPath` at `.githooks`, so after a fresh clone run `npm install`
  before your first push.
- `npm test` fails if any file names a GitHub repository other than this one, or if another
  remote is added (`test/repo-safety.test.js`).
- The XUNA web app's code is not in this repo and is never pushed from here. Web app changes
  reach the desktop app through app.xuna.ai, with nothing to do in this repo.

## Release a new version

Only needed when the shell itself changes: its icon, its behaviour, or an Electron
update. Changes to the web app never need a desktop release.

```sh
npm version patch        # or minor: bumps package.json, commits and tags vX.Y.Z
git push --follow-tags   # GitHub Actions builds the installer and publishes the release
```

Pushing commits to `main` publishes nothing; only a `v*` tag does. The release workflow
checks the tag matches `package.json`, uploads to a draft release and makes it public once
every file is in place. Installed copies pick the update up within hours.

To undo a bad release, publish a newer version: the updater never downgrades.

Electron bundles Chromium, so keep it current for security fixes, roughly every month or
two: `npm install --save-dev electron@latest`, check the app with `npm start`, then release.

## Download link

- Direct: <https://github.com/clementxuna/xuna-desktop-app/releases/latest/download/XUNA-AI-Setup.exe>
- Download page: <https://xuna-desktop-app.vercel.app>, served by a Vercel project that
  imports this repo with the default settings (leave Root Directory empty).
  - `vercel.json` at the repo root tells Vercel to skip installing and building and to serve
    the `site/` folder. Its `/download` address redirects to the newest installer.
  - Every push to `main` redeploys the page. Optionally, set an Ignored Build Step so
    commits that touch neither `site/` nor `vercel.json` skip the redeploy.
  - Keep the project in the Pro team, because Vercel's Hobby plan is for non-commercial use.
- The page is a single full-screen view in www.xuna.ai's style: its type scale, brand blue
  and hero aurora video, with no navigation. Keep it in step with the site when the site
  changes.

## Values that must not change

`appId` (`ai.xuna.desktop`), `name` (`xuna-desktop`) and `productName` (`XUNA AI`) key the
install folder, Windows notifications, the update cache and every user's saved sign-in.
The installer's file name, `XUNA-AI-Setup.exe`, is what the download link points at.

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
  "Let desktop apps access your microphone".
- App data, including the saved sign-in, lives in `%APPDATA%\XUNA AI`. The app installs
  per user to `%LOCALAPPDATA%\Programs\xuna-desktop`.

## More

- [docs/decisions.md](docs/decisions.md): why the app is built the way it is.
- [docs/follow-ups.md](docs/follow-ups.md): code signing and known minor issues.
