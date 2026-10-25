---
"adcontextprotocol": minor
---

Make brand identity the domain and account identity the seller's `account_id` (#8280, #8442). A brand is its `domain`, plus `brand_id` where its `brand.json` lists several brands. `brand.countries`, `currency`, `timezone`, `sandbox`, and `operator_unit` are account attributes: they no longer distinguish account identity.

- `sync_accounts`: a provisioning entry without `account` opens an account, and a retry with the same `idempotency_key` returns the original result. Sellers MUST return `account_id`, accept it on every account-scoped task, and never change it. A settings-update entry updates account attributes, `brand.countries` included, on the same account; `brand`, `operator_unit`, `currency`, and `timezone` are now permitted in settings-update mode.
- A natural-key `AccountRef` resolves only when exactly one of the caller's accounts matches; its optional fields narrow the match. Otherwise the seller returns `ACCOUNT_AMBIGUOUS`, listing the candidates in `error.details.available_accounts`.
- `brand-key.json` and `brand-ref.json`: `countries` is an account attribute, and the rule to sort country codes before computing keys is gone. `request_proposals` binds a proposal to the brand and the resolved `account_id`.

**Deprecated in 3.3, planned for removal in 4.0:** the `account.identity_updates` capability, `operator_identity` and `destination_billing_entity` on `sync_accounts`, `identity_change` and `identity_change_preview`, the `ACCOUNT_MOVED` and `ACCOUNT_IDENTITY_CONFLICT` error codes, `error-details/account-moved.json`, and `account.stable_account_id`. No wire field is removed.

Compliance: `media_buy_seller/stable_account_id` no longer re-sends a provisioning entry, and `media_buy_seller/account_timezone_buyer_selected` drops the re-sync reconnect phases; both relied on provisioning entries finding an existing account.
