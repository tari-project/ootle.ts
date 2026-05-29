//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type { Amount, ComponentAddress, ResourceAddress } from "@tari-project/ootle-ts-bindings";
import { TransactionBuilder } from "@tari-project/ootle";
import { amountLiteralHex, resourceAddressLiteralHex } from "@tari-project/example-common";

/**
 * Append a public-transfer-to-new-recipient sequence onto `builder`:
 *
 *   1. `withdraw(resource, amount)` on `sourceAccount` → returns a bucket
 *   2. `saveVar(bucket_label)`
 *   3. `create_account(recipientOwnerPkHex, bucketWorkspaceLabel = bucket_label)`
 *
 * The `bucket_label` must be unique per call — pass a different `label` per
 * recipient. Use this when the recipient does NOT yet have an on-chain
 * component; for existing accounts use `AccountInvokeBuilder.publicTransfer`.
 */
export function appendPublicTransferToNew(
  builder: TransactionBuilder,
  sourceAccount: ComponentAddress,
  resource: ResourceAddress,
  amount: Amount,
  recipientOwnerPublicKeyHex: string,
  label: string,
): TransactionBuilder {
  return builder
    .callMethod({ componentAddress: sourceAccount, methodName: "withdraw" }, [
      { Literal: resourceAddressLiteralHex(resource) },
      { Literal: amountLiteralHex(amount) },
    ])
    .saveVar(label)
    .createAccount(recipientOwnerPublicKeyHex, label);
}
