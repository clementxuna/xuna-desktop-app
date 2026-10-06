# Follow-ups

## Worth doing

- **Code signing.** It removes the "Windows protected your PC" warning, and the cases where
  Smart App Control blocks the installer outright.
  - Microsoft's Azure code-signing service costs about $10 a month and needs identity
    verification.
  - It works with electron-builder through `win.azureSignOptions`, with no code changes.
  - Switching from unsigned to signed doesn't break updates.
- **Keep Electron current**, roughly monthly, for Chromium security fixes. See "Release a new
  version" in the README.

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
  - Windows 10 keeps its standard bar.
- **Title bar internals:**
  - Theme reports could be limited explicitly to the main window.
  - The preload could guard against very early theme changes and batch its reports.
  - Tests are missing for the `only light` case and for a pure trust check.
