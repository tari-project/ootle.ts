---
title: saveVar / Workspace
description: Pass intermediate results between instructions.
---

Instructions in a transaction execute as a batch. `saveVar` captures an instruction's output so later instructions can reference it.

## saveVar

```ts
builder
  .callMethod({ componentAddress: accountAddress, methodName: "withdraw" }, [
    { Literal: resourceAddress },
    { Literal: "10" },
  ])
  .saveVar("bucket");
```

This saves the result of the `withdraw` call to a workspace variable named `"bucket"`.

## Referencing workspace variables

Use `{ Workspace: "name" }` in any argument position to reference a saved variable:

```ts
builder.callMethod({ componentAddress: accountAddress, methodName: "deposit" }, [{ Workspace: "bucket" }]);
```

The builder resolves string workspace names to numeric IDs internally.

## Accessing tuple fields

Some methods return multiple values. You can address individual fields using `.0`, `.1`, etc.:

```ts
builder
  .callMethod({ componentAddress: poolComponent, methodName: "remove_liquidity" }, [{ Workspace: "tokens_lp" }])
  .saveVar("buckets")
  .callMethod({ componentAddress: accountAddress, methodName: "deposit" }, [{ Workspace: "buckets.0" }])
  .callMethod({ componentAddress: accountAddress, methodName: "deposit" }, [{ Workspace: "buckets.1" }]);
```

## Workspace references in callMethod

You can also call methods on workspace-stored components:

```ts
builder
  .callFunction({ templateAddress, functionName: "new" }, [])
  .saveVar("component")
  .callMethod({ fromWorkspace: "component", methodName: "init" }, [{ Literal: "arg" }]);
```
