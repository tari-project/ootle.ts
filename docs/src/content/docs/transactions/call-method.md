---
title: callMethod
description: Call a method on an existing component.
---

`callMethod` invokes a method on an existing on-chain component — for example, withdrawing tokens from an account or depositing into a vault.

## By component address

```ts
builder.callMethod(
  {
    componentAddress: accountAddress,
    methodName: "withdraw",
  },
  [{ Literal: resourceAddress }, { Literal: "500" }],
);
```

## By workspace reference

If the component was created earlier in the same transaction and saved with `saveVar`, you can reference it by workspace name:

```ts
builder
  .callFunction({ templateAddress, functionName: "new" }, [literalArg("init")])
  .saveVar("component")
  .callMethod(
    {
      fromWorkspace: "component",
      methodName: "do_something",
    },
    [{ Literal: "arg1" }],
  );
```

## Parameters

The first argument is a `TariMethodDefinition`:

```ts
interface TariMethodDefinition {
  methodName: string;
  componentAddress?: string; // Call by address
  fromWorkspace?: string; // Call by workspace key (mutually exclusive)
}
```

One of `componentAddress` or `fromWorkspace` must be provided. The builder throws if neither is set.
