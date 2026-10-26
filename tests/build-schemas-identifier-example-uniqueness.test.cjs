#!/usr/bin/env node
/**
 * Unit tests for lintIdentifierExampleUniqueness in scripts/build-schemas.cjs.
 *
 * Enforces the repo-authored hygiene rule from #8301: no `identifiers` array in
 * a schema example may repeat a (type, value) pair. Extra keys do not make two
 * entries distinct. Modeled on tests/build-schemas-vendor-metric-uniqueness.test.cjs.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lintIdentifierExampleUniqueness } = require('../scripts/build-schemas.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

test('lintIdentifierExampleUniqueness: passes silently over a clean schema tree', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adcp-identifier-example-uniqueness-'));
  try {
    writeJson(path.join(tmpRoot, 'core', 'placement.json'), {
      title: 'Placement',
      examples: [
        {
          identifiers: [
            { type: 'venue_id', value: '1' },
            { type: 'venue_id', value: '2' },
          ],
        },
      ],
    });
    assert.doesNotThrow(() => lintIdentifierExampleUniqueness(tmpRoot));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('lintIdentifierExampleUniqueness: fails on a duplicate (type, value) pair differing only by extra keys', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adcp-identifier-example-uniqueness-'));
  try {
    writeJson(path.join(tmpRoot, 'core', 'placement.json'), {
      title: 'Placement',
      examples: [
        {
          identifiers: [
            { type: 'venue_id', value: '1' },
            { type: 'venue_id', value: '1', x: 1 },
          ],
        },
      ],
    });
    assert.throws(
      () => lintIdentifierExampleUniqueness(tmpRoot),
      /duplicate \(type="venue_id", value="1"\)/,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('lintIdentifierExampleUniqueness: fails on a duplicate nested under a property examples[0].placements[0].identifiers', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adcp-identifier-example-uniqueness-'));
  try {
    writeJson(path.join(tmpRoot, 'core', 'product.json'), {
      title: 'Product',
      properties: {
        placements: {
          type: 'array',
          examples: [
            {
              placements: [
                {
                  identifiers: [
                    { type: 'venue_id', value: '1' },
                    { type: 'venue_id', value: '1' },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    assert.throws(
      () => lintIdentifierExampleUniqueness(tmpRoot),
      /core\/product\.json.*duplicate \(type="venue_id", value="1"\)/s,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('lintIdentifierExampleUniqueness: the real static/schemas/source tree has zero duplicate identifier examples', () => {
  const sourceDir = path.resolve(__dirname, '..', 'static', 'schemas', 'source');
  assert.doesNotThrow(() => lintIdentifierExampleUniqueness(sourceDir));
});

test('lintIdentifierExampleUniqueness: throws on a schema that is not valid JSON', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adcp-identifier-example-uniqueness-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'core'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'core', 'broken.json'), '{ "examples": [ ', 'utf8');
    assert.throws(
      () => lintIdentifierExampleUniqueness(tmpRoot),
      /cannot parse core[\\/]broken\.json/,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
