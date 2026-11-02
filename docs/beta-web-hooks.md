# What the desktop app needs from XUNA's page

The desktop app wraps XUNA's web app and relies on a few things in its page. When web work changes one of
them, make the matching change in this repo on the branch for that environment: `beta` for beta.xuna.ai, and
`main` for app.xuna.ai once that web change reaches production.

None of these takes XUNA down. The last column says what happens if it goes missing.

| What the app relies on | Where it reads it | If it changes |
| --- | --- | --- |
| A `<header>` along the top of the page, 40 to 80px tall and as wide as the page, holding `a[aria-label="Go to home"]` | `findHeader` in `src/preload.js` | The one-row bar falls back to the 40px strip above the page |
| A part of that header marked `data-xuna-desktop-flex="<px>"` (XUNA's search field), counted at that width rather than its own | `describeHeader` in `src/preload.js` | Counted at its full width, so one row gives way to the strip in wider windows than it need |
| That home link, which the bar's logo clicks and `src/one-row.css` hides | `src/preload.js`, `src/one-row.css` | The bar's logo stops going home, and XUNA's own logo can show beside it |
| `button[aria-label="Ask AI"]` and its `aria-pressed` | `watchAskAi` in `src/preload.js` | In the strip, Ask AI dims and does nothing |
| `.siri-orb` in that button, with its colours in `--c1` to `--c4` | `watchAskAi` in `src/preload.js` | The strip's orb keeps XUNA's default colours |
| The localStorage keys in `TAB_KEY_PREFIXES`, above all `xuna_active_workspace_id` | `src/workspace-memory.js` | Workspace tabs turn themselves off, so nothing is saved to the wrong workspace |
| `POST /v2/auth/bootstrap`, answering with `accessList` | `hookPage` in `src/preload.js`, `src/workspace-picker.js` | The + panel can't list the account's workspaces |
| The pages drawn without the header: signing in and up, onboarding, iMessage onboarding and the RVM campaign wizard | `PAGES_WITHOUT_HEADER` in `src/preload.js` | A new page without the header keeps the bar's place for 10 seconds, then falls back to the strip |
| The app in `#root`, its dialogs, menus and drawers in later children of `<body>`, and its toasts in `[data-sonner-toaster]` | `src/one-row.css` | Clicks on an overlay over the header can drag the window instead |
| The `color-scheme` of `<html>` | `report` in `src/preload.js` | The title bars follow the system's theme rather than XUNA's |

The other way round, the app tells XUNA which window's title bar its header is, as
`window.xunaDesktop.titleBar` (`'mac'`, `'windows'` or `null`), before XUNA's scripts run. XUNA's beta draws its
desktop header from it: 64px tall, with search as a field in its middle. Without it XUNA draws its browser header.

`docs/follow-ups.md` has more on how the one-row bar depends on XUNA's header.
