'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { reloadOnCrash } = require('../src/reload-on-crash');

// Stands in for a page: it emits Electron's render-process-gone, and counts its reloads.
function fakePage() {
  const page = new EventEmitter();
  page.reloads = 0;
  page.reload = () => {
    page.reloads += 1;
  };
  page.crash = (reason = 'crashed') => page.emit('render-process-gone', {}, { reason });
  return page;
}

test('a page whose renderer crashes reloads', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = fakePage();
  reloadOnCrash(page);
  page.crash();
  assert.equal(page.reloads, 1);
});

test('a page whose renderer was killed reloads too, but not one that closed', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const killed = fakePage();
  reloadOnCrash(killed);
  killed.crash('killed');
  assert.equal(killed.reloads, 1);
  const closed = fakePage();
  reloadOnCrash(closed);
  closed.crash('clean-exit');
  assert.equal(closed.reloads, 0);
});

test('a page that crashes again within ten seconds of reloading is left, rather than reloaded over and over', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = fakePage();
  reloadOnCrash(page);
  page.crash();
  t.mock.timers.tick(9_999);
  page.crash();
  assert.equal(page.reloads, 1);
});

test('a page that crashes ten seconds or more after reloading reloads again', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = fakePage();
  reloadOnCrash(page);
  page.crash();
  t.mock.timers.tick(10_000);
  page.crash();
  assert.equal(page.reloads, 2);
});
