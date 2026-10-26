---
"adcontextprotocol": minor
---

Property and placement identifiers now resolve to one definition. `core/identifier.json` is the single record, and the four inline `identifiers` item copies in `core/property.json`, `core/placement.json`, `core/placement-definition.json`, and `core/canonical-placement.json` now `$ref` it (#8301).

**Normative, non-breaking** under DR-0019 (closed row schemas are a deliberate class) and the DR-0009 open default. The record now states an explicit `additionalProperties: true` in place of `false`. The change is two-part, not only that edit:

1. **Loosening at canonical consumers.** Consumers that closed `core/identifier.json` now accept extra keys in an identifier (for example `{type, value, vlaue}`). DR-0019 asks for the unknown-key lint that replaces the closed validation. None exists: identifier items are open by design; the drift guard (`lint-inline-identifier`) prevents divergent copies. Typo detection on those keys is lost until a v4 decision; see a v4 follow-up issue (to be linked).
2. **Hostname rule at four new sites.** The #8289 `domain` / `subdomain` hostname rule now also applies at the four `$ref` sites. It is a widening of the declared 3.3 exception, not a new stable rule: it first shipped in `v3.3.0-beta.0` and is absent from 3.2.7. It fires only for `type: domain` or `subdomain`.

**Dedupe.** Receivers MUST de-duplicate the effective identifier set by exact (type, value); this is newly worded as normative in the placement descriptions. Schema `uniqueItems` rejects only byte-identical entries within one array and does not enforce this rule. A build-time example check covers repo-authored examples only.

**Rejection wording.** The `value` rule that an invalid value MUST cause rejection of the containing request is unchanged. At `get_products` responses, `adagents.json`, and registry events, read "containing request" as the containing response, document, or event.
