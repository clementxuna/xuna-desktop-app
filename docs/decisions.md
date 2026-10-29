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

- **On Mac, a strip in XUNA's black or white behind macOS's three buttons.** macOS's own title
  bar is grey in dark mode and follows the system's setting rather than XUNA's, and forcing
  the system theme instead would trap a page set to follow the system on its last colour.
  - The window hides the title bar (`titleBarStyle: 'hidden'`), which keeps the buttons. The
    28-pixel strip they sit on is the window's background colour, which the main process sets
    from the theme the page reports. 28 pixels is macOS's own title bar height, so the buttons
    sit where they always do.
  - XUNA's page is a `WebContentsView` below the strip, because a page that filled the window
    would sit under the buttons. The window's own page is `src/title-strip.html`, which makes
    the strip drag the window and draws the workspace tab buttons (see "Workspace tabs"). In
    full screen the strip goes and the page fills the screen, unless two or more tabs are open.
  - Closing the window first closes XUNA's pages, so their "Leave this page?" check still
    runs, and a quit that a page held up finishes once they have closed. Back, Forward, Reload
    and Developer Tools act on the XUNA page shown, not the strip.
  - Sign-in and connect pop-ups keep macOS's standard title bar.
- **Windows' own title bar, recoloured:** black (the app's `#010101`) in dark mode, white in
  light mode. It uses Electron's `accentColor`, which sets Windows' caption colour, rather than
  a custom-drawn bar, so snapping, dragging and the window menu stay native. This needs
  Windows 11.
- **It follows XUNA's own theme setting, not just the system's.** A sandboxed preload reports the
  page's `color-scheme`. The main process accepts the report only from XUNA pages and maps it
  to one of the two colours. The only thing the preload gives the page is the push registration
  (see "Mac").
- **The colour is applied to every window as it is created,** because Electron otherwise waits
  for the window's first focus and shows Windows' gray until then.

## Workspace tabs (Mac)

- **Several workspaces open at once, as tabs in the title bar strip.** They sit at the strip's
  right end, so they stay clear of macOS's three buttons. With one tab open only the + button
  shows. Each tab is its own `WebContentsView`, and only the one shown is visible. The others
  keep running, so a call or a draft carries on in the background. The window opens with the
  saved tabs, their names and the one that was shown (`workspace-tabs.json` in the app's data).
- **Each tab has its own profile** (an Electron session, `persist:workspace-N`), so each tab
  signs in separately. XUNA keeps the active workspace in the browser's storage and sends it
  with every request. Two tabs sharing a profile would switch each other's workspace, and a
  change made in one could be saved to the other's workspace. Separate profiles keep this a
  desktop-only change, with nothing to do in the web app, and a tab may sign in to a
  different account.
  - Tab 1 uses the default session, so everyone keeps the sign-in they had before tabs.
  - A closed tab's profile is kept, sign-in included, and the next new tab reuses the
    lowest-numbered free one. Its default name, "Workspace N", is that profile's number.
  - Every session gets the same permission rules, and pop-ups share the session of the tab
    that opened them.
- **Mac only.** Windows keeps its own title bar, recoloured. Tabs there would mean drawing a
  title bar in place of Windows' own.
- **Shortcuts, as in Safari:** ⌘T opens a tab, ⌘W closes the one shown (only when more than
  one is open, and only while the main window is in front), ⌘1 to ⌘9 show one and ⌃Tab steps
  through them. The Window menu lists the tabs. At most nine tabs can be open, one for each of
  ⌘1 to ⌘9.
- **Closing a tab asks its page first,** as closing the window does. The tab whose page asks
  "Leave this page?" comes to the front. Answering Stay keeps it. When the window is closing,
  Stay also keeps the window open and reopens the pages already closed.
- **The strip is a local page with its own sandboxed preload** (`src/title-strip-preload.js`)
  that passes button clicks to the main process. Its policy allows only its own script. The
  main process acts only on requests from the main window's own strip. XUNA pages never get
  the tab controls.

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
- **Push notifications through Apple (APNs).** XUNA's web app shows its notifications only
  inside the page, and only while it is open. Through APNs, XUNA's servers can reach a Mac
  even when the app is closed, and macOS shows the notification itself.
  - The App ID `ai.xuna.desktop` has Push Notifications enabled. A Developer ID provisioning
    profile in `build/` allows the push entitlement. Only the app itself has that
    entitlement, because macOS stops any helper process that claims it.
  - The APNs key works only for this app and only in production, because Developer ID apps
    always get production device tokens. The key is kept outside the repo.
  - The app registers at start-up. XUNA pages read the result through
    `window.xunaDesktop.getPushRegistration()`, the one function the preload provides. The
    main process answers only pages on xuna.ai. The web app stores the token with the
    signed-in account, and XUNA's servers send to it.
  - Electron reports no clicks on push notifications, so clicking one opens XUNA but not the
    page it refers to.
  - Windows has no equivalent for apps installed this way.
- **Icon, on Mac and Windows:** XUNA's regular wordmark in white, as on www.xuna.ai. It is
  never the logomark and never light blue, which aren't XUNA's design. The wordmark sits at
  68% of the tile's width, centred on a plain black tile: no gradient, glow or edge line.
  - On Mac the tile follows Apple's icon grid: an 824-pixel tile on a 1024-pixel canvas,
    with 185-pixel corners.
  - On Windows the tile fills the canvas apart from a small margin. A white logo on a
    transparent background would vanish on light taskbars and folders.

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
    drawn, and a second button offers the other one.
  - On Windows, the note under the buttons covers the unsigned-app warnings; on Mac, it says
    to drag the app into Applications. Phones, tablets and other systems get a note pointing
    them to a computer instead. `/download`, the page's original link, still goes to the
    Windows installer.
  - The fades sit above the video, as on the site, so text stays on dark wherever the aurora
    falls.

## Repository safety

- This repo only pushes to its own GitHub repository. See "Where this repo pushes" in the
  README.
