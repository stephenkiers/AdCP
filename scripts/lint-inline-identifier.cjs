#!/usr/bin/env node
/**
 * Keep the identifier record to one definition (#8301).
 *
 * Why this lint exists
 * --------------------
 * `core/identifier.json` is the single definition of a property or placement
 * identifier. Before #8301 four sites carried inline copies of it, and the
 * copies drifted (one closed, one open, different descriptions). Each site must
 * `$ref` the canonical record instead. This lint fails when an inline copy
 * returns, when a `$ref` site adds sibling keywords (draft-07 ANDs them with
 * the target, so a sibling can silently override or tighten the record), or
 * when the canonical stops being explicitly open.
 *
 * Rules
 * -----
 *   1. Inline copy. Any schema node other than the canonical root whose
 *      `properties.type` `$ref`s `enums/identifier-types.json`. The enum `$ref`
 *      is the only signal. Bare `{type, value}` key sets are NOT matched: several
 *      unrelated schemas have that shape with different enums. A copy that
 *      inlines the enum values instead of `$ref`ing them is out of scope and
 *      evades this rule. The `$ref` is resolved relative to the file, so
 *      `../enums/identifier-types.json` and `/schemas/enums/...` both match.
 *   2. Sibling hack. Any schema node that `$ref`s `core/identifier.json` and
 *      carries keywords other than `description` or `$comment`.
 *   3. Canonical stays open-explicit. `core/identifier.json` must declare
 *      `additionalProperties: true`. Keeping the open posture explicit makes a
 *      later change to it a visible diff; revisit this rule when the unknown-key
 *      lint that DR-0019 requires lands.
 *
 * Walk
 * ----
 * Every `.json` under the source directory is visited, skipping `bundled/` and
 * `extensions/` (as `build-schemas.cjs` does). Subschemas are reached through
 * `properties`, `patternProperties`, `$defs`, `definitions`, `dependencies`,
 * `dependentSchemas`, `items`, `additionalItems`, `additionalProperties`,
 * `contains`, `propertyNames`, `not`, `if`, `then`, `else`, `allOf`, `anyOf`,
 * `oneOf`, `prefixItems`, and the unevaluated keywords.
 *
 * Running
 * -------
 * `npm run lint:inline-identifier` runs this file directly; it is also exercised
 * by tests/lint-inline-identifier.test.cjs inside `npm run test:schemas`. It is
 * not called from the schema build.
 *
 * Allowlist
 * ---------
 * Intentional inline copies go in ALLOWED as "relFile|jsonPath" -> reason. The
 * key splits on the FIRST `|`, so a jsonPath may contain `|` but a file name may
 * not. The
 * map starts empty. An entry that no longer matches an inline copy, or that has
 * no reason, is itself a violation, so the allowlist can only stay accurate.
 * tests/lint-inline-identifier.test.cjs covers both.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'static', 'schemas', 'source');

const CANONICAL = 'core/identifier.json';
const IDENTIFIER_TYPE_ENUM = 'enums/identifier-types.json';

// Key: "relFile|jsonPath" (root is "/"). Value: non-empty reason string.
const ALLOWED = new Map();

// Keywords on a `$ref` node that do not change its meaning.
const INERT_SIBLINGS = new Set(['$ref', 'description', '$comment']);

const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'definitions', '$defs', 'dependencies', 'dependentSchemas'];
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SCHEMA_KEYWORDS = [
  'items', 'additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'not',
  'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties',
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function escapePointer(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function listSchemaFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'bundled' || entry.name === 'extensions') continue;
      listSchemaFiles(full, out);
    } else if (entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} schemaDir Directory of schema sources (`bundled/` and `extensions/` are skipped).
 * @param {Array<object>} [parseErrors] Collects `malformed-json` violations.
 * @returns {Map<string, object>} relFile (posix, relative to schemaDir) -> parsed doc.
 *
 * Parse every schema under schemaDir. A file that fails to parse is pushed to
 * parseErrors as a violation rather than skipped, so a malformed schema cannot
 * hide an inline copy from the walk.
 */
function loadSchemas(schemaDir, parseErrors = []) {
  const docs = new Map(); // relFile -> doc
  for (const abs of listSchemaFiles(schemaDir)) {
    const file = path.relative(schemaDir, abs).split(path.sep).join('/');
    try {
      docs.set(file, JSON.parse(fs.readFileSync(abs, 'utf8')));
    } catch (err) {
      parseErrors.push({
        rule: 'malformed-json',
        file,
        path: '/',
        message: `schema is not valid JSON (${err.message}); the identifier walk cannot check it`,
      });
    }
  }
  return docs;
}

/**
 * Resolve a `$ref` written in `fromFile` to a schema-relative file path, or
 * null for external URLs and absolute paths outside /schemas/.
 */
function refFile(ref, fromFile) {
  if (typeof ref !== 'string') return null;
  const hashAt = ref.indexOf('#');
  const filePart = hashAt === -1 ? ref : ref.slice(0, hashAt);
  if (filePart === '') return fromFile;
  if (/^[a-z][a-z0-9+.-]*:/i.test(filePart)) return null;
  if (filePart.startsWith('/schemas/')) return filePart.slice('/schemas/'.length);
  if (filePart.startsWith('/')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), filePart));
}

function isInlineIdentifierCopy(node, file) {
  const type = isPlainObject(node.properties) ? node.properties.type : undefined;
  return isPlainObject(type) && refFile(type.$ref, file) === IDENTIFIER_TYPE_ENUM;
}

function isCanonicalRef(node, file) {
  return typeof node.$ref === 'string' && refFile(node.$ref, file) === CANONICAL;
}

/**
 * Lint already-parsed schemas.
 * @param {Map<string, object>} docs relFile -> parsed doc, as returned by loadSchemas.
 * @param {Map<string, string>} [allowed] "relFile|jsonPath" -> reason. The key splits on the first `|`;
 *   the root path is "/".
 * @returns {Array<{rule: string, file: string, path: string, message: string}>} violations sorted by
 *   file+path. Rules: inline-copy, sibling-keywords, canonical-open, allowlist. Parse failures are not
 *   reported here; `lint()` adds them as `malformed-json`.
 */
function lintDocs(docs, allowed = ALLOWED) {
  const violations = [];
  const copyKeys = new Set();

  function checkNode(node, file, pointer) {
    const jsonPath = pointer || '/';
    const key = `${file}|${jsonPath}`;

    if (!(file === CANONICAL && pointer === '') && isInlineIdentifierCopy(node, file)) {
      copyKeys.add(key);
      if (!allowed.has(key)) {
        violations.push({
          rule: 'inline-copy',
          file,
          path: jsonPath,
          message: 'inline copy of the identifier record (properties.type $refs identifier-types.json); ' +
            'replace the node with {"$ref": "/schemas/core/identifier.json"} and no sibling keywords',
        });
      }
    }

    if (isCanonicalRef(node, file)) {
      const siblings = Object.keys(node).filter((k) => !INERT_SIBLINGS.has(k));
      if (siblings.length > 0) {
        violations.push({
          rule: 'sibling-keywords',
          file,
          path: jsonPath,
          message: `$ref to core/identifier.json has sibling keyword(s) ${siblings.join(', ')}; ` +
            'draft-07 ANDs siblings with the target, so the node must be a bare $ref',
        });
      }
    }
  }

  function visit(node, file, pointer) {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, file, `${pointer}/${i}`));
      return;
    }
    if (!isPlainObject(node)) return;

    checkNode(node, file, pointer);

    for (const kw of SCHEMA_MAP_KEYWORDS) {
      if (!isPlainObject(node[kw])) continue;
      for (const [name, sub] of Object.entries(node[kw])) {
        visit(sub, file, `${pointer}/${kw}/${escapePointer(name)}`);
      }
    }
    for (const kw of SCHEMA_ARRAY_KEYWORDS) {
      if (Array.isArray(node[kw])) node[kw].forEach((sub, i) => visit(sub, file, `${pointer}/${kw}/${i}`));
    }
    for (const kw of SCHEMA_KEYWORDS) {
      if (node[kw] !== undefined) visit(node[kw], file, `${pointer}/${kw}`);
    }
  }

  for (const [file, doc] of docs) visit(doc, file, '');

  const canonical = docs.get(CANONICAL);
  if (canonical === undefined) {
    violations.push({
      rule: 'canonical-open',
      file: CANONICAL,
      path: '/',
      message: 'canonical identifier record is missing',
    });
  } else if (canonical.additionalProperties !== true) {
    violations.push({
      rule: 'canonical-open',
      file: CANONICAL,
      path: '/additionalProperties',
      message: 'canonical must declare additionalProperties: true explicitly (the open posture is kept explicit ' +
        'so any change to it is a visible diff; revisit when the DR-0019 unknown-key lint lands)',
    });
  }

  for (const [key, reason] of allowed) {
    const bar = key.indexOf('|');
    const file = bar === -1 ? key : key.slice(0, bar);
    const jsonPath = bar === -1 ? '/' : key.slice(bar + 1);
    if (typeof reason !== 'string' || reason.trim() === '') {
      violations.push({ rule: 'allowlist', file, path: jsonPath, message: 'allowlist entry has no reason string' });
    }
    if (!copyKeys.has(key)) {
      violations.push({
        rule: 'allowlist',
        file,
        path: jsonPath,
        message: 'stale allowlist entry: no inline identifier copy at this node; remove the entry',
      });
    }
  }

  violations.sort((a, b) => (a.file + a.path).localeCompare(b.file + b.path));
  return violations;
}

/**
 * Load and lint every schema under schemaDir.
 * @param {string} [schemaDir] Defaults to static/schemas/source.
 * @param {Map<string, string>} [allowed] See lintDocs.
 * @returns {Array<{rule: string, file: string, path: string, message: string}>} violations, including
 *   `malformed-json` for files that fail to parse (those files are not walked).
 */
function lint(schemaDir = SCHEMA_DIR, allowed = ALLOWED) {
  const parseErrors = [];
  const docs = loadSchemas(schemaDir, parseErrors);
  const violations = lintDocs(docs, allowed);
  return [...parseErrors, ...violations].sort((a, b) => (a.file + a.path).localeCompare(b.file + b.path));
}

if (require.main === module) {
  const violations = lint();
  if (violations.length === 0) {
    console.log('✓ inline identifier lint: core/identifier.json is the only identifier record');
    process.exit(0);
  }
  console.error(`✗ inline identifier lint: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}${v.path}`);
    console.error(`    [${v.rule}] ${v.message}`);
  }
  console.error(
    '\nIdentifier items must `$ref` core/identifier.json with no siblings. See #8301.',
  );
  process.exit(1);
}

module.exports = { lint, lintDocs, loadSchemas, refFile, ALLOWED, SCHEMA_DIR, CANONICAL };
