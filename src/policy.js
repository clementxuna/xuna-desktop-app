'use strict';

// What the shell does with links, pop-ups and permission requests. Plain functions with no Electron
// imports, so every rule is covered by test/policy.test.js; src/main.js wires them into Electron.

const SYSTEM_SCHEMES = new Set(['mailto:', 'tel:', 'sms:']);
const ANY_PAGE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);
const TRUSTED_PAGE_PERMISSIONS = new Set(['media', 'clipboard-read', 'notifications', 'speaker-selection']);

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const isWeb = (u) => u.protocol === 'https:' || u.protocol === 'http:';

// The only kinds of links the shell will ever hand to Windows.
function isSafeExternalUrl(url) {
  const u = parseUrl(url);
  return u !== null && (isWeb(u) || SYSTEM_SCHEMES.has(u.protocol));
}

function createPolicy({ appUrl, trustedDomain }) {
  const appOrigin = new URL(appUrl).origin;

  function isTrustedPage(url) {
    const u = parseUrl(url);
    if (!u) return false;
    if (u.origin === appOrigin) return true;
    return u.protocol === 'https:' && (u.hostname === trustedDomain || u.hostname.endsWith(`.${trustedDomain}`));
  }

  // window.open() and target="_blank" links: 'in-app' (a child window that keeps window.opener),
  // 'external' (the default browser or mail/phone app) or 'deny'.
  function windowOpen({ url, disposition, openerUrl }) {
    if (!url || url === 'about:blank') return 'in-app'; // a pop-up its opener navigates itself (GoHighLevel connect)
    const u = parseUrl(url);
    if (!u) return 'deny';
    if (SYSTEM_SCHEMES.has(u.protocol)) return 'external';
    if (u.protocol === 'blob:') return u.origin === appOrigin ? 'in-app' : 'deny';
    if (!isWeb(u)) return 'deny';
    if (u.origin === appOrigin) return 'in-app'; // the app itself: keep the signed-in session
    if (u.protocol !== 'https:') return 'external';
    if (disposition === 'new-window') return 'in-app'; // a sized pop-up: sign-in and OAuth flows
    const opener = parseUrl(openerUrl);
    if (opener && isWeb(opener) && !isTrustedPage(openerUrl)) return 'in-app'; // third-party flows may rely on window.opener
    return 'external';
  }

  // Main-frame navigations a page starts: 'allow', 'external' or 'deny'.
  function navigation(url) {
    const u = parseUrl(url);
    if (!u) return 'deny';
    if (u.protocol === 'https:' || u.origin === appOrigin) return 'allow';
    if (u.protocol === 'http:' || SYSTEM_SCHEMES.has(u.protocol)) return 'external';
    return 'deny';
  }

  // pageUrl is the top-level page asking; externalUrl is set for 'openExternal' (a page launching a protocol handler).
  function permission(name, pageUrl, externalUrl) {
    if (ANY_PAGE_PERMISSIONS.has(name)) return true;
    if (!isTrustedPage(pageUrl)) return false;
    if (name === 'openExternal') {
      const target = parseUrl(externalUrl);
      return target !== null && SYSTEM_SCHEMES.has(target.protocol);
    }
    return TRUSTED_PAGE_PERMISSIONS.has(name);
  }

  return { isTrustedPage, windowOpen, navigation, permission };
}

// Desktop Chrome's reduced user-agent string. Google refuses sign-in from browsers that identify as Electron.
function chromeUserAgent(chromeVersion) {
  const major = String(chromeVersion).split('.')[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

module.exports = { createPolicy, isSafeExternalUrl, chromeUserAgent };
