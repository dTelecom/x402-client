// Ported from IncentivNetwork/incentiv-x402-public @ 4e3feeec41c88130100b25467c850e168dd771fe
// (src/decode.ts and src/eoa.ts, client-side subset). Copyright (c) 2026 Incentiv, MIT License —
// see THIRD_PARTY_NOTICES.md.
//
// Clients decode exactly what they are about to sign and compare it with the 402 before signing.
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  isAddress,
  isAddressEqual,
  parseTransaction,
  serializeTransaction,
  type Address,
  type Hex,
  type TransactionSerializableEIP1559,
} from "viem";
import { accountAbi, erc20Abi } from "./abi.js";
import { MAX_EOA_GAS, type IncentivConfig } from "./constants.js";
import { encodeExecuteBatch, type Call, type UserOp } from "./userop.js";

/** A payment this client refuses to sign; `reason` is the matching x402 reason code. */
export class IncentivPaymentError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = "IncentivPaymentError";
  }
}

export interface DecodedTransfer {
  token: Address;
  to: Address;
  amount: bigint;
}

function decodeTransfer(call: Call, what: string): DecodedTransfer {
  if (call.value !== 0n) throw new IncentivPaymentError("invalid_payload", `${what} call sends native value`);
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: erc20Abi, data: call.data });
  } catch {
    throw new IncentivPaymentError("invalid_payload", `${what} call is not an ERC-20 call`);
  }
  if (decoded.functionName !== "transfer") throw new IncentivPaymentError("invalid_payload", `${what} call is not a transfer`);
  const [to, amount] = decoded.args as readonly [Address, bigint];
  // A canonical encoding only: a lenient decode must not hide bytes the token could read differently.
  if (encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }).toLowerCase() !== call.data.toLowerCase()) {
    throw new IncentivPaymentError("invalid_payload", `${what} call data is not canonical`);
  }
  return { token: getAddress(call.to), to: getAddress(to), amount };
}

export interface DecodedUserOpPayment extends DecodedTransfer {
  /** The gas payment to the paymaster, when the operation uses it. */
  gasFee?: bigint;
}

/** Decode a payment operation: an optional gas transfer to the paymaster, then one transfer to the merchant. */
export function decodePaymentOp(op: UserOp, cfg: IncentivConfig): DecodedUserOpPayment {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: accountAbi, data: op.callData });
  } catch {
    throw new IncentivPaymentError("invalid_payload", "callData is not an account call");
  }
  if (decoded.functionName !== "executeBatch") throw new IncentivPaymentError("invalid_payload", "callData is not executeBatch");
  const [dest, value, func] = decoded.args as readonly [readonly Address[], readonly bigint[], readonly Hex[]];
  const calls: Call[] = dest.map((to, i) => ({ to, value: value[i]!, data: func[i]! }));
  if (encodeExecuteBatch(calls).toLowerCase() !== op.callData.toLowerCase()) {
    throw new IncentivPaymentError("invalid_payload", "callData is not canonical");
  }

  if (op.paymaster) {
    if (!isAddressEqual(op.paymaster, cfg.paymaster)) throw new IncentivPaymentError("invalid_payload", "unexpected paymaster");
    if (op.paymasterData && op.paymasterData !== "0x") throw new IncentivPaymentError("invalid_payload", "paymasterData must be empty");
    if (calls.length !== 2) throw new IncentivPaymentError("invalid_payload", "expected a gas transfer and one payment");
    const gas = decodeTransfer(calls[0]!, "gas");
    if (!isAddressEqual(gas.to, cfg.paymaster)) throw new IncentivPaymentError("invalid_payload", "gas transfer does not go to the paymaster");
    const pay = decodeTransfer(calls[1]!, "payment");
    if (!isAddressEqual(gas.token, pay.token)) throw new IncentivPaymentError("invalid_payload", "gas is paid in a different token than the payment");
    return { ...pay, gasFee: gas.amount };
  }
  if (calls.length !== 1) throw new IncentivPaymentError("invalid_payload", "expected exactly one payment");
  return decodeTransfer(calls[0]!, "payment");
}

/** Confirm a decoded payment is the one the 402 asked for. */
export function checkPaysRequirements(decoded: DecodedTransfer, req: { asset: string; payTo: string; amount: string }): void {
  if (!isAddressEqual(decoded.token, req.asset as Address)) {
    throw new IncentivPaymentError("asset_mismatch", `pays ${decoded.token}, the 402 asked for ${req.asset}`);
  }
  if (typeof req.payTo !== "string" || !isAddress(req.payTo, { strict: false }) || !isAddressEqual(decoded.to, req.payTo as Address)) {
    throw new IncentivPaymentError("payto_mismatch", `pays ${decoded.to}, the 402 asked for ${req.payTo}`);
  }
  if (decoded.amount !== BigInt(req.amount)) {
    throw new IncentivPaymentError("amount_mismatch", `pays ${decoded.amount}, the 402 asked for ${req.amount}`);
  }
}

// --- Standard wallet (incentiv-eoa-tx) ---------------------------------------

const MARKER_PREFIX = "78343032"; // "x402"

/** The access-list address that carries the deadline: "x402", validUntil as a uint64, 8 zero bytes (SPEC 3.3). */
export function deadlineMarker(validUntil: number): Address {
  return `0x${MARKER_PREFIX}${BigInt(validUntil).toString(16).padStart(16, "0")}${"0".repeat(16)}`;
}

function readMarker(address: string): number | undefined {
  const m = new RegExp(`^0x${MARKER_PREFIX}([0-9a-f]{16})0{16}$`, "i").exec(address);
  if (!m) return undefined;
  const value = hexToBigInt(`0x${m[1]}`);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined;
}

export interface DecodedEoaPayment extends DecodedTransfer {
  nonce: number;
  gas: bigint;
  validUntil: number;
}

/** Parse and strictly check a signed EIP-1559 USDC transfer that carries a deadline marker. */
export function decodeEoaPayment(raw: Hex, chainId: number): DecodedEoaPayment {
  if (!/^0x02[0-9a-fA-F]+$/.test(raw)) throw new IncentivPaymentError("invalid_payload", "not a raw EIP-1559 (type 2) transaction");
  const t = parseTransaction(raw) as TransactionSerializableEIP1559;
  if (serializeTransaction(t).toLowerCase() !== raw.toLowerCase()) {
    throw new IncentivPaymentError("invalid_payload", "transaction is not canonically encoded");
  }
  if (t.chainId !== chainId) throw new IncentivPaymentError("invalid_payload", `chainId must be ${chainId}`);
  if (!t.to) throw new IncentivPaymentError("invalid_payload", "contract creation is not a payment");
  if (t.value && t.value !== 0n) throw new IncentivPaymentError("invalid_payload", "the transaction sends native value");
  if (t.nonce === undefined || t.gas === undefined) throw new IncentivPaymentError("invalid_payload", "missing nonce or gas");
  if (t.gas > MAX_EOA_GAS) throw new IncentivPaymentError("invalid_payload", `gas limit ${t.gas} is above ${MAX_EOA_GAS}`);
  const list = t.accessList ?? [];
  if (list.length !== 1 || list[0]!.storageKeys.length !== 0) {
    throw new IncentivPaymentError("invalid_payload", "accessList must hold exactly the deadline marker");
  }
  const validUntil = readMarker(list[0]!.address);
  if (validUntil === undefined) throw new IncentivPaymentError("invalid_payload", "accessList entry is not a deadline marker");
  const transfer = decodeTransfer({ to: t.to, value: 0n, data: (t.data ?? "0x") as Hex }, "payment");
  return { ...transfer, nonce: t.nonce, gas: t.gas, validUntil };
}
