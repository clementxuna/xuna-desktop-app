'use strict';

// What the shell opens and how Windows identifies it. Each app's APP_ID and product name must never
// change after release: the installer, Windows notifications and every user's saved sign-in are keyed on them.
const IDENTITIES = {
  production: { APP_ID: 'ai.xuna.desktop', APP_URL: 'https://app.xuna.ai', PRODUCT_NAME: 'XUNA AI', MAC_PUSH: true },
  beta: { APP_ID: 'ai.xuna.desktop.beta', APP_URL: 'https://beta.xuna.ai', PRODUCT_NAME: 'XUNA AI Beta', MAC_PUSH: false },
};

// Which app this copy is. packageChannel: what the build wrote into package.json (only beta's build writes
// one, in electron-builder.beta.js). defaultApp: Electron's process.defaultApp, set when Electron is started
// on a folder and never in an installed copy, so XUNA_CHANNEL (envChannel) can only move a development run.
function identityFor({ packageChannel, defaultApp, envChannel }) {
  const beta = packageChannel === 'beta' || (Boolean(defaultApp) && envChannel === 'beta');
  return { ...(beta ? IDENTITIES.beta : IDENTITIES.production) };
}

module.exports = {
  ...identityFor({ packageChannel: require('../package.json').xunaChannel, defaultApp: process.defaultApp, envChannel: process.env.XUNA_CHANNEL }),
  identityFor,
  TRUSTED_DOMAIN: 'xuna.ai',
  // The colour of the web app's header, which the title bars match so they join it seamlessly: white in
  // light mode, and in dark mode the page's near-black, which the header shares. Pages paint it before they load.
  BACKGROUND: { light: '#ffffff', dark: '#030303' },
  // Often enough that an update released while XUNA is open is offered within the half hour.
  UPDATE_CHECK_INTERVAL_MS: 30 * 60 * 1000,
  // Coming back to XUNA looks too, unless it looked this recently, so an update released while you were
  // away is offered soon after you return.
  UPDATE_RECHECK_AFTER_MS: 5 * 60 * 1000,
  // After Later, the restart is offered again this long after, while the app stays open.
  UPDATE_REMIND_AFTER_MS: 4 * 60 * 60 * 1000,
};
