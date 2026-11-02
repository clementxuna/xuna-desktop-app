'use strict';

// XUNA AI Beta is production's code with a second identity (see "XUNA AI Beta" in the README). These checks
// keep the two apps apart: anything that let one reach the other's users, sign-ins or updates fails here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { identityFor } = require('../src/config');

test('a copy built without a channel is production', () => {
  assert.deepEqual(identityFor({}), { APP_ID: 'ai.xuna.desktop', APP_URL: 'https://app.xuna.ai', PRODUCT_NAME: 'XUNA AI', MAC_PUSH: true });
});

test('a copy built for beta is beta', () => {
  assert.deepEqual(identityFor({ packageChannel: 'beta' }), { APP_ID: 'ai.xuna.desktop.beta', APP_URL: 'https://beta.xuna.ai', PRODUCT_NAME: 'XUNA AI Beta', MAC_PUSH: false });
});

test('a development run can ask for beta', () => {
  assert.equal(identityFor({ defaultApp: true, envChannel: 'beta' }).PRODUCT_NAME, 'XUNA AI Beta');
});

test('an installed production copy ignores XUNA_CHANNEL', () => {
  assert.equal(identityFor({ envChannel: 'beta' }).APP_ID, 'ai.xuna.desktop');
});

test('an unknown channel is production', () => {
  assert.equal(identityFor({ packageChannel: 'nightly', defaultApp: true, envChannel: 'nightly' }).APP_ID, 'ai.xuna.desktop');
});
