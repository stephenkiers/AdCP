#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { lint, ALLOWED, SCHEMA_DIR } = require('../scripts/lint-inline-identifier.cjs');

const IDENTIFIER_TYPE_REF = { $ref: '/schemas/enums/identifier-types.json' };
const ABSENT = Symbol('absent');

// Canonical record. Defaults to the required shape: opened explicitly (#8301 D1).
// Pass ABSENT to omit the keyword entirely.
function canonical(additionalProperties = true) {
  const doc = {
    $id: '/schemas/core/identifier.json',
    title: 'Identifier',
    type: 'object',
    required: ['type', 'value'],
    properties: { type: IDENTIFIER_TYPE_REF, value: { type: 'string' } },
  };
  if (additionalProperties !== ABSENT) doc.additionalProperties = additionalProperties;
  return doc;
}

function inlineCopy() {
  return {
    type: 'object',
    required: ['type', 'value'],
    properties: { type: IDENTIFIER_TYPE_REF, value: { type: 'string' } },
    additionalProperties: false,
  };
}

function lintTree(t, files, allowed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-inline-identifier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, doc] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(doc));
  }
  return lint(dir, allowed).map((v) => ({ rule: v.rule, file: v.file, path: v.path }));
}

test('source tree has one identifier record, $ref\'d everywhere (#8301)', () => {
  const violations = lint(SCHEMA_DIR);
  assert.deepEqual(
    violations,
    [],
    'inline identifier lint violations:\n' +
      violations.map((v) => `  ${v.file}${v.path} [${v.rule}] ${v.message}`).join('\n'),
  );
});

test('an inline copy of the identifier record fails (rule 1)', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'core/property.json': {
      type: 'object',
      properties: {
        identifiers: { type: 'array', items: inlineCopy() },
      },
    },
  });
  assert.deepEqual(violations, [
    { rule: 'inline-copy', file: 'core/property.json', path: '/properties/identifiers/items' },
  ]);
});

test('a bare $ref to the canonical record passes; description and $comment siblings are inert', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'core/placement.json': {
      type: 'object',
      properties: {
        identifiers: {
          type: 'array',
          items: { $ref: '/schemas/core/identifier.json', description: 'Placement identifier.', $comment: 'x' },
        },
      },
    },
  });
  assert.deepEqual(violations, []);
});

test('a $ref with additionalProperties as a sibling fails (rule 2, sibling hack)', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'core/canonical-placement.json': {
      type: 'object',
      properties: {
        identifiers: {
          type: 'array',
          items: { $ref: '/schemas/core/identifier.json', additionalProperties: true },
        },
      },
    },
  });
  assert.deepEqual(violations, [
    { rule: 'sibling-keywords', file: 'core/canonical-placement.json', path: '/properties/identifiers/items' },
  ]);
});

test('an allowlisted inline copy passes, with a reason', (t) => {
  const files = {
    'core/identifier.json': canonical(),
    'x/legacy.json': { type: 'object', properties: { id: inlineCopy() } },
  };
  const allowed = new Map([['x/legacy.json|/properties/id', 'tracked in a follow-up issue']]);
  assert.deepEqual(lintTree(t, files, allowed), []);
});

test('a stale allowlist entry fails (allowlist hygiene)', (t) => {
  const files = {
    'core/identifier.json': canonical(),
    'x/clean.json': { type: 'object', properties: { id: { $ref: '/schemas/core/identifier.json' } } },
  };
  const allowed = new Map([['x/clean.json|/properties/id', 'no longer a copy']]);
  assert.deepEqual(lintTree(t, files, allowed), [
    { rule: 'allowlist', file: 'x/clean.json', path: '/properties/id' },
  ]);
});

test('an allowlist entry without a reason fails', (t) => {
  const files = {
    'core/identifier.json': canonical(),
    'x/legacy.json': { type: 'object', properties: { id: inlineCopy() } },
  };
  const allowed = new Map([['x/legacy.json|/properties/id', '  ']]);
  assert.deepEqual(lintTree(t, files, allowed), [
    { rule: 'allowlist', file: 'x/legacy.json', path: '/properties/id' },
  ]);
});

test('canonical must declare additionalProperties: true (rule 3)', (t) => {
  const absent = lintTree(t, { 'core/identifier.json': canonical(ABSENT) });
  assert.deepEqual(absent, [{ rule: 'canonical-open', file: 'core/identifier.json', path: '/additionalProperties' }]);

  const closed = lintTree(t, { 'core/identifier.json': canonical(false) });
  assert.deepEqual(closed, [{ rule: 'canonical-open', file: 'core/identifier.json', path: '/additionalProperties' }]);

  const open = lintTree(t, { 'core/identifier.json': canonical(true) });
  assert.deepEqual(open, []);
});

test('the walker reaches inline copies under $defs, allOf, and if/then', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'x/nested.json': {
      $defs: { row: { type: 'object', properties: { id: inlineCopy() } } },
      allOf: [{ if: { required: ['a'] }, then: { properties: { ids: { type: 'array', items: inlineCopy() } } } }],
    },
  });
  assert.deepEqual(violations, [
    { rule: 'inline-copy', file: 'x/nested.json', path: '/$defs/row/properties/id' },
    { rule: 'inline-copy', file: 'x/nested.json', path: '/allOf/0/then/properties/ids/items' },
  ]);
});

test('ALLOWED starts empty', () => {
  assert.equal(ALLOWED.size, 0);
});
