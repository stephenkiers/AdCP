#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { lint, refFile, SCHEMA_DIR } = require('../scripts/lint-inline-identifier.cjs');

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

test('an inline copy under prefixItems fails (rule 1)', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'x/tuple.json': { type: 'array', prefixItems: [inlineCopy()] },
  });
  assert.deepEqual(violations, [
    { rule: 'inline-copy', file: 'x/tuple.json', path: '/prefixItems/0' },
  ]);
});

test('a schema that is not valid JSON is a violation, not a silent skip', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-inline-identifier-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'x'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'core', 'identifier.json'), JSON.stringify(canonical()));
  fs.writeFileSync(path.join(dir, 'x', 'broken.json'), '{ "properties": { "id": ');
  const violations = lint(dir, new Map()).map((v) => ({ rule: v.rule, file: v.file, path: v.path }));
  assert.deepEqual(violations, [
    { rule: 'malformed-json', file: 'x/broken.json', path: '/' },
  ]);
});

test('refFile resolves relative, absolute-schema, and external refs', () => {
  assert.equal(refFile('../enums/identifier-types.json', 'x/y.json'), 'enums/identifier-types.json');
  assert.equal(refFile('/schemas/enums/identifier-types.json#/x', 'x/y.json'), 'enums/identifier-types.json');
  assert.equal(refFile('#/$defs/a', 'x/y.json'), 'x/y.json');
  assert.equal(refFile('https://example.com/schemas/enums/identifier-types.json', 'x/y.json'), null);
  assert.equal(refFile('/other/identifier.json', 'x/y.json'), null);
  assert.equal(refFile(undefined, 'x/y.json'), null);
});

test('an inline copy written with a relative enum ref still fails (rule 1)', (t) => {
  const copy = inlineCopy();
  copy.properties.type = { $ref: '../enums/identifier-types.json' };
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'x/rel.json': { properties: { id: copy } },
  });
  assert.deepEqual(violations, [{ rule: 'inline-copy', file: 'x/rel.json', path: '/properties/id' }]);
});

test('a ./identifier.json sibling ref from core/ with siblings fails (rule 2)', (t) => {
  const violations = lintTree(t, {
    'core/identifier.json': canonical(),
    'core/other.json': { properties: { id: { $ref: './identifier.json', maxLength: 3 } } },
  });
  assert.deepEqual(violations, [{ rule: 'sibling-keywords', file: 'core/other.json', path: '/properties/id' }]);
});

test('an external-URL enum ref is not treated as an inline copy', (t) => {
  const copy = inlineCopy();
  copy.properties.type = { $ref: 'https://example.com/schemas/enums/identifier-types.json' };
  assert.deepEqual(
    lintTree(t, { 'core/identifier.json': canonical(), 'x/ext.json': { properties: { id: copy } } }),
    [],
  );
});

test('an allowlist key whose jsonPath contains | is split on the first | only', (t) => {
  const allowed = new Map([['x/pipe.json|/properties/a|b', 'reason']]);
  const violations = lintTree(t, { 'core/identifier.json': canonical() }, allowed);
  assert.deepEqual(violations, [{ rule: 'allowlist', file: 'x/pipe.json', path: '/properties/a|b' }]);
});
