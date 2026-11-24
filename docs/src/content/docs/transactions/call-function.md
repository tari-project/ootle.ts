---
title: callFunction
description: Call a static function on a published template.
---

`callFunction` invokes a static function on a published template — typically used to create new component instances.

## Usage

```ts
import { TransactionBuilder, literalArg, Network, resolveMaxEpoch } from "@tari-project/ootle";

const unsignedTx = TransactionBuilder.new(Network.Esmeralda, await resolveMaxEpoch(provider))
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .callFunction(
    {
      templateAddress: "template_0x…",
      functionName: "new",
    },
    [literalArg("hello"), literalArg("42")],
  )
  .saveVar("component")
  .buildUnsignedTransaction();
```

## Parameters

The first argument is a `TariFunctionDefinition`:

```ts
interface TariFunctionDefinition {
  templateAddress: string; // Published template address
  functionName: string; // Function name (e.g. "new")
}
```

The second argument is an array of `NamedArg` values: either a `Literal` holding an encoded value, or
`{ Workspace: "varName" }` to reference a saved workspace variable.

## Encoding arguments

`literalArg` encodes a value by its JavaScript type: `bigint` as an `Amount`, `string` as text, `boolean`, and
`Uint8Array` as bytes.

```ts
import { literalArg } from "@tari-project/ootle";

literalArg("hello");
literalArg(1000n);
```

Addresses, integers of a specific width, structs, enums, lists and access rules each have their own helper or
builder. See [Encoding arguments](../arguments/).
