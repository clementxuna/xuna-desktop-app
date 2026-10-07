# Design decisions

Why the XUNA AI desktop app is built the way it is. Each entry gives the decision and the
reason for it.

## Shape of the app

- **A shell around the live site, not a copy of the web app.** The app loads
  <https://app.xuna.ai>, so every web release shows up immediately, and this repo never holds
  the web app's code.
- **Electron.** XUNA relies on browser behaviour that has to match Chrome exactly:
  - Firebase pop-up sign-in.
  - The GoHighLevel connect pop-up, which the page opens blank, steers, and watches until it
    closes.
  - Microphone access for voice agents.

  Electron is full Chromium with mature APIs for all of this, and building it needs only
  Node.js.
- **Separate development profile.** `npm start` uses an "XUNA AI Dev" profile, so a test run
  never collides with an installed copy's single-instance lock or saved sign-in.

## Links and pop-ups (`src/policy.js`)

- The main window follows any https page, because Stripe, Google and integrations redirect
  through it. Plain http, `mailto:`, `tel:` and `sms:` go to Windows.
- Pop-ups opened with a size, or opened blank, stay in the app and keep `window.opener`.
  Sign-in and GoHighLevel connect depend on that.
- New tabs pointing at the app stay in the app, so they share the signed-in session. Other new
  tabs (docs, invoices, media) open in the default browser.
- Windows opened by third-party pages, such as Stripe, stay in the app, because those flows can
  depend on `window.opener`.
- `file:`, `javascript:` and every other scheme are refused. Only http(s), `mailto:`, `tel:` and
  `sms:` are ever handed to Windows.

## Permissions

- **XUNA pages** (https on xuna.ai and its subdomains) get the microphone but never the camera,
  plus notifications and speaker choice.
- **Any page** may copy to the clipboard or go fullscreen, as in Chrome.
- **Everything else is refused.** That includes reading the clipboard, and XUNA-only permissions
  for other sites' frames embedded in a XUNA page, such as an uploaded file shown in a preview.
- Both permission requests and permission status checks are handled, because Electron answers
  "granted" to any check that isn't handled.

## Sign-in

- The app presents a standard Chrome user agent, because Google refuses sign-in from browsers
  that identify as Electron. Google's pop-up sign-in was tested and works.

## Title bar

- **On Mac, the standard title bar.** It follows macOS's light or dark mode. Matching XUNA's
  own theme setting would mean overriding the system theme, which the page also reads, so a
  page set to follow the system would get stuck on whichever colour it last showed.
- **Windows' own title bar, recoloured:** black (the app's `#010101`) in dark mode, white in
  light mode. It uses Electron's `accentColor`, which sets Windows' caption colour, rather than
  a custom-drawn bar, so snapping, dragging and the window menu stay native. This needs
  Windows 11.
- **It follows XUNA's own theme setting, not just Windows'.** A sandboxed preload reports the
  page's `color-scheme`. The main process accepts the report only from XUNA pages and maps it
  to one of the two colours. The preload exposes nothing to the page.
- **The colour is applied to every window as it is created,** because Electron otherwise waits
  for the window's first focus and shows Windows' gray until then.

## Mac

- **Same code, same repo, same release.** The Mac differences are a few `process.platform`
  checks in `src/main.js` and `src/menus.js`, plus the `mac` and `dmg` sections of the
  build settings.
- **It behaves like a Mac app.** Closing the window keeps the app in the Dock, and clicking
  the Dock icon opens a new window. It has the app menu (About, Hide, Quit) and the Window
  menu, and ⌘[ and ⌘] go back and forward, as in Chrome. It presents Chrome for Mac's user
  agent.
- **One universal download** for Apple silicon and Intel, with a fixed name,
  `XUNA-AI.dmg`, so the "latest" link never changes. Installed copies update from the zip
  next to it, `XUNA-AI-mac.zip`, which is what electron-updater uses on Mac. Electron 44
  needs macOS 13 or later.
- **Signed with a Developer ID certificate and notarized by Apple**, so it opens without a
  warning. The hardened runtime is on, with only the entitlements Electron's JavaScript
  engine needs plus the microphone; the app never asks for the camera.
- **Built on Codemagic**, because signing and notarizing need a Mac. Codemagic waits for the
  GitHub Actions job to make the release public and then adds the Mac files to it. Only the
  Windows job creates releases, so a version is never split across two releases.
  electron-builder only warns when a signing secret is missing, so the workflow checks the
  signature, the hardened runtime, the stapled notarization ticket and both architectures
  before uploading anything.
- **Codemagic's GitHub token can only write to this repo**: it is a fine-grained token with
  Contents access to this repository and nothing else.
- **No push notification service.** XUNA's notifications come from the open page (no web
  push), and the signed app shows them as native macOS notifications under its bundle ID.
- **Icon:** the XUNA mark in the Windows icon's blue, on a dark tile with the download
  page's blue glow, drawn on Apple's icon grid (an 824-pixel tile on a 1024-pixel canvas)
  from the vector logomark.

## Releases

- A `v*` tag makes GitHub Actions build the Windows installer and Codemagic the Mac app,
  and installed copies update from this repo's GitHub Releases. That is why the repo must
  stay public.
- electron-builder only builds (`--publish never`). `gh release create` uploads the installer,
  its blockmap and `latest.yml` to a draft and publishes it once all three are in.
  electron-builder's own publisher uploaded the files in parallel and split v1.0.0 across two
  releases.
- The job checks the tag before installing anything, and doesn't leave its write token where
  dependency install scripts could read it.
- **Install settings:**
  - The installer always has the same name, `XUNA-AI-Setup.exe`, so the "latest" download link
    never changes.
  - It installs per user with one click, with no admin prompt.
  - Electron fuses harden the app binary.

## Download page

- **One Vercel config, at the repo root.** `vercel.json` tells Vercel to skip installing and
  building and to serve `site/`, so a project importing the repo needs no settings. Vercel
  reads `vercel.json` only from the project's root folder; a copy inside `site/` was ignored,
  and the first deploy served nothing at `/`.
- **One full-screen view in www.xuna.ai's style**: its type scale, brand blue and hero aurora
  video, with no navigation.
  - It picks the Mac or Windows version from the visitor's browser before the page is
    drawn, and the note under the buttons links to the other one.
  - On Windows, that note covers the unsigned-app warnings; on Mac, it says to drag the app
    into Applications. Phones, tablets and other systems get a note pointing them to a
    computer instead. `/download`, the page's original link, still goes to the Windows
    installer.
  - The fades sit above the video, as on the site, so text stays on dark wherever the aurora
    falls.

## Repository safety

- This repo only pushes to its own GitHub repository. See "Where this repo pushes" in the
  README.
