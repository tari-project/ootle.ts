---
title: Encoding arguments
description: Encode template arguments, including structs, enums, lists and access rules.
---

Every argument to `callFunction` and `callMethod` is either a workspace reference (`{ Workspace: "name" }`) or a
`Literal`: the hex of the value's CBOR encoding. The helpers below produce literals, so you never write the hex
yourself.

## Simple values

| Rust type                  | Helper                                   |
| -------------------------- | ---------------------------------------- |
| `Amount`                   | `amountLiteral(1000n)`                   |
| `u8` … `u64`, `i8` … `i64` | `intLiteral(42n)`                        |
| `String`                   | `stringLiteral("hello")`                 |
| `bool`                     | `boolLiteral(true)`                      |
| a byte string              | `bytesLiteral(bytes)`                    |
| `RistrettoPublicKeyBytes`  | `publicKeyLiteral(publicKeyHex)`         |
| `Metadata`                 | `metadataLiteral({ name: "Coin" })`      |
| `ResourceAddress`          | `resourceAddressLiteral("resource_…")`   |
| `ComponentAddress`         | `componentAddressLiteral("component_…")` |
| `TemplateAddress`          | `templateAddressLiteral("template_…")`   |
| `VaultId`                  | `vaultIdLiteral("vault_…")`              |
| `NonFungibleAddress`       | `nonFungibleAddressLiteral({ … })`       |
| `Option::None`             | `noneLiteral()`                          |

`Some(value)` is the value's own literal, with nothing around it.

`literalArg(value)` picks a helper from the JavaScript type: `bigint` → `Amount`, `string` → text, `boolean`,
`Uint8Array` → bytes. An address passed to it is encoded as text, which a template rejects: use the address
helpers for addresses.

## Structs, enums and lists

`CborBuilder` builds the arguments that have no helper of their own. It writes the layout templates decode: a
struct is the array of its fields, and an enum value is its variant index with its fields.

Fields are set by index. The index is the `#[n(i)]` attribute on the field in the template's Rust source; it is
not in the template's ABI, so read it from the source.

```rust
// In the template
pub struct Config {
    #[n(0)] pub name: String,
    #[n(1)] pub limits: Vec<u64>,
    #[n(2)] pub max_supply: Option<Amount>,
    #[n(4)] pub mode: Mode,
}

pub enum Mode {
    #[n(0)] Open,
    #[n(1)] Capped { #[n(0)] limit: u64 },
}
```

```ts
import { CborBuilder } from "@tari-project/ootle";

const config = CborBuilder.struct()
  .field(0, "My coin")
  .field(1, CborBuilder.array([10, 20, 30]))
  // field 2 is left unset: Option::None
  .field(4, CborBuilder.variant(1).field(0, 500))
  .finish();

builder.callFunction({ templateAddress, functionName: "new" }, [config]);
```

- `CborBuilder.struct()` — `.field(index, value)`. An unset index below the highest one becomes `None`.
- `CborBuilder.array(items)` — a `Vec` or tuple; `.add(value)` and `.addAll(values)` append. A plain JavaScript
  array works wherever a value is expected.
- `CborBuilder.variant(index)` — an enum value; `.field(index, value)` sets its fields, and a unit variant has
  none. An enum marked `#[cbor(index_only)]` is the bare index instead: pass the number.

Builders nest: pass one as a value to another, and call `finish()` on the outermost only.

A value is a literal from the table above, another builder, or a JavaScript value:

| JavaScript value    | Encoded as                                     |
| ------------------- | ---------------------------------------------- |
| `string`            | text                                           |
| `number` (integer)  | integer                                        |
| `bigint`            | integer, which is also how `Amount` is written |
| `boolean`           | bool                                           |
| `Uint8Array`        | a byte string                                  |
| `null`, `undefined` | `Option::None`                                 |
| array               | `Vec` of its encoded elements                  |

A string is always text, so an address inside a struct still needs its helper:
`.field(0, resourceAddressLiteral("resource_…"))`.

## Access rules

`AccessRuleBuilder` builds an `AccessRule`, the way the Rust `rule!` macro does.

```ts
import { AccessRuleBuilder, requirement } from "@tari-project/ootle";

// Signed by one key
AccessRuleBuilder.publicKey(publicKeyHex);

// Either of two keys
AccessRuleBuilder.mOfN(1, requirement.publicKey(keyA), requirement.publicKey(keyB));

// A key, or anyone holding a badge resource
AccessRuleBuilder.anyOf(requirement.publicKey(keyA), requirement.resource("resource_…"));

// Combine two rules
AccessRuleBuilder.publicKey(keyA).and(AccessRuleBuilder.resource("resource_…"));
```

`requirement` has one function per kind of condition: `publicKey`, `resource`, `nonFungible`, `scopedToComponent`,
`scopedToTemplate`, `callerComponent` and `directCallerTemplate`. `anyOf` and `allOf` also take nested builders.

A builder ends in one of two ways:

- `.toLiteral()` — the encoded argument, for a template function that takes an `AccessRule`. A builder can also
  be passed straight to a `CborBuilder` field.
- `.build()` — the rule as a plain object, for the instructions that take rules directly.

```ts
// As a template argument, inside a struct
const roles = CborBuilder.struct()
  .field(0, AccessRuleBuilder.mOfN(1, requirement.publicKey(keyA), requirement.publicKey(keyB)))
  .finish();

// As an instruction: no encoding involved
builder.setComponentAccessRules(component, {
  method_access: { mint: AccessRuleBuilder.publicKey(minterKey).build() },
  default: "DenyAll",
});
builder.setComponentOwnerRule(component, { ByAccessRule: AccessRuleBuilder.publicKey(ownerKey).build() });
```

Both reject a rule the network refuses to store, before anything is signed: an empty `anyOf` or `allOf`, and an
`mOfN` whose count is zero, exceeds its requirements, or lists a requirement twice.

If you already have a rule object, `accessRuleLiteral(rule)` encodes it, and `publicKeyAccessRule(publicKey)` is
the object form of `AccessRuleBuilder.publicKey(publicKey).build()`.
