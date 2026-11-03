// Checks the dev server's path confinement without starting it:
//   node --test scripts/dev.test.js
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveRequestPath } from './dev.js';

const root = path.resolve('/srv/apex-grid');

test('serves a normal path under the root', () => {
  assert.deepEqual(resolveRequestPath(root, '/demo/index.html?x=1#top'), {
    urlPath: '/demo/index.html',
    filePath: path.join(root, 'demo/index.html'),
  });
});

test('rejects a sibling directory whose name starts with the root name', () => {
  assert.deepEqual(resolveRequestPath(root, '/..%2fapex-grid-x%2fsecret'), { status: 403 });
  assert.deepEqual(resolveRequestPath(root, '/../apex-grid-samples/package.json'), {
    status: 403,
  });
});

test('rejects encoded and literal parent escapes', () => {
  assert.deepEqual(resolveRequestPath(root, '/..%2f..%2fpackage.json'), { status: 403 });
  assert.deepEqual(resolveRequestPath(root, '/%2e%2e/%2e%2e/etc/passwd'), { status: 403 });
  assert.deepEqual(resolveRequestPath(root, '/..'), { status: 403 });
});

test('keeps a dotted name inside the root', () => {
  assert.equal(resolveRequestPath(root, '/..notes.txt').filePath, path.join(root, '..notes.txt'));
});

test('answers 400 for a malformed escape or a NUL byte', () => {
  assert.deepEqual(resolveRequestPath(root, '/%E0%A4%A'), { status: 400 });
  assert.deepEqual(resolveRequestPath(root, '/%'), { status: 400 });
  assert.deepEqual(resolveRequestPath(root, '/a%00b'), { status: 400 });
});
