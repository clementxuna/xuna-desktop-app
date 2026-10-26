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
- The App Store Connect API key (`APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`)
  doesn't expire, but stops working if it is revoked.

## Worth doing

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
