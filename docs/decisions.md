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

- **On Mac, a bar in XUNA's own colours behind macOS's three buttons.** macOS's own title
  bar is grey in dark mode and follows the system's setting rather than XUNA's, and forcing
  the system theme instead would trap a page set to follow the system on its last colour.
  - The window hides the title bar (`titleBarStyle: 'hidden'`), which keeps the buttons. The bar
    is drawn by `src/title-strip.html` in a `WebContentsView` of its own, kept above the XUNA
    pages, each of which is a view too; the window's own page stays empty. Where the tab in front
    shows XUNA's header the bar is one row (below). Elsewhere, on the sign-in page say, it is the
    strip above the page: 40 pixels, a little taller than macOS's own 28, so its tabs and buttons
    can be 28 pixels with room round them, in XUNA's black or white from the theme the page
    reports, with the three buttons moved down to its middle, level with them.
  - The strip declares no colour scheme. Chromium paints a page in a dark colour scheme with its
    own grey, #121212. In 1.2.0 the strip declared one, and the bar showed grey above XUNA's
    black header.
  - In full screen there is no bar and the page fills the screen, unless two or more tabs are
    open; then the strip stays, so they can still be switched.
  - Closing the window first closes XUNA's pages, so their "Leave this page?" check still
    runs, and a quit that a page held up finishes once they have closed. Back, Forward, Reload
    and Developer Tools act on the XUNA page shown, not the strip.
  - Sign-in and connect pop-ups keep macOS's standard title bar.
  - The strip's page loads again if it crashes, as XUNA's pages do (`src/reload-on-crash.js`), and
    a + panel whose page crashed closes and is made afresh at the next +. The main process hears
    the strip only from its own page, at the address it started at (`isFromOwnPage` in
    `src/policy.js`), since its calls close, rename and move tabs. The + panel's calls aren't
    checked that way: they were kept to what any page in its place could safely make (see
    `src/workspace-picker-panel-preload.js`). A link dropped on either loads nothing, because
    Electron doesn't navigate on a drop (`navigateOnDragDrop` is off by default).
- **One row: XUNA's header is the title bar.** A strip stacked above XUNA's own 56-pixel header
  made two bars, with search and Ask AI twice, where Mac apps such as Slack, Linear and Notion
  put the window's buttons in their own top bar. So where the tab in front shows XUNA's header,
  its page fills the window, the three buttons move into the header's middle, and the strip's view
  covers only the bar's left end: XUNA's logo, Back and Forward, the workspace tabs and +. XUNA's header moves
  over to make room and carries on from there, with its own search and Ask AI (`macWindowLayout`
  in `src/title-bar.js`).
  - Nothing changes in XUNA's web app. The preload finds XUNA's header (the `<header>` holding
    its home link, along the top of the page), reports its height, the room its contents need,
    its colours and the page's zoom, and applies the room the main process makes. The rules that
    make it are `src/one-row.css`, which the main process puts into each tab's page and which do
    nothing until the preload switches one row on.
  - Electron drags a window from any visible view's drag area, whatever lies on top of it, and
    works out a page's drag area in page order, later elements over earlier ones (Electron 44.9.3:
    `NativeWindow::NonClientHitTest` asks every view in turn). So no view's drag area may lie
    under another view's controls. XUNA's header moves over with a margin, not padding, so its box,
    and so its drag area, starts where the strip ends. Its controls are no-drag, as are XUNA's
    dialogs, menus and drawers (in layers at the end of the page) and its toasts. While something
    covers the whole header, as a dialog's backdrop does, the header doesn't drag at all. The +
    panel opens below the bar for the same reason.
  - XUNA's logo leads the bar, before Back, Forward and the tabs, in one row and in the strip
    alike, and it is always XUNA's own: the app is XUNA's whatever the workspace, and the logo
    stays put as the tabs change. XUNA's header hides its own logo meanwhile, which for a
    white-labelled workspace is the workspace's (`src/one-row.css`); only in full screen with one
    tab, where there is no bar, does XUNA's header show its logo as usual. The bar's logo is the
    file XUNA's header uses (`src/xuna-logo.png`), 20px tall, white on black and black on white,
    and a click on it goes home in the tab in front, as XUNA's does. (Until 1.6.1 the tabs came
    before XUNA's header's logo, which followed the tab's workspace.)
  - Where one row can't work, the strip comes back:
    - on pages without XUNA's header, or if XUNA changes it past recognising;
    - on pages outside XUNA's app, such as the offline page or a payment provider's, which say
      nothing about a header, so a tab that goes to one forgets the one it had;
    - on a page narrower than 1024 CSS pixels, where XUNA shows its mobile header and opens a menu
      over the whole page, whose top left would be under the strip;
    - in full screen;
    - and when even the narrowest tabs wouldn't leave XUNA's header its room and 64 pixels to drag
      the window by.
  - The strip measures its left end the same way in either mode, so the choice never changes what
    it was made on. The header still counts as XUNA's own however far it has been moved over, so
    long rows of tabs don't send it back and forth.
  - A page says it has no header only once XUNA has settled: at its sign-in page (`/login`, where
    it sends anyone not signed in), or ten seconds after the page has loaded. XUNA shows its loader,
    which has no header, before anything else, so a reload, and XUNA's loader, keep one row.
  - XUNA's header is marked the moment XUNA draws it, in the task that drew it, so the room made for
    the strip is there from its first frame; the header's first appearance, or the sign-in page's,
    is reported at once rather than on the preload's next look, a fifth of a second later. (Until
    1.6.3 the header showed unmoved under the strip's left end for that long, then slid over.)
- **The window opens with the bar as it last closed.** Until 1.6.3 every window opened with the
  strip, as nothing yet said XUNA would show its header, and switched to one row once XUNA had drawn
  it, behind its loader: the page jumped up 40 pixels, the strip shrank to the bar's left end, the
  three buttons moved, and XUNA's header slid over. A light XUNA on a dark Mac also opened with a
  black bar that then turned white. Now `title-bar.json` in the app's data keeps, as the window
  starts closing, the tab in front's header (without whatever covered it), the strip's measure and
  XUNA's theme (`rememberedBar` in `src/title-bar.js`), and the next window starts from them: in
  one row, the three buttons already there, if that is how the last one closed.
  - A tab whose page hasn't shown XUNA's header yet, at start-up or opened from +, expects the
    header last seen in any tab. Until the page has shown its header, the bar lets it show through,
    so over XUNA's loader its left end is the logo, Back, Forward, the tabs and +, not a box of its
    own; it takes the header's colours as the header appears.
  - The strip shows nothing until the main process has said what to draw, which it does as soon as
    the strip's script is listening. It measures itself only once it has its tabs and XUNA's Inter
    (or three seconds have passed), and its logo has its size before its image loads, so the bar
    doesn't change size as they arrive. Until 1.6.3 the strip drew a default bar first, and its first
    measure, made before it had its tabs, briefly shrank the bar.
  - A window that last closed without XUNA's header in front, signed out say, opens with the strip.
    One that closed in one row but finds itself signed out shows its left end over XUNA's loader
    until XUNA shows its sign-in page, and then the strip.
  - It follows the page's zoom, which the main process knows at once; the page's own word on its
    width lags while the window is resized. The bar is as tall as the zoomed header, and the room
    made in the header is in the page's own pixels. The strip's own controls stay their size, as a
    browser's do when a page is zoomed.
  - While a XUNA dialog's blurred backdrop covers the page, the bar's left end takes on the same
    look, from the backdrop's blur and tint as the page reports them, and takes no clicks. XUNA's
    menus don't count as covering: while one is open the page takes no clicks at all, which is not
    the same.
- **Back and Forward in the bar,** after the three buttons and XUNA's logo, as Slack, Notion and Arc have them:
  the app has no browser buttons, and ⌘[ and ⌘] had nothing to click. They act on the tab in
  front and are dimmed while there is nowhere to go.
- **Nothing in the bar fades with the window in the background.** Until 1.6.3 the strip's
  controls and, in one row, XUNA's header's contents faded to half, as macOS's own toolbars do.
  That dimmed XUNA's Ask AI orb, which should keep its colour, as any app's coloured content does,
  and flashed the whole bar at every change of window. macOS's three buttons still grey out.
- **Ask AI at the strip's right end, beside the + button,** where XUNA's header puts its own next
  to the workspace switcher. It presses XUNA's own Ask AI button in the tab in front (the header
  button, `aria-label="Ask AI"`), so the assistant opens and closes exactly as it does from
  XUNA: XUNA offers no other way in, no shortcut, event or address. The page's preload says
  whether the button is there (it isn't on the sign-in page, and the strip's waits, its label
  dimmed), whether the assistant is open, and the orb's colours.
  - It is drawn as XUNA draws its own: the outline button with the values XUNA's stylesheet
    computes in each theme, and XUNA's header orb (AskAiOrb, an 18px SiriOrb at rest) in CSS, with
    SiriOrb's own values at that size, in the workspace's own orb colours, so a white-labelled
    workspace's shows its brand. It turns once every six seconds, its mesh running to 720 degrees
    over two turns' time, where every layer is back where it began, and drifts, breathes and glows
    as XUNA's does; it stands still with Reduce Motion on. The strip's type is XUNA's Inter.
  - It never dims: while there is no XUNA button to press yet, only its label does. Until 1.6.3 the
    orb turned at half XUNA's pace, which at 18 pixels reads as standing still, one of its layers
    jumped half a turn every 12 seconds, and it lacked XUNA's frosted face and resting colour.
  - In one row it goes: XUNA's own Ask AI is in the same row.
- **The colours are exactly XUNA's header's:** `#030303` in dark mode (the page colour, which
  the header shares there) and white in light mode, so the title bar and the header read as one
  band. They live in `src/config.js` and have to follow the web app if its header changes colour.
- **Windows' own title bar, recoloured:** black in dark mode, white in
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

- **Several workspaces open at once, as tabs in the title bar.** In one row they follow Back
  and Forward at the bar's left end, before XUNA's header; in the strip they sit at its right
  end, clear of macOS's three buttons. Signed in, you are always in a workspace, so its tab shows
  wherever the bar does, on its own too, without its × then, as the last tab can't close
  (`shownTabs` in `src/title-strip-layout.js`). Until 1.6.2 a tab on its own was hidden, so opening a
  second workspace made two tabs appear at once, and closing back to one hid the one left.
  - A tab on its own isn't drawn until it stands for a workspace you are in: not on a new copy's
    sign-in page (it would read "Workspace 1"), not while signed out, and not with tabs turned off,
    when its name would stop following its workspace. In full screen with one tab there is no bar,
    and Rename does nothing there.
  - You are signed in once XUNA has listed your workspaces this run, or, until it has, while it
    shows its header or the window expects it to, so a returning user's tab is there from the
    first frame rather than appearing as XUNA loads. (In 1.6.2 a list not yet made counted as
    signed in, so after signing out in one run the tab showed on the sign-in page in the next.)
  - It takes room at the bar's left end that + alone didn't, at least 52px, so in windows just
    over 1024px wide one row gives way to the strip a little sooner than before. Each tab is its own `WebContentsView`, and only the one shown is visible. The others
  keep running, so a call or a draft carries on in the background. The window opens with the
  saved tabs, their names and the one that was shown (`workspace-tabs.json` in the app's data).
- **All tabs share one sign-in, and each keeps its own workspace.** Every tab uses the profile
  the app has always used, so a workspace opens in a new tab without signing in again, and
  signing out signs out every tab. XUNA remembers the current workspace in the browser's
  storage, which a profile's pages share, and reads it before every request to fill in its
  `x-workspace-id` header. Two tabs sharing it would switch each other's workspace, and a
  change made in one could be saved to the other's workspace. The same happens with two XUNA
  tabs in a browser today (see `docs/multi-tab-workspaces.md`).
  - So each tab's page gets its own copy of the four keys involved: the current workspace (and
    its `:explicit` flag, a deliberate switch), the branding workspace, and the switcher's
    selected agency and client (`src/workspace-memory.js`). The XUNA preload hooks the page's
    storage before XUNA's scripts run (`contextBridge.executeInMainWorld`, marked experimental
    in Electron 44); every other key stays shared. The main process holds each tab's copy and
    saves it with the tab, so the tab reopens in its workspace. Only the app's own pages
    (app.xuna.ai) get it: other xuna.ai sites have storage of their own.
  - Signing out clears a tab's workspace, but the tab remembers it and offers it as a hint (not
    a deliberate choice) at the next sign-in, so each tab comes back to its own workspace.
  - A XUNA page in a pop-up (an OAuth return, say) reads the workspace of the tab that opened it.
    Pop-ups get the XUNA preload for this; their writes stay their own. Each pop-up's tab is
    recorded as it opens, so a page that loads in it later still finds that tab after the user
    has moved to another, and even if the pop-up has no opener (`noopener`, or a page that cut
    it). Without a record it takes its opener's tab, and only then the tab in front.
  - Tabs used to have a profile each (`persist:workspace-2` to `-9`). Those profiles, and the
    sign-ins in them, are deleted at start-up. A tab saved before this starts from the
    workspace the shared profile last held, which is tab 1's, and tabs 2 to 9 lose the names
    typed for them, which may have named another account's workspace.
- **The + panel shows XUNA's own list.** Every XUNA page checks its sign-in with
  `POST /v2/auth/bootstrap` as it starts and when it switches workspace; the answer's
  `accessList` is every workspace the account can open. The preload passes each answer on, and
  the panel offers what XUNA's switcher offers, grouped the same way: the platform, each agency
  with its clients, then clients of agencies the user isn't in. The tab in front has XUNA's
  tick, and the other open tabs show their ⌘ shortcut; picking one shows its tab, and any other
  workspace opens in a new tab as a deliberate choice, as a click in XUNA's switcher does
  (`src/workspace-picker.js`).
- **The panel is drawn as XUNA's own picker,** the panel of its header's breadcrumb
  (`scope-segment.tsx` in the web app): 384px wide, a search field with an Esc key over the
  grouped list, a 20px logo or XUNA's coloured initials (the same palette for the same name),
  the Build Mode badge, and the tick. Its colours, type and shadow are what XUNA's stylesheet
  computes in each theme, measured from app.xuna.ai's own CSS, and it follows the theme the tab
  shows. Inter comes from Google Fonts, as app.xuna.ai gets it. Search ignores case and accents,
  and the arrow keys and Enter work it.
  - It is a small local page (`src/workspace-picker-panel.html`) in a view over the tabs, below
    the + button, not a window of its own, so it behaves in full screen and moves with the
    window. It closes when a workspace is picked, on Escape, and when anything else is clicked,
    which takes its focus (`src/workspace-panel.js`).
  - Its page has its own preload with four calls (show, choose, close, resize), so a page XUNA
    serves with its real component could take its place without the rest changing (see
    `docs/multi-tab-workspaces.md`). A workspace it names is opened only if it was offered.
  - It replaced a native menu, which had no search and couldn't look like XUNA. A tab is named after its workspace unless a name was typed, from
  XUNA's whole list, so a workspace the menu doesn't offer (one still being set up) still names
  its tab. A tab that moves to a workspace with no known name shows "Workspace N" until it has
  one, and renaming a tab to the name it already shows keeps it following its workspace.
- **A guard turns tabs off if XUNA changes how it remembers the workspace.** XUNA reads the
  current workspace before every request, so a tab's page whose sign-in check completes
  without having read it keeps the workspace somewhere the tabs share. The app then says so
  once, closes the other tabs (each page asked first) and opens no more, rather than let
  workspaces mix. A desktop update with the new key turns them back on.
  - It waits five seconds before deciding. The read and the completed check reach the main
    process by different routes, and a check the previous page in a tab started can complete
    after the next page has begun; a check whose page has since been replaced is let go.
  - It goes by the page, so it holds wherever XUNA's API is. A page back from the back/forward
    cache says again that it reads its workspace, since it starts no new preload.
- **Before this, each tab had its own profile and sign-in.** That kept the change desktop-only,
  but every new workspace meant signing in again (a tab could also be signed in to another
  account). Tabs are now for one account's workspaces.
- **Mac only.** Windows keeps its own title bar, recoloured. Tabs there would mean drawing a
  title bar in place of Windows' own.
- **Shortcuts, as in Safari:** ⌘T opens the + menu (Window > Open Workspace…), ⌘W closes the
  tab shown (only when more than one is open, and only while the main window is in front), ⌘1
  to ⌘9 show one and ⌃Tab steps through them. The Window menu lists the tabs. At most nine tabs
  can be open, one for each of ⌘1 to ⌘9.
- **Tabs move and have a menu, as in Safari:** dragging a tab along the bar moves it, and ⌘1 to
  ⌘9 follow the new order; right-clicking one offers Rename Tab…, Close Tab and Close Other Tabs.
- **Closing a tab asks its page first,** as closing the window does. The tab whose page asks
  "Leave this page?" comes to the front. Answering Stay keeps it. When the window is closing,
  Stay also keeps the window open and reopens the pages already closed.
- **The strip is a local page with its own sandboxed preload** (`src/title-strip-preload.js`)
  that passes button clicks to the main process. Its policy allows only its own scripts. It is
  in a view of its own, and the main process listens only to that view's page. XUNA pages never
  get the tab controls.

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
- **Updates ask to restart** (`src/updates.js`). electron-updater's own
  `checkForUpdatesAndNotify()` showed a notification that did nothing when clicked, and the
  update only installed at the next quit. Now a downloaded update brings up Restart Now / Later.
  If XUNA isn't in front, a notification appears instead, and clicking it or coming back to XUNA
  asks. Check for Updates… sits where each platform puts it: under About in the Mac app menu, and
  in Help on Windows, since the app has no settings menu.
- **An update is offered within the half hour, mid-work included.** The app checks every 30
  minutes, when the computer wakes, and when XUNA comes back to the front unless it looked in
  the last five minutes (`UPDATE_RECHECK_AFTER_MS`), so an update released while XUNA was in the
  background turns up soon after you return. It asks as soon as an update has downloaded,
  whatever the user is doing. After Later it asks again 4 hours on while the app stays open
  (`UPDATE_REMIND_AFTER_MS`). The checks carry on with an update waiting, so a newer release
  replaces it, but only look: on Mac, downloading the same update again hands the whole app to
  Squirrel again, so only a newer version is downloaded.
- **On Windows, Restart Now quits before it installs.** The installer force-closes any copy
  still running about a second after it starts. electron-updater's `quitAndInstall()` starts it
  first, so a page that answered "Stay" to "Leave this page?" would lose its unsaved changes.
  The app quits normally first and starts the installer in `will-quit`, once every page has
  agreed to close. On Mac, Electron already closes the windows before installing.
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
