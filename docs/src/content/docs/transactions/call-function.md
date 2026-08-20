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

The second argument is an array of `NamedArg` values — either `{ Literal: string }` for raw values or `{ Workspace: "varName" }` to reference a saved workspace variable.

## literalArg helper

The `literalArg` helper wraps a value as `{ Literal: string }`:

```ts
import { literalArg } from "@tari-project/ootle";

literalArg("hello"); // { Literal: "hello" }
literalArg(1000n); // { Literal: "1000" }
```
