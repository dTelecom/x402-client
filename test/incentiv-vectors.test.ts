/**
 * Real Incentiv Mainnet payments (cited in Incentiv's x402 docs) checked against the ported code:
 * our EntryPoint v0.7 hash must reproduce each UserOperationEvent's userOpHash, and our decoders
 * must accept exactly what Incentiv's facilitator settled.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeEventLog, decodeFunctionData, getAddress, keccak256, parseAbi, recoverMessageAddress, slice, hexToBigInt,
  type Address, type Hex,
} from "viem";
import { INCENTIV_MAINNET } from "../src/incentiv/constants.js";
import { decodeEoaPayment, decodePaymentOp } from "../src/incentiv/decode.js";
import { computeUserOpHash, type UserOp } from "../src/incentiv/userop.js";
import { accountFactoryAbi } from "../src/incentiv/abi.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/incentiv-mainnet.json", import.meta.url), "utf8"));
const SELLER_AMOUNT = 10_000n; // 0.01 USDC

const handleOpsAbi = parseAbi([
  "struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }",
  "function handleOps(PackedUserOperation[] ops, address beneficiary)",
]);
const eventAbi = parseAbi([
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);

interface Packed {
  sender: Address; nonce: bigint; initCode: Hex; callData: Hex; accountGasLimits: Hex;
  preVerificationGas: bigint; gasFees: Hex; paymasterAndData: Hex; signature: Hex;
}

/** PackedUserOperation (EntryPoint v0.7 calldata) → the unpacked form the client builds. */
function unpack(p: Packed): UserOp {
  const op: UserOp = {
    sender: p.sender,
    nonce: p.nonce,
    callData: p.callData,
    verificationGasLimit: hexToBigInt(slice(p.accountGasLimits, 0, 16)),
    callGasLimit: hexToBigInt(slice(p.accountGasLimits, 16, 32)),
    preVerificationGas: p.preVerificationGas,
    maxPriorityFeePerGas: hexToBigInt(slice(p.gasFees, 0, 16)),
    maxFeePerGas: hexToBigInt(slice(p.gasFees, 16, 32)),
    signature: p.signature,
  };
  if (p.initCode !== "0x") {
    op.factory = getAddress(slice(p.initCode, 0, 20));
    op.factoryData = slice(p.initCode, 20);
  }
  if (p.paymasterAndData !== "0x") {
    op.paymaster = getAddress(slice(p.paymasterAndData, 0, 20));
    op.paymasterVerificationGasLimit = hexToBigInt(slice(p.paymasterAndData, 20, 36));
    op.paymasterPostOpGasLimit = hexToBigInt(slice(p.paymasterAndData, 36, 52));
    op.paymasterData = p.paymasterAndData.length > 2 + 52 * 2 ? slice(p.paymasterAndData, 52) : "0x";
  }
  return op;
}

function opsAndEvents(name: string) {
  const tx = fixture[name];
  const { args } = decodeFunctionData({ abi: handleOpsAbi, data: tx.input });
  const ops = (args[0] as readonly Packed[]).map(unpack);
  const events = (tx.logs as { address: string; topics: Hex[]; data: Hex }[])
    .filter((l) => l.address.toLowerCase() === INCENTIV_MAINNET.entryPoint.toLowerCase())
    .flatMap((l) => {
      try { return [decodeEventLog({ abi: eventAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data })]; }
      catch { return []; }
    });
  return { ops, events };
}

describe("Incentiv Mainnet vectors", () => {
  it("decodes the standard-wallet payment exactly as settled", () => {
    const { raw, hash } = fixture.eoa1 as { raw: Hex; hash: Hex };
    expect(keccak256(raw)).toBe(hash);
    const decoded = decodeEoaPayment(raw, INCENTIV_MAINNET.chainId);
    expect(decoded.token).toBe(INCENTIV_MAINNET.usdc);
    expect(decoded.amount).toBe(SELLER_AMOUNT);
    expect(decoded.gas).toBeLessThanOrEqual(120_000n);
    expect(decoded.validUntil).toBeGreaterThan(1_790_000_000);
  });

  for (const [name, paymaster] of [["userop_deploy", true], ["userop_usdc", true], ["userop_native", false]] as const) {
    it(`reproduces the userOpHash and decodes the payment: ${name}`, async () => {
      const { ops, events } = opsAndEvents(name);
      expect(ops).toHaveLength(1);
      expect(events).toHaveLength(1);
      const op = ops[0]!;
      const event = events[0]!;
      const hash = computeUserOpHash(op, INCENTIV_MAINNET.entryPoint, INCENTIV_MAINNET.chainId);
      expect(hash).toBe(event.args.userOpHash);
      expect(event.args.success).toBe(true);

      const decoded = decodePaymentOp(op, INCENTIV_MAINNET);
      expect(decoded.token).toBe(INCENTIV_MAINNET.usdc);
      expect(decoded.amount).toBe(SELLER_AMOUNT);
      expect(decoded.gasFee !== undefined).toBe(paymaster);
      expect(op.paymaster !== undefined).toBe(paymaster);

      // The owner's EIP-191 signature over the raw hash authorizes the operation.
      const owner = await recoverMessageAddress({ message: { raw: hash }, signature: op.signature });
      if (op.factory) {
        expect(op.factory).toBe(INCENTIV_MAINNET.accountFactory);
        const { args } = decodeFunctionData({ abi: accountFactoryAbi, data: op.factoryData! });
        expect(args[0]).toBe(owner);
      }
    });
  }
});
