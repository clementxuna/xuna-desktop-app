'use strict';

// Run by `npm install`: points git at the repo's own hooks (.githooks), so the pre-push guard that
// only allows pushes to this repo is active in every clone. Does nothing outside a git checkout.

const { execFileSync } = require('node:child_process');

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout, or git is missing: there is nothing to guard.
}
