'use strict';

// This repo must only ever push to its own GitHub repository. These checks keep any other
// repository out of the files, the remotes and the push guard. They list what is allowed rather
// than what is forbidden, so no other repository has to be named here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const THIS_REPO = 'clementxuna/xuna-desktop-app';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

let inGitCheckout = true;
try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  inGitCheckout = false;
}

// "owner/repo" for every github.com URL or github: shorthand in the text.
function githubRepos(text) {
  const found = [];
  for (const match of text.matchAll(/github\.com[/:]([\w-]+)\/([\w.-]+)/gi)) found.push(`${match[1]}/${match[2].replace(/\.git$/i, '')}`);
  for (const match of text.matchAll(/\bgithub:([\w-]+)\/([\w.-]+)/gi)) found.push(`${match[1]}/${match[2]}`);
  return found;
}

test('every GitHub repository named in this repo is this repo', { skip: !inGitCheckout && 'not a git checkout' }, () => {
  // package-lock.json only holds third-party package metadata (e.g. funding links).
  const files = git('ls-files').split('\n').filter((file) => file && file !== 'package-lock.json');
  const others = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const repo of githubRepos(text)) if (repo.toLowerCase() !== THIS_REPO) others.push(`${file}: ${repo}`);
  }
  assert.deepEqual(others, []);
});

test('the only git remote is this repo', { skip: !inGitCheckout && 'not a git checkout' }, () => {
  const urls = git('remote', '-v').split('\n').filter(Boolean).map((line) => line.split(/\s+/)[1]);
  assert.ok(urls.length > 0, 'origin is configured');
  for (const url of urls) assert.deepEqual(githubRepos(url).map((repo) => repo.toLowerCase()), [THIS_REPO], url);
});

test('the push guard lets pushes through only to this repo', () => {
  const hook = fs.readFileSync(path.join(ROOT, '.githooks', 'pre-push'), 'utf8');
  assert.match(hook, /^#!\/bin\/sh/);
  assert.deepEqual([...new Set(githubRepos(hook).map((repo) => repo.toLowerCase()))], [THIS_REPO]);
  assert.match(hook, /\nexit 1\s*$/, 'anything not allowed above is refused');
});

test('npm install switches git to the repo’s own hooks, so the guard is on in every clone', () => {
  assert.equal(pkg.scripts.prepare, 'node scripts/use-repo-hooks.js');
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'use-repo-hooks.js'), 'utf8');
  assert.match(script, /'core\.hooksPath', '\.githooks'/);
});
