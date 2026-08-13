---
title: Fees
description: Specify how transaction fees are paid.
---

Every transaction requires a fee. Fee instructions are separate from regular instructions — they run in a distinct execution context.

## Pay from a component

The most common approach: call `pay_fee` on a component (typically your account).

```ts
builder.feeTransactionPayFromComponent(accountAddress, 1000n);
```

Under the hood, this adds a fee instruction that calls the `pay_fee` method on the component:

```ts
// Equivalent to:
builder.addFeeInstruction({
  CallMethod: {
    call: { Address: accountAddress },
    method: "pay_fee",
    args: [{ Literal: "1000" }],
  },
});
```

Use `addFeeInstruction` directly if the fee payment method has a different name.

## Confidential fees

For confidential transactions, use a withdraw proof instead of a plaintext amount:

```ts
builder.feeTransactionPayFromComponentConfidential(accountAddress, proof);
```

## Fee instruction builder

For complex fee instruction sequences, use `withFeeInstructionsBuilder`:

```ts
builder.withFeeInstructionsBuilder((feeBuilder) =>
  feeBuilder
    .callMethod({ componentAddress: accountA, methodName: "pay_fee" }, [{ Literal: "500" }])
    .callMethod({ componentAddress: accountB, methodName: "pay_fee" }, [{ Literal: "500" }]),
);
```
