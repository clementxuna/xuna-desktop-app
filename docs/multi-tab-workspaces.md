# Several workspaces at once, under one sign-in

What XUNA's web app should change so one account can work in two workspaces at the same time,
in two browser tabs or two desktop tabs. The desktop app works around it today (see "What the
desktop app does").

## The problem, in a browser too

XUNA keeps the current workspace in `localStorage` (`xuna_active_workspace_id`, and
`xuna_active_workspace_id:explicit` after a deliberate switch). Every tab of the site shares
it, and the request interceptor (`src/lib/http.ts`) reads it before every request to set
`x-workspace-id`.

1. Open XUNA in two browser tabs, on workspace A.
2. In tab 2, switch to workspace B.
3. Tab 1 still shows A: its state, and the `/v2/workspaces/<id>/…` paths it calls, say A. But
   its requests now send `x-workspace-id: B`. Endpoints that go by the header, such as the
   hierarchy lists, answer for B, and a change made there is saved to B.
4. Reloading tab 1 opens B.

## What the web app should change

1. **Keep the current workspace per tab.** Read it from `sessionStorage` (each tab has its
   own) and fall back to `localStorage`, so a new tab still opens the last workspace used. On
   a switch, write both: `sessionStorage` for this tab, `localStorage` as the default for the
   next one. The same goes for the `:explicit` flag, `xuna_branding_workspace_id`, and the
   switcher's `xuna_sidebar_selected_agency:<uid>` and `xuna_sidebar_selected_client:<uid>`.
2. **Optionally, accept a workspace in the address,** such as `?workspace=<id>`, as a
   deliberate choice. A link, or the desktop app, could then open a workspace in a new tab
   directly.

3. **Optionally, serve the + panel's page.** The desktop draws its own copy of the header's
   picker for the + button. A page at app.xuna.ai rendering the real `ScopeSegment` could take
   its place, kept in step with the platform. The desktop would show it in the same panel with a
   preload that gives it `window.workspacePanel`:
   - `onShow((model, fresh) => …)`: the workspaces to list, each `{ kind: 'workspace', id,
     label, enabled, avatarUrl, badges, current, shortcut }` between `{ kind: 'header', label }`
     rows, and `dark`; `fresh` when the panel has just opened;
   - `choose(id)` to open a workspace, `close()`, and `resize(height)` so the panel fits.

## What the desktop app does

- On Mac, all workspace tabs share one sign-in: Firebase keeps it once per Electron profile.
- Each tab's page gets its own copy of the four keys above. The desktop's preload hooks
  `Storage.prototype.getItem`, `setItem` and `removeItem` before XUNA's scripts run, so those
  keys read and write the tab's copy, which the app saves with the tab (`src/preload.js`,
  `src/workspace-memory.js`). Every other key is untouched.
- The + menu lists the `accessList` of each `POST /v2/auth/bootstrap` answer, grouped as the
  switcher groups it (`src/workspace-picker.js`). A workspace picked there opens in a new tab
  with the `:explicit` flag set, as a switcher click would.
- If a tab's page completes a sign-in check without having read `xuna_active_workspace_id`,
  the app assumes the workspace is kept somewhere else and turns its tabs off.

## Before changing any of this, tell the desktop team

The desktop app depends on:

- the key names: `xuna_active_workspace_id` (and anything starting with it),
  `xuna_branding_workspace_id`, `xuna_sidebar_selected_agency:` and
  `xuna_sidebar_selected_client:`;
- the page reading `xuna_active_workspace_id` with `localStorage.getItem` before each request;
- `POST …/v2/auth/bootstrap` answering
  `{ data: { user: { uid }, accessList: [{ workspace: { id, type, companyName, name, parentWorkspaceId, onboardingStatus, billing: { buildingMode } } }] } }`.

Change 1 above, done as described, means the page stops reading `localStorage` once a tab has
its own copy, which the desktop app takes for the workspace having moved: it turns its tabs off.
So ship it together with a desktop release that drops the hook, which change 1 makes
unnecessary.
