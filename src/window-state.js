'use strict';

// Remembers where the main window was. No Electron imports, so it can be unit-tested;
// src/main.js supplies the connected screens and the file path.

const fs = require('node:fs');

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const MIN_VISIBLE = { width: 100, height: 50 }; // enough of the window to grab and drag back

function overlapsEnough(bounds, area) {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
}

// Saved bounds are reused only when they are sane and still on one of the connected screens' work areas.
function chooseBounds(saved, workAreas, defaults) {
  if (!saved || typeof saved !== 'object') return { bounds: defaults, maximized: false };
  const { x, y, width, height } = saved;
  if (![x, y, width, height].every(Number.isFinite) || width < MIN_WIDTH || height < MIN_HEIGHT) {
    return { bounds: defaults, maximized: false };
  }
  const bounds = { x, y, width, height };
  const maximized = saved.maximized === true;
  return workAreas.some((area) => overlapsEnough(bounds, area)) ? { bounds, maximized } : { bounds: defaults, maximized };
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // first run, or an unreadable file: start from the defaults
  }
}

function writeState(file, state) {
  try {
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Losing the window position is not worth interrupting a quit for.
  }
}

module.exports = { chooseBounds, readState, writeState };
