---
title: Transaction Builder
description: Compose transaction instructions with a fluent API.
---

`TransactionBuilder` is a fluent, chainable API for constructing `UnsignedTransactionV1` objects. Instructions are appended in order and executed as a single batch on-chain.

## Create a builder

```ts
import { TransactionBuilder, Network } from "@tari-project/ootle";

const builder = TransactionBuilder.new(Network.Esmeralda);
```

## Build a transaction

A typical transaction: withdraw tokens from one account and deposit them into another.

```ts
const unsignedTx = TransactionBuilder.new(Network.Esmeralda)
  .feeTransactionPayFromComponent(accountAddress, 1000n)
  .callMethod({ componentAddress: accountAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "500" },
  ])
  .saveVar("bucket")
  .callMethod({ componentAddress: recipientAddress, methodName: "deposit" }, [{ Workspace: "bucket" }])
  .buildUnsignedTransaction();
```

## Method reference

| Method                                                    | Description                          |
| --------------------------------------------------------- | ------------------------------------ |
| `callFunction(func, args)`                                | Call a static function on a template |
| `callMethod(method, args)`                                | Call a method on a component         |
| `createAccount(ownerPublicKey)`                           | Create a new account component       |
| `createProof(account, resource)`                          | Create a resource proof              |
| `claimBurn(claim, outputData)`                            | Claim a Minotari burn                |
| `saveVar(name)`                                           | Save last output to workspace        |
| `feeTransactionPayFromComponent(addr, amount)`            | Add fee instruction                  |
| `feeTransactionPayFromComponentConfidential(addr, proof)` | Confidential fee                     |
| `allocateAddress(type, name)`                             | Pre-allocate an address              |
| `addInput(req)` / `withInputs(reqs)`                      | Add substate inputs                  |
| `withMinEpoch(n)` / `withMaxEpoch(n)`                     | Set epoch bounds                     |
| `withInstructions(instructions)`                          | Append raw instructions              |
| `withFeeInstructions(instructions)`                       | Append raw fee instructions          |
| `dropAllProofsInWorkspace()`                              | Drop all proofs                      |
| `buildUnsignedTransaction()`                              | Return the finished unsigned tx      |

## Mutable builder pattern

All methods return `this`, so you can chain calls. The builder mutates its internal state — each call appends to the same instruction list:

```ts
// These are equivalent:
const tx1 = builder.callMethod(a, argsA).callMethod(b, argsB).buildUnsignedTransaction();

builder.callMethod(a, argsA);
builder.callMethod(b, argsB);
const tx2 = builder.buildUnsignedTransaction();
```
