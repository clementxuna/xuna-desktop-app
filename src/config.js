'use strict';

// What the shell opens and how Windows identifies it. APP_ID and the product name must never change
// after release: the installer, Windows notifications and every user's saved sign-in are keyed on them.
module.exports = {
  APP_ID: 'ai.xuna.desktop',
  APP_URL: 'https://app.xuna.ai',
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
