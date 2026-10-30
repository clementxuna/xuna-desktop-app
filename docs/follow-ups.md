# Follow-ups

## Renewals

The Mac build stops working when either of these expires. Replace the variable in the
Codemagic group `xuna_mac_release` (see "Mac builds" in the README).

- **GitHub token** (`GH_TOKEN`): expires on October 6, 2027. It is the fine-grained token
  `codemagic-xuna-desktop-releases` on the clementxuna GitHub account.
- **Developer ID Application certificate** (`CSC_LINK`, `CSC_KEY_PASSWORD`): expires on
  November 25, 2027. Apps signed before then keep working, and installed copies accept
  updates signed with the renewed certificate, because both carry the team ID 57JSRUV65Y.
  Only the Account Holder of the Apple Developer team can create one:
  1. Make a new private key and certificate signing request:
     `openssl req -new -newkey rsa:2048 -nodes -keyout developer-id.key -out XUNA-AI-Developer-ID.certSigningRequest -subj "/CN=XUNA AI/C=US"`
  2. The Account Holder creates a "Developer ID Application" certificate (G2 Sub-CA) from
     the request at developer.apple.com and sends back the `.cer`.
  3. Bundle the certificate, the key and Apple's
     [Developer ID G2 intermediate](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer)
     into a `.p12`, with the older encryption that macOS's keychain can import (convert both
     `.cer` files to PEM first with `openssl x509 -inform DER`):
     `openssl pkcs12 -export -inkey developer-id.key -in developer-id-application.pem -certfile DeveloperIDG2CA.pem -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -out developer-id.p12`
  4. In Codemagic, set `CSC_LINK` to the `.p12` in base64 and `CSC_KEY_PASSWORD` to its
     password.
  5. The push provisioning profile lists the certificate it works with, so make a new one:
     at developer.apple.com, open Profiles → + → Developer ID, choose App ID
     `ai.xuna.desktop` and the new certificate. Save it as
     `build/developer-id.provisionprofile` and release.
- The App Store Connect API key (`APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`)
  doesn't expire, but stops working if it is revoked. It is "Codemagic notarization", with
  Developer access only.
- The APNs key that XUNA's servers use to send push notifications doesn't expire either.

## Worth doing

- **Send push notifications from XUNA's servers.** The Mac app registers with Apple and gives
  XUNA pages its device token, but nothing sends to it yet. See
  [push-notifications.md](push-notifications.md) for the web app and server work.
- **Windows code signing.** It removes the "Windows protected your PC" warning, and the
  cases where Smart App Control blocks the installer outright.
  - Microsoft's Azure code-signing service costs about $10 a month and needs identity
    verification.
  - It works with electron-builder through `win.azureSignOptions`, with no code changes.
  - Switching from unsigned to signed doesn't break updates.
- **Keep Electron current**, roughly monthly, for Chromium security fixes. See "Release a new
  version" in the README.
- **Check the first Mac update.** Updating from one Mac release to the next hasn't been
  tried yet; the first chance is the release after 1.1.0.
- **Check the restart prompt on Mac.** On Windows it was tried end to end with local test
  builds: the question at launch, Restart Now, Later, the notification and Check for Updates….
  On Mac, Restart Now goes through Electron's own install and hasn't been tried. Things to see:
  - Whether XUNA reopens as the new version.
  - What happens if a page answers "Stay" during the restart. Electron waits for every window
    to close, so the update probably installs the next time the window closes.
- **Click the update notification on Windows.** The notification appears when XUNA isn't in
  front, and coming back to XUNA asks. Clicking the notification itself hasn't been seen
  working yet:
  - The test build's pop-up disappeared before it could be clicked.
  - Clicking it in the notification centre opened the real app instead, because the test build
    shares the real app's notification ID (`APP_ID`).
  - With the real app, a notification-centre click should start a second copy, which hands over
    to the running one and brings it to the front, and that asks.
- **Try the workspace picker on a Mac with a real account.** It was tried end to end in a
  Windows development run (`XUNA_WORKSPACE_TABS=1`) against a stand-in for XUNA that keeps its
  workspace the way XUNA does. On a Mac, with an account in several workspaces, check:
  - the + menu lists what XUNA's switcher lists, and a picked workspace opens signed in;
  - two tabs on different workspaces each keep theirs while you work in both, including after
    a switch in one of them, a reload, and quitting and reopening;
  - a XUNA pop-up, such as connecting an integration, acts on the tab that opened it;
  - signing out in one tab signs out the others, and signing back in returns each tab to its
    workspace;
  - the menu's headings on macOS 14 and later, and plain greyed labels on older systems;
  - updating from 1.2.2 with several named tabs: tab 1 keeps its name, the others show their
    workspace's;
  - signing out of one account and signing in, or signing up, as another: the new account's
    tabs open its own workspaces (each tab offers its last workspace only as a hint), and what
    the sign-in page shows meanwhile (it can show the last workspace's branding);
  - ⌘R while XUNA is still starting, a XUNA pop-up in a different theme from its tab, and a day
    of normal use, all without the tabs turning themselves off;
  - the + panel beside XUNA's own picker, in both themes: the type, colours, logos and shadow,
    searching, the arrow keys, Escape, clicking away (including onto another tab), ⌘T, a long
    list that scrolls, and full screen;
  - in the strip, Ask AI opening and closing XUNA's assistant in the tab in front, dimmed on the
    sign-in page, and its orb beside XUNA's own (in a white-labelled workspace too).
- **Try the one-row title bar on a Mac.** It was tried end to end in a Windows development run
  (`XUNA_WORKSPACE_TABS=1`) against a stand-in for XUNA's header, where Windows' own frame
  ignores drag areas, so the dragging itself hasn't been tried. On a Mac, check:
  - dragging the window by XUNA's header's empty space and by the bar's left end, and
    double-clicking either to zoom; that XUNA's header controls, its menus, the notifications
    drawer, dialogs and toasts all still take clicks;
  - the three buttons in the middle of XUNA's header in one row, and level with the tabs in the
    40px strip, moving between the two as you sign in and out;
  - one row with one tab and with several, in both themes; a narrow window falling back to the
    strip and back; ⌘+ and ⌘− keeping the bar in line; full screen;
  - a XUNA dialog blurring the bar's left end with the page, and the bar fading while the window
    is in the background;
  - Back and Forward; clicking a tab to show it, double-clicking it to rename it (and Rename Tab…
    from its right-click menu leaving the keyboard in the name field), dragging it to a new place,
    and its right-click menu.
  - XUNA's logo leading the bar in one row and in the strip, in both themes, never a workspace's
    own, with XUNA's header showing no second logo, and a click on it going home.
  - To see the drag areas Electron hit-tests, run `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1 npm start`
    (development runs only). In a Windows run it hung the main process as the + panel opened
    (Electron 44.9.3), so open the panel without it.
- **Ask the web team to keep the current workspace per tab** (`docs/multi-tab-workspaces.md`).
  Browser users have the same problem today, and the desktop's hook could then go.

## Known minor issues

None of these is visible to users today.

- **Updater:**
  - Errors only go to the console, logged twice, and there is no log file.
  - The last downloaded installer (about 120 MB) stays in
    `%LOCALAPPDATA%\xuna-desktop-updater` until the next update replaces it.
- **Pop-ups and links:**
  - There is no limit on in-app pop-up windows.
  - Server redirects to plain http aren't intercepted.
  - The site address isn't shown when the main window is on a page outside xuna.ai.
- **Window and shortcuts:**
  - The maximized state is forgotten if the window is closed while minimized.
  - There is no Ctrl+Shift+= or numpad zoom, and no F5 reload.
  - The mouse back button doesn't work in pop-ups.
  - A second crash within 10 seconds leaves a blank window.
- **Title bar:**
  - When XUNA's theme differs from Windows', the bar flips once at launch, and the Alt menu
    bar and the window border keep Windows' colours.
  - The bar doesn't change colour while the offline page is showing.
  - Windows 10 keeps its standard bar, and on Mac the bar follows macOS's light or dark
    mode rather than XUNA's theme setting.
- **Title bar internals:**
  - Theme reports could be limited explicitly to the main window.
  - The preload could guard against very early theme changes and batch its reports.
  - Tests are missing for the `only light` case and for a pure trust check.
- **One row (Mac):**
  - It depends on XUNA's header as the page lays it out today: a `<header>` along the top
    holding its home link (`aria-label="Go to home"`). If XUNA changes that, the window falls
    back to the strip until the desktop app learns the new header.
  - An overlay that XUNA draws inside its app rather than in a layer at the end of the page, as its
    dialogs, menus and drawers are, that isn't a toast and covers only part of the header would drag
    the window where it lies over the header's empty space. None does today.
  - Under a dialog's backdrop a faint seam can show where the bar's left end meets XUNA's header.
  - For a frame or two after the bar changes from the strip to one row, the strip's old drag area
    can still drag the window from XUNA's header controls under it, until the strip redraws.
  - With one tab the empty tab list still takes a gap, so + sits 4 pixels further from Forward, and
    nearer the end of the bar's left end, than designed.
  - In a narrow window with many tabs, the strip runs out of room for them: below about 480px with
    two tabs, 680px with six or 830px with nine, the last tabs run under + and Ask AI, which take
    their clicks. XUNA's logo, added in 1.6.1, made that start about 100px sooner. Clipping the tab
    list would stop it.
  - XUNA's header keeps the 8px gap beside its hidden logo, which its measure of the room it needs
    leaves out, so the room left to drag the window by in one row can be 56px rather than 64.
  - A strip whose page crashes twice within 10 seconds stays gone until the window reopens; View ▸
    Reload reloads XUNA's page, not the strip's.
  - If the + panel's page crashes while it is open, or the strip's while a tab is being renamed,
    the keyboard isn't handed back to XUNA until you click it.
  - The header watcher looks at the page after any change of an attribute, at most five times a
    second, which could be narrowed to the attributes that matter.
- **Workspace tabs (Mac):**
  - Clicking a notification from a tab in the background doesn't bring that tab to the front.
  - Tab buttons are reached by mouse and shortcuts only. Tab doesn't move focus into the strip.
