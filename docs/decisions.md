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

- **Windows' own title bar, recoloured:** black (the app's `#010101`) in dark mode, white in
  light mode. It uses Electron's `accentColor`, which sets Windows' caption colour, rather than
  a custom-drawn bar, so snapping, dragging and the window menu stay native. This needs
  Windows 11.
- **It follows XUNA's own theme setting, not just Windows'.** A sandboxed preload reports the
  page's `color-scheme`. The main process accepts the report only from XUNA pages and maps it
  to one of the two colours. The preload exposes nothing to the page.
- **The colour is applied to every window as it is created,** because Electron otherwise waits
  for the window's first focus and shows Windows' gray until then.

## Releases

- A `v*` tag makes GitHub Actions build the installer, and installed copies update from this
  repo's GitHub Releases. That is why the repo must stay public.
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

## Repository safety

- This repo only pushes to its own GitHub repository. See "Where this repo pushes" in the
  README.
