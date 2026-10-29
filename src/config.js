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
  UPDATE_CHECK_INTERVAL_MS: 6 * 60 * 60 * 1000,
};
