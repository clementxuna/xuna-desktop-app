'use strict';

// What the shell opens and how Windows identifies it. APP_ID and the product name must never change
// after release: the installer, Windows notifications and every user's saved sign-in are keyed on them.
module.exports = {
  APP_ID: 'ai.xuna.desktop',
  APP_URL: 'https://app.xuna.ai',
  TRUSTED_DOMAIN: 'xuna.ai',
  BACKGROUND: { light: '#ffffff', dark: '#010101' }, // the web app's page background, painted before it loads
  UPDATE_CHECK_INTERVAL_MS: 6 * 60 * 60 * 1000,
};
