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
