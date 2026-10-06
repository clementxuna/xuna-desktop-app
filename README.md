# XUNA AI for Windows

The Windows desktop app for XUNA AI. It is a small Electron shell that opens
[app.xuna.ai](https://app.xuna.ai) in its own window, so it always shows the newest
version of XUNA: web releases appear in the app without a desktop release.

## How it works

- `src/main.js` opens app.xuna.ai and applies the rules in `src/policy.js`:
  - sign-in, payment and integration pop-ups stay inside the app; ordinary links open
    in the default browser
  - XUNA pages get the microphone, clipboard and notifications; other sites and other
    permissions are refused
  - the app presents a standard Chrome user agent so Google sign-in works
- Installed copies update themselves from this repo's GitHub Releases: they check at
  start-up and every 6 hours, download in the background and install when the app quits.
- `site/` is the download page, deployed separately (see below).

## Develop

```sh
npm install
npm start   # opens app.xuna.ai using a separate "XUNA AI Dev" profile
npm test
```

To point a development run at another environment (installed copies ignore this):

```powershell
$env:XUNA_APP_URL = 'https://beta.xuna.ai'; npm start
```

`npm run dist` builds `dist/XUNA-AI-Setup.exe` locally without publishing it.

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
- Download page: deploy `site/` as its own Vercel project with Root Directory `site`,
  Framework Preset "Other" and no build command. Its `/download` address redirects to
  the newest installer.

## Values that must not change

`appId` (`ai.xuna.desktop`), `name` (`xuna-desktop`) and `productName` (`XUNA AI`) key the
install folder, Windows notifications, the update cache and every user's saved sign-in.
The installer's file name, `XUNA-AI-Setup.exe`, is what the download link points at.
`test/package.test.js` guards all of them.

## Troubleshooting

- **"Windows protected your PC"**: the installer is not code-signed yet. Choose
  More info, then Run anyway.
- **No Run anyway button**: Smart App Control blocks unsigned apps on that PC. Use
  app.xuna.ai in a browser there until the app is signed.
- **Microphone not working**: Windows Settings → Privacy & security → Microphone → turn on
  "Let desktop apps access your microphone".
- App data, including the saved sign-in, lives in `%APPDATA%\XUNA AI`.
