'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chooseBounds, readState, writeState } = require('../src/window-state');

const DEFAULTS = { width: 1280, height: 820 };
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xuna-window-state-'));

describe('chooseBounds', () => {
  test('restores the saved size, position and maximized state while that spot is on a connected screen', () => {
    const saved = { x: 2000, y: 100, width: 1400, height: 900, maximized: true };
    assert.deepEqual(chooseBounds(saved, [PRIMARY, SECOND], DEFAULTS), { bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: true });
  });

  test('falls back to the default size, but keeps the maximized choice, when the saved screen is gone', () => {
    const saved = { x: 2000, y: 100, width: 1400, height: 900, maximized: true };
    assert.deepEqual(chooseBounds(saved, [PRIMARY], DEFAULTS), { bounds: DEFAULTS, maximized: true });
  });

  test('treats a window with only a sliver left on screen as off-screen', () => {
    const saved = { x: 1900, y: 100, width: 1400, height: 900 }; // 20px of it on the primary screen
    assert.deepEqual(chooseBounds(saved, [PRIMARY], DEFAULTS), { bounds: DEFAULTS, maximized: false });
  });

  test('ignores missing, corrupt or tiny saved state', () => {
    for (const saved of [null, undefined, 'junk', {}, { x: 0, y: 0, width: 'wide', height: 800 }, { x: 0, y: 0, width: 200, height: 150 }]) {
      assert.deepEqual(chooseBounds(saved, [PRIMARY], DEFAULTS), { bounds: DEFAULTS, maximized: false }, JSON.stringify(saved));
    }
  });
});

describe('readState and writeState', () => {
  test('round-trip the state through a file', () => {
    const file = path.join(tempDir(), 'window-state.json');
    writeState(file, { x: 1, y: 2, width: 1300, height: 800, maximized: false });
    assert.deepEqual(readState(file), { x: 1, y: 2, width: 1300, height: 800, maximized: false });
  });

  test('read a missing or corrupt file as no state', () => {
    const dir = tempDir();
    assert.equal(readState(path.join(dir, 'missing.json')), null);
    fs.writeFileSync(path.join(dir, 'corrupt.json'), '{not json');
    assert.equal(readState(path.join(dir, 'corrupt.json')), null);
  });

  test('never throw when the state cannot be saved', () => {
    assert.doesNotThrow(() => writeState(path.join(tempDir(), 'no-such-folder', 'window-state.json'), { x: 0 }));
  });
});
