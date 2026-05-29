//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Instantiate-template-and-call-method example.
 *
 * Two modes via env vars:
 *   - Instantiate mode (`OOTLE_TEMPLATE_INSTANTIATE=template_<hex>`): calls
 *     the template's constructor, deposits any returned bucket into the
 *     sender account in the same tx, then reads back a method on the new
 *     component.
 *   - Reuse mode (`OOTLE_TEMPLATE_COMPONENT=component_<hex>`): skips
 *     instantiation and just calls the read method.
 *
 * The script targets templates whose constructor returns a single bucket
 * (admin badge, initial-supply receipt, etc.) and exposes at least one
 * AllowAll-gated read method (e.g. `total_supply`). Templates with
 * admin-proof-gated methods (`increase_supply` / `decrease_supply` etc.)
 * are out of scope: this example does not build a `create_proof` instruction,
 * so such calls would reject with `AccessDenied`.
 *
 * Constructor args (`OOTLE_TEMPLATE_ARGS`) are coerced to typed CBOR literals
 * using the template's declared parameter types (fetched via the indexer), so
 * a `U64` param and an `Amount` param encode differently for the same digits.
 */

import {
  TransactionBuilder,
  amountLiteral,
  boolLiteral,
  componentAddressLiteral,
  getVaultIdsForAccount,
  intLiteral,
  resourceAddressLiteral,
  stringLiteral,
} from "@tari-project/ootle";
import type {
  ComponentAddress,
  InstructionArg,
  PublishedTemplateAddress,
  TemplateDef,
  Type,
  UnsignedTransactionV1,
} from "@tari-project/ootle-ts-bindings";
import { IndexerProvider } from "@tari-project/ootle-indexer";
import {
  NETWORK,
  classifyDryRun,
  dryRun,
  faucetAndWait,
  firstNewSubstate,
  indexerUrl,
  newWallet,
  runScript,
  signAndSubmit,
  wait,
} from "./_common/index.js";
import type { NewWallet } from "./_common/index.js";

const INVOKE_FEE = 5_000n;

await runScript(async () => {
  const mode = resolveMode();
  const url = indexerUrl();
  const provider = await IndexerProvider.connect({ url, network: NETWORK });

  const wallet = await newWallet();
  console.log(`Funding fresh wallet (owner ${wallet.ownerAddress}) ...`);
  const { account: sender } = await faucetAndWait(provider, wallet);
  console.log(`Sender account: ${sender}`);

  const component =
    mode.kind === "instantiate" ? await instantiateTemplate(provider, wallet, sender, mode) : mode.component;
  console.log(`\nTarget component: ${component}`);

  const readReceipt = await callRead(provider, wallet, sender, component, mode.readMethod);
  console.log(`\nMethod ${mode.readMethod}() returned:\n${JSON.stringify(readReceipt, null, 2)}`);

  return { provider };
});

interface InstantiateMode {
  kind: "instantiate";
  template: PublishedTemplateAddress;
  functionName: string;
  constructorArgs: string[];
  readMethod: string;
}

interface ReuseMode {
  kind: "reuse";
  component: ComponentAddress;
  readMethod: string;
}

type Mode = InstantiateMode | ReuseMode;

function resolveMode(): Mode {
  const readMethod = process.env.OOTLE_TEMPLATE_READ_METHOD ?? "total_supply";
  const reuse = process.env.OOTLE_TEMPLATE_COMPONENT;
  const instantiate = process.env.OOTLE_TEMPLATE_INSTANTIATE;
  if (reuse && instantiate) {
    throw new Error(
      "Set exactly one of OOTLE_TEMPLATE_COMPONENT (reuse mode) or OOTLE_TEMPLATE_INSTANTIATE (instantiate mode), not both.",
    );
  }
  if (reuse) {
    if (!reuse.startsWith("component_")) {
      throw new Error(`OOTLE_TEMPLATE_COMPONENT must start with 'component_' (got '${reuse}')`);
    }
    return { kind: "reuse", component: reuse as ComponentAddress, readMethod };
  }
  if (instantiate) {
    if (!instantiate.startsWith("template_")) {
      throw new Error(`OOTLE_TEMPLATE_INSTANTIATE must start with 'template_' (got '${instantiate}')`);
    }
    return {
      kind: "instantiate",
      template: instantiate as PublishedTemplateAddress,
      functionName: process.env.OOTLE_TEMPLATE_FUNCTION ?? "instantiate",
      constructorArgs: parseArgs(process.env.OOTLE_TEMPLATE_ARGS),
      readMethod,
    };
  }
  throw new Error(
    "Either OOTLE_TEMPLATE_INSTANTIATE=<template_…> or OOTLE_TEMPLATE_COMPONENT=<component_…> is required.",
  );
}

function parseArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const INTEGER_TYPES = new Set<Type>(["U8", "U16", "U32", "U64", "U128", "I8", "I16", "I32", "I64", "I128"]);

/**
 * Coerce a raw CLI string to a typed CBOR `Literal` using the constructor's
 * declared parameter type. The type is what distinguishes a plain integer
 * (`intLiteral`) from the `Amount` type (`amountLiteral`) — string-shape
 * guessing cannot, so this requires the template ABI.
 */
function coerceArg(raw: string, type: Type): InstructionArg {
  if (typeof type === "string") {
    if (type === "Bool") return boolLiteral(parseBool(raw));
    if (type === "String") return stringLiteral(raw);
    if (INTEGER_TYPES.has(type)) return intLiteral(BigInt(raw));
    throw new Error(`Constructor arg type '${type}' is not supported by this example`);
  }
  if ("Other" in type) {
    switch (type.Other.name) {
      case "Amount":
        return amountLiteral(BigInt(raw));
      case "ResourceAddress":
        return resourceAddressLiteral(raw);
      case "ComponentAddress":
        return componentAddressLiteral(raw);
      default:
        throw new Error(`Constructor arg type 'Other(${type.Other.name})' is not supported by this example`);
    }
  }
  throw new Error(`Constructor arg type ${JSON.stringify(type)} is not supported by this example`);
}

function parseBool(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Expected 'true' or 'false' for a Bool arg, got '${raw}'`);
}

/** Look up the named function's declared parameter types in the template definition. */
function functionArgTypes(definition: TemplateDef, functionName: string): Type[] {
  const fn = definition.V1.functions.find((f) => f.name === functionName);
  if (!fn) {
    throw new Error(`Template has no function '${functionName}'`);
  }
  return fn.arguments.map((a) => a.arg_type);
}

async function instantiateTemplate(
  provider: IndexerProvider,
  wallet: NewWallet,
  sender: ComponentAddress,
  mode: InstantiateMode,
): Promise<ComponentAddress> {
  console.log(`\nInstantiating ${mode.template}.${mode.functionName}(${mode.constructorArgs.join(", ")}) ...`);
  const senderVaults = await getVaultIdsForAccount(provider, sender);
  // The indexer's template lookup wants the bare Hash32, not the `template_` prefix.
  const { definition } = await provider.getTemplateDefinition(mode.template.replace(/^template_/, ""));
  const argTypes = functionArgTypes(definition, mode.functionName);
  if (argTypes.length !== mode.constructorArgs.length) {
    throw new Error(`${mode.functionName} expects ${argTypes.length} arg(s), got ${mode.constructorArgs.length}`);
  }
  const args = mode.constructorArgs.map((raw, i) => coerceArg(raw, argTypes[i]));
  const unsigned = new TransactionBuilder(NETWORK)
    .withInputs([
      { substate_id: sender, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
    ])
    .feeTransactionPayFromComponent(sender, INVOKE_FEE)
    .callFunction({ templateAddress: mode.template, functionName: mode.functionName }, args)
    .saveVar("badge")
    .callMethod({ componentAddress: sender, methodName: "deposit" }, [{ Workspace: "badge" }])
    .buildUnsignedTransaction();

  await dryRunOrThrow(unsigned, wallet, "instantiate");
  const pending = await signAndSubmit(provider, unsigned, [wallet.secret]);
  await wait("instantiate", pending);
  const receipt = await pending.getReceipt();
  const component = firstNewSubstate(receipt, "component_", { exclude: new Set([sender]) });
  if (component === null) {
    throw new Error("Instantiate committed but no new component substate appeared in the receipt diff");
  }
  return component;
}

async function callRead(
  provider: IndexerProvider,
  wallet: NewWallet,
  sender: ComponentAddress,
  component: ComponentAddress,
  methodName: string,
): Promise<unknown> {
  const senderVaults = await getVaultIdsForAccount(provider, sender);
  const unsigned = new TransactionBuilder(NETWORK)
    .withInputs([
      { substate_id: sender, version: null },
      ...senderVaults.map((v) => ({ substate_id: v, version: null })),
      { substate_id: component, version: null },
    ])
    .feeTransactionPayFromComponent(sender, INVOKE_FEE)
    .callMethod({ componentAddress: component, methodName }, [])
    .buildUnsignedTransaction();

  await dryRunOrThrow(unsigned, wallet, `read:${methodName}`);
  const pending = await signAndSubmit(provider, unsigned, [wallet.secret]);
  await wait(`read:${methodName}`, pending);
  return pending.getReceipt();
}

async function dryRunOrThrow(unsigned: UnsignedTransactionV1, wallet: NewWallet, label: string): Promise<void> {
  const result = await dryRun(unsigned, [wallet.secret]);
  const outcome = classifyDryRun(result);
  if (outcome.outcome !== "Commit") {
    throw new Error(`[${label}] dry run did not commit: ${JSON.stringify(outcome)}`);
  }
  const fee = result.result.finalize.fee_receipt?.total_fees_paid ?? "<unknown>";
  console.log(`  [${label}] dry-run OK, estimated fee: ${fee}`);
}
