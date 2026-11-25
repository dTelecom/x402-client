/**
 * DtelecomGateway + incentivRail end to end against a mocked gateway, Incentiv RPC and bundler.
 * No network access: global fetch answers every call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData, encodeFunctionResult, recoverMessageAddress, recoverTransactionAddress, type Abi, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DtelecomGateway, PaymentError } from "../src/index.js";
import {
  incentivRail, incentivPaymentAddress, INCENTIV_MAINNET as M, INCENTIV_EOA_SCHEME, INCENTIV_USEROP_SCHEME, INCENTIV_NETWORK,
} from "../src/incentiv/index.js";
import { accountFactoryAbi, entryPointAbi, erc20Abi, paymasterAbi, quoterAbi } from "../src/incentiv/abi.js";
import { decodeEoaPayment, decodePaymentOp } from "../src/incentiv/decode.js";
import { computeUserOpHash, type UserOp } from "../src/incentiv/userop.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const GATEWAY = "https://gateway.test";
const SMART = "0x5555555555555555555555555555555555555555";
const PAY_TO = "0x00000000000000000000000000000000000000A1";
const AMOUNT = "1000000";

const requirements = [
  { scheme: INCENTIV_EOA_SCHEME, network: INCENTIV_NETWORK, amount: AMOUNT, asset: M.usdc, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { paymentFlow: "upfront" } },
  { scheme: INCENTIV_USEROP_SCHEME, network: INCENTIV_NETWORK, amount: AMOUNT, asset: M.usdc, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: { entryPoint: M.entryPoint, paymentFlow: "upfront" } },
];
const challenge = { x402Version: 2, error: "Payment Required", resource: { url: `${GATEWAY}/v1/credits/purchase/incentiv`, description: "", mimeType: "application/json" }, accepts: requirements };

interface State {
  pendingNonce: number;
  quoteOut: bigint;
  /** Replies to paid gateway requests, in order; then 200. */
  paid: Response[];
  signatures: string[];
  bodies: unknown[];
}
let state: State;

const reads: Record<string, Abi> = {
  [M.accountFactory.toLowerCase()]: accountFactoryAbi,
  [M.entryPoint.toLowerCase()]: entryPointAbi,
  [M.paymaster.toLowerCase()]: paymasterAbi,
  [M.quoter.toLowerCase()]: quoterAbi,
  [M.usdc.toLowerCase()]: erc20Abi,
};
const paymasterValues: Record<string, unknown> = {
  gasEstimateCoefficient: 12_000n, usdcToken: M.usdc, usdcPoolFee: 3000, minPaymentUsdc: 10_000n,
  minTransactionGas: 100_000n, maxVerificationGas: 1_000_000n,
};

function ethCall(to: string, data: Hex): Hex {
  const abi = reads[to.toLowerCase()];
  if (!abi) throw new Error(`unexpected eth_call to ${to}`);
  const { functionName } = decodeFunctionData({ abi, data });
  const result = (() => {
    switch (functionName) {
      case "getAddress": return SMART;
      case "getNonce": return 7n;
      case "balanceOf": return to.toLowerCase() === M.entryPoint.toLowerCase() ? 10n ** 20n : 5_000_000n;
      case "quoteExactOutputSingle": return [20_000n, 0n, 0, 0n];
      case "quoteExactInputSingle": return [state.quoteOut, 0n, 0, 0n];
      default: return paymasterValues[functionName as string];
    }
  })();
  return encodeFunctionResult({ abi, functionName, result } as never);
}

function rpcResult(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId": return "0x5e25";
    case "eth_getTransactionCount": return params[1] === "pending" ? `0x${state.pendingNonce.toString(16)}` : "0x3";
    case "eth_estimateGas": return "0xc350"; // 50,000
    case "eth_getBlockByNumber": return { number: "0x10", hash: `0x${"11".repeat(32)}`, baseFeePerGas: "0x9184e72a000", timestamp: "0x1", transactions: [] };
    case "eth_getCode": return "0x";
    case "eth_getBalance": return "0x0";
    case "eth_call": { const [call] = params as [{ to: string; data?: Hex; input?: Hex }]; return ethCall(call.to, (call.data ?? call.input)!); }
    case "eth_estimateUserOperationGas": return { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350" };
    default: throw new Error(`unexpected RPC ${method}`);
  }
}

beforeEach(() => {
  state = { pendingNonce: 3, quoteOut: 10n ** 30n, paid: [], signatures: [], bodies: [] };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    const body = typeof raw === "string" ? JSON.parse(raw) : undefined;
    if (url.startsWith(GATEWAY)) {
      const headers = new Headers(init?.headers);
      state.bodies.push(body);
      const signature = headers.get("PAYMENT-SIGNATURE");
      if (!signature) {
        return new Response(JSON.stringify(challenge), { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(challenge)).toString("base64") } });
      }
      state.signatures.push(signature);
      return state.paid.shift() ?? Response.json({ account_id: "acct", credited_microcredits: AMOUNT, amount_usd: 1, incentiv_tx_hash: `0x${"ab".repeat(32)}` });
    }
    const calls = Array.isArray(body) ? body : [body];
    const results = calls.map((c: { id: number; method: string; params: unknown[] }) => ({ jsonrpc: "2.0", id: c.id, result: rpcResult(c.method, c.params) }));
    return Response.json(Array.isArray(body) ? results : results[0]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

function decodedPayload(i = 0) {
  return JSON.parse(Buffer.from(state.signatures[i]!, "base64").toString()) as { accepted: { scheme: string }; payload: Record<string, any> };
}

function opFromWire(w: Record<string, string>): UserOp {
  const big = (k: string) => BigInt(w[k]!);
  return {
    sender: w.sender as Hex, nonce: big("nonce"), callData: w.callData as Hex,
    callGasLimit: big("callGasLimit"), verificationGasLimit: big("verificationGasLimit"), preVerificationGas: big("preVerificationGas"),
    maxFeePerGas: big("maxFeePerGas"), maxPriorityFeePerGas: big("maxPriorityFeePerGas"), signature: w.signature as Hex,
    ...(w.factory ? { factory: w.factory as Hex, factoryData: w.factoryData as Hex } : {}),
    ...(w.paymaster ? { paymaster: w.paymaster as Hex, paymasterVerificationGasLimit: big("paymasterVerificationGasLimit"),
      paymasterPostOpGasLimit: big("paymasterPostOpGasLimit"), paymasterData: w.paymasterData as Hex } : {}),
  };
}

const gateway = (wallet?: "eoa" | "smart-usdc" | "smart-cent", extra: Record<string, bigint> = {}) =>
  new DtelecomGateway({ gatewayUrl: GATEWAY, account, paymentRail: incentivRail({ wallet, ...extra }) });

describe("incentivRail", () => {
  it("pays from the standard wallet with a signed USDC transfer and credits the gateway account", async () => {
    const result = await gateway("eoa").buyCredits({ amountUsd: 1 });
    expect(result).toEqual({ accountId: "acct", creditedMicrocredits: AMOUNT, amountUsd: 1, transaction: `0x${"ab".repeat(32)}` });
    expect(state.bodies[0]).toEqual({ wallet_address: account.address, wallet_chain: "evm", amount_usd: 1 });
    const p = decodedPayload();
    expect(p.accepted.scheme).toBe(INCENTIV_EOA_SCHEME);
    const raw = p.payload.signedTransaction as Hex;
    expect(await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toBe(account.address);
    const decoded = decodeEoaPayment(raw, M.chainId);
    expect(decoded).toMatchObject({ token: M.usdc, to: PAY_TO, amount: 1_000_000n, nonce: 3, gas: 60_000n });
    expect(decoded.validUntil - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
  });

  it("refuses to sign while the wallet has a pending transaction", async () => {
    state.pendingNonce = 4;
    await expect(gateway("eoa").buyCredits({ amountUsd: 1 })).rejects.toThrow(/pending transaction/);
    expect(state.signatures).toEqual([]);
  });

  it("pays from the smart account with USDC gas, deploying it on the first payment", async () => {
    await gateway("smart-usdc").buyCredits({ amountUsd: 1 });
    const p = decodedPayload();
    expect(p.accepted.scheme).toBe(INCENTIV_USEROP_SCHEME);
    const op = opFromWire(p.payload.userOperation);
    expect(op.sender).toBe(SMART);
    expect(op.factory).toBe(M.accountFactory);
    expect(op.paymaster).toBe(M.paymaster);
    const hash = computeUserOpHash(op, M.entryPoint, M.chainId);
    expect(p.payload.userOpHash).toBe(hash);
    expect(await recoverMessageAddress({ message: { raw: hash }, signature: op.signature })).toBe(account.address);
    const decoded = decodePaymentOp(op, M);
    expect(decoded).toMatchObject({ token: M.usdc, to: PAY_TO, amount: 1_000_000n });
    expect(decoded.gasFee).toBeGreaterThan(0n);
    expect(decoded.gasFee).toBeLessThanOrEqual(250_000n);
  });

  it("pays from the smart account with CENT gas and no paymaster", async () => {
    await gateway("smart-cent").buyCredits({ amountUsd: 1 });
    const op = opFromWire(decodedPayload().payload.userOperation);
    expect(op.paymaster).toBeUndefined();
    expect(decodePaymentOp(op, M)).toEqual({ token: M.usdc, to: PAY_TO, amount: 1_000_000n });
  });

  it("refuses a paymaster fee above maxGasFee", async () => {
    await expect(gateway("smart-usdc", { maxGasFee: 1_000n }).buyCredits({ amountUsd: 1 })).rejects.toThrow(/above maxGasFee/);
    expect(state.signatures).toEqual([]);
  });

  it("refuses a CENT gas reservation above maxNativeGasCost", async () => {
    await expect(gateway("smart-cent", { maxNativeGasCost: 1n }).buyCredits({ amountUsd: 1 })).rejects.toThrow(/above maxNativeGasCost/);
  });

  it("resends the same signed payment while settlement is pending", async () => {
    state.paid.push(
      Response.json({ error: "pending", payment_id: "0x01" }, { status: 503, headers: { "Retry-After": "1" } }),
      Response.json({ error: "payment already being processed" }, { status: 409, headers: { "Retry-After": "1" } }),
    );
    await gateway("eoa").buyCredits({ amountUsd: 1 });
    expect(state.signatures).toHaveLength(3);
    expect(new Set(state.signatures).size).toBe(1);
  });

  it("reports a rejected payment without paying again", async () => {
    state.paid.push(Response.json({ error: "settle failed", errorReason: "insufficient_funds" }, { status: 402 }));
    const err = await gateway("eoa").buyCredits({ amountUsd: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err.message).toMatch(/insufficient_funds/);
    expect(state.signatures).toHaveLength(1);
  });

  it("does not retry a payment that needs reconciliation", async () => {
    state.paid.push(Response.json({ error: "Payment requires reconciliation; do not submit a new payment", payment_id: "0x02" }, { status: 503 }));
    await expect(gateway("eoa").buyCredits({ amountUsd: 1 })).rejects.toThrow(/reconciliation.*payment_id 0x02/);
    expect(state.signatures).toHaveLength(1);
  });

  it("requires an EVM account", () => {
    expect(() => new DtelecomGateway({ solanaAccount: { address: "So1", signMessages: async () => [] } as never, paymentRail: incentivRail() }))
      .toThrow(/requires an EVM account/);
  });

  it("names the address to fund for each wallet type", async () => {
    expect(await incentivPaymentAddress(account.address)).toBe(account.address);
    expect(await incentivPaymentAddress(account.address, { wallet: "smart-usdc" })).toBe(SMART);
  });
});

describe("spend cap (real @x402 client)", () => {
  const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const baseChallenge = (amount: string) => ({
    x402Version: 2, error: "Payment Required", resource: { url: `${GATEWAY}/v1/credits/purchase`, description: "", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount, asset: BASE_USDC, payTo: PAY_TO, maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" } }],
  });
  function serveBase(amount: string) {
    const real = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${GATEWAY}/v1/credits/purchase`) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const sig = headers.get("PAYMENT-SIGNATURE");
        if (!sig) {
          const c = baseChallenge(amount);
          return new Response(JSON.stringify(c), { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(c)).toString("base64") } });
        }
        state.signatures.push(sig);
        return Response.json({ account_id: "acct", credited_microcredits: amount, amount_usd: Number(amount) / 1e6 });
      }
      return real(input, init);
    });
  }

  it("pays a Base purchase above $1 (x402 2.x caps payments at $1 by default)", async () => {
    serveBase("5000000");
    const r = await new DtelecomGateway({ gatewayUrl: GATEWAY, account }).buyCredits({ amountUsd: 5 });
    expect(r.creditedMicrocredits).toBe("5000000");
    expect(state.signatures).toHaveLength(1);
  });

  it("refuses a Base quote above the requested amount", async () => {
    serveBase("6000000");
    await expect(new DtelecomGateway({ gatewayUrl: GATEWAY, account }).buyCredits({ amountUsd: 5 })).rejects.toThrow(/spendControls|maxAmountPerPayment/);
    expect(state.signatures).toEqual([]);
  });

  it("refuses an Incentiv quote above the requested amount", async () => {
    await expect(gateway("eoa").buyCredits({ amountUsd: 0.5 })).rejects.toThrow(/spendControls|maxAmountPerPayment/);
    expect(state.signatures).toEqual([]);
  });
});
