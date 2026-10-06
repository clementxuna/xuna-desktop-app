'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { createPolicy, isSafeExternalUrl, chromeUserAgent } = require('../src/policy');

const policy = createPolicy({ appUrl: 'https://app.xuna.ai', trustedDomain: 'xuna.ai' });
const FROM_APP = 'https://app.xuna.ai/settings/billing';
const FROM_STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_1';

describe('windowOpen', () => {
  test('keeps scripted about:blank pop-ups in the app so the opener can drive them (GoHighLevel connect)', () => {
    assert.equal(policy.windowOpen({ url: 'about:blank', disposition: 'new-window', openerUrl: FROM_APP }), 'in-app');
    assert.equal(policy.windowOpen({ url: '', disposition: 'new-window', openerUrl: FROM_APP }), 'in-app');
  });

  test('keeps sized sign-in pop-ups in the app (Firebase signInWithPopup)', () => {
    const url = 'https://auth.xuna.ai/__/auth/handler?apiKey=k&authType=signInViaPopup&providerId=google.com';
    assert.equal(policy.windowOpen({ url, disposition: 'new-window', openerUrl: FROM_APP }), 'in-app');
  });

  test('opens new tabs on the app itself in the app, so they share the signed-in session', () => {
    assert.equal(policy.windowOpen({ url: 'https://app.xuna.ai/agents/42', disposition: 'foreground-tab', openerUrl: FROM_APP }), 'in-app');
  });

  test('sends new tabs to other sites to the default browser (docs, invoices, media)', () => {
    for (const url of ['https://docs.xuna.ai/', 'https://invoice.stripe.com/i/acct_1/test_1', 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png']) {
      assert.equal(policy.windowOpen({ url, disposition: 'foreground-tab', openerUrl: FROM_APP }), 'external', url);
    }
  });

  test('keeps tabs opened by a third-party page in the app, because such flows can depend on window.opener', () => {
    assert.equal(policy.windowOpen({ url: 'https://stripe.com/legal', disposition: 'foreground-tab', openerUrl: FROM_STRIPE }), 'in-app');
  });

  test('sends plain-http windows to the default browser, whoever opens them', () => {
    assert.equal(policy.windowOpen({ url: 'http://example.com/', disposition: 'foreground-tab', openerUrl: FROM_STRIPE }), 'external');
    assert.equal(policy.windowOpen({ url: 'http://example.com/', disposition: 'new-window', openerUrl: FROM_APP }), 'external');
  });

  test('treats an unknown opener like the app rather than like a third-party page', () => {
    assert.equal(policy.windowOpen({ url: 'https://docs.xuna.ai/', disposition: 'foreground-tab', openerUrl: '' }), 'external');
  });

  test('hands mailto, tel and sms links to the system', () => {
    for (const url of ['mailto:hi@xuna.ai', 'tel:+15555550100', 'sms:+15555550100']) {
      assert.equal(policy.windowOpen({ url, disposition: 'foreground-tab', openerUrl: FROM_APP }), 'external', url);
    }
  });

  test('opens blob URLs made by the app in the app, and refuses blob URLs from any other origin', () => {
    assert.equal(policy.windowOpen({ url: 'blob:https://app.xuna.ai/5f1d', disposition: 'foreground-tab', openerUrl: FROM_APP }), 'in-app');
    assert.equal(policy.windowOpen({ url: 'blob:https://evil.example/5f1d', disposition: 'foreground-tab', openerUrl: FROM_APP }), 'deny');
  });

  test('refuses local files, scripts, data URLs, Windows protocol handlers and junk', () => {
    for (const url of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,hi', 'search-ms:query=x', 'ms-settings:privacy', 'not a url']) {
      assert.equal(policy.windowOpen({ url, disposition: 'new-window', openerUrl: FROM_APP }), 'deny', url);
    }
  });
});

describe('navigation', () => {
  test('lets the main window follow any https page (Stripe, Google sign-in and integration redirects)', () => {
    for (const url of ['https://app.xuna.ai/dashboard', 'https://connect.stripe.com/setup/s/abc', 'https://accounts.google.com/o/oauth2/auth', 'https://marketplace.gohighlevel.com/oauth/chooselocation']) {
      assert.equal(policy.navigation(url), 'allow', url);
    }
  });

  test('sends plain-http pages and mailto, tel and sms links out of the app', () => {
    for (const url of ['http://example.com/', 'mailto:hi@xuna.ai', 'tel:+15555550100', 'sms:+15555550100']) {
      assert.equal(policy.navigation(url), 'external', url);
    }
  });

  test('allows plain http when it is the app itself (local development)', () => {
    const dev = createPolicy({ appUrl: 'http://localhost:5173', trustedDomain: 'xuna.ai' });
    assert.equal(dev.navigation('http://localhost:5173/login'), 'allow');
  });

  test('refuses local files, Windows protocol handlers, about: pages, scripts and junk', () => {
    for (const url of ['file:///C:/Users/x/doc.html', 'ms-settings:privacy', 'search-ms:query=x', 'about:blank', 'javascript:alert(1)', '']) {
      assert.equal(policy.navigation(url), 'deny', url);
    }
  });
});

describe('permission', () => {
  test('grants the microphone, clipboard reads and notifications to XUNA pages', () => {
    assert.equal(policy.permission('media', 'https://app.xuna.ai/agents/1'), true);
    assert.equal(policy.permission('clipboard-read', 'https://app.xuna.ai/'), true);
    assert.equal(policy.permission('notifications', 'https://auth.xuna.ai/'), true);
  });

  test('denies the microphone to look-alike, insecure and third-party hosts', () => {
    for (const page of ['https://xuna.ai.evil.example/', 'https://evilxuna.ai/', 'http://app.xuna.ai/', 'https://accounts.google.com/']) {
      assert.equal(policy.permission('media', page), false, page);
    }
  });

  test('allows copy-to-clipboard and fullscreen on any page', () => {
    assert.equal(policy.permission('clipboard-sanitized-write', FROM_STRIPE), true);
    assert.equal(policy.permission('fullscreen', 'https://www.youtube.com/embed/x'), true);
  });

  test('denies permissions the app never needs, even to XUNA pages', () => {
    for (const name of ['geolocation', 'midi', 'hid', 'usb', 'serial', 'display-capture', 'idle-detection', 'unknown']) {
      assert.equal(policy.permission(name, 'https://app.xuna.ai/'), false, name);
    }
  });

  test('lets XUNA pages launch only mailto, tel and sms handlers', () => {
    assert.equal(policy.permission('openExternal', 'https://app.xuna.ai/', 'tel:+15555550100'), true);
    assert.equal(policy.permission('openExternal', 'https://app.xuna.ai/', 'ms-settings:privacy'), false);
    assert.equal(policy.permission('openExternal', 'https://app.xuna.ai/', 'https://example.com/'), false);
    assert.equal(policy.permission('openExternal', 'https://evil.example/', 'mailto:x@example.com'), false);
  });
});

describe('isTrustedPage', () => {
  test('trusts the app and https pages on xuna.ai and its subdomains only', () => {
    for (const url of ['https://app.xuna.ai/x', 'https://docs.xuna.ai/', 'https://xuna.ai/']) assert.equal(policy.isTrustedPage(url), true, url);
    for (const url of ['http://app.xuna.ai/', 'https://xuna.ai.evil.example/', 'https://evilxuna.ai/', 'file:///C:/x', '']) {
      assert.equal(policy.isTrustedPage(url), false, url);
    }
  });
});

test('isSafeExternalUrl accepts web, email, phone and SMS links only', () => {
  for (const url of ['https://x.com/', 'http://x.com/', 'mailto:a@b.c', 'tel:+1555', 'sms:+1555']) assert.equal(isSafeExternalUrl(url), true, url);
  for (const url of ['file:///C:/x', 'javascript:alert(1)', 'ms-settings:privacy', 'search-ms:query=x', '', 'junk']) {
    assert.equal(isSafeExternalUrl(url), false, url);
  }
});

test('chromeUserAgent reads as desktop Chrome with a reduced version and no Electron token', () => {
  const ua = chromeUserAgent('152.0.7977.78');
  assert.equal(ua, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  assert.doesNotMatch(ua, /Electron/);
});
