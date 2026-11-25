// Ported from IncentivNetwork/incentiv-x402-public @ 4e3feeec41c88130100b25467c850e168dd771fe
// (src/userop.ts, client-side subset: hashing, wire format, gas estimation, paymaster fee).
// Copyright (c) 2026 Incentiv, MIT License — see THIRD_PARTY_NOTICES.md.
import {
  concatHex,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  numberToHex,
  pad,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { accountAbi, accountFactoryAbi, entryPointAbi, erc20Abi, paymasterAbi, quoterAbi } from "./abi.js";
import { ZERO32, type IncentivConfig } from "./constants.js";

// The public RPC rejects clients without a browser-like user agent (browsers send their own).
const USER_AGENT = "Mozilla/5.0 (compatible; dtelecom-x402-client)";

export interface Chain {
  config: IncentivConfig;
  client: PublicClient;
}

export function makeChain(config: IncentivConfig): Chain {
  const transport = http(config.rpcUrl, { timeout: 20_000, fetchOptions: { headers: { "User-Agent": USER_AGENT } } });
  return { config, client: createPublicClient({ transport }) };
}

export interface Call {
  to: Address;
  value: bigint;
  data: Hex;
}

/** ERC-4337 v0.7 user operation in the unpacked bundler wire format. */
export interface UserOp {
  sender: Address;
  nonce: bigint;
  factory?: Address;
  factoryData?: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster?: Address;
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterData?: Hex;
  signature: Hex;
}

export function encodeExecuteBatch(calls: Call[]): Hex {
  return encodeFunctionData({
    abi: accountAbi,
    functionName: "executeBatch",
    args: [calls.map((c) => c.to), calls.map((c) => c.value), calls.map((c) => c.data)],
  });
}

export function transferCall(token: Address, to: Address, amount: bigint): Call {
  return { to: token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }) };
}

function packUint128Pair(high: bigint, low: bigint): Hex {
  return concatHex([pad(numberToHex(high), { size: 16 }), pad(numberToHex(low), { size: 16 })]);
}

function packInitCode(op: UserOp): Hex {
  return op.factory ? concatHex([op.factory, op.factoryData ?? "0x"]) : "0x";
}

function packPaymasterAndData(op: UserOp): Hex {
  if (!op.paymaster) return "0x";
  return concatHex([
    op.paymaster,
    pad(numberToHex(op.paymasterVerificationGasLimit ?? 0n), { size: 16 }),
    pad(numberToHex(op.paymasterPostOpGasLimit ?? 0n), { size: 16 }),
    op.paymasterData ?? "0x",
  ]);
}

/** EntryPoint v0.7 getUserOpHash, computed locally. */
export function computeUserOpHash(op: UserOp, entryPoint: Address, chainId: number): Hex {
  const packedHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" },
        { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [
        op.sender,
        op.nonce,
        keccak256(packInitCode(op)),
        keccak256(op.callData),
        packUint128Pair(op.verificationGasLimit, op.callGasLimit),
        op.preVerificationGas,
        packUint128Pair(op.maxPriorityFeePerGas, op.maxFeePerGas),
        keccak256(packPaymasterAndData(op)),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint256" }], [packedHash, entryPoint, BigInt(chainId)]),
  );
}

export function opToWire(op: UserOp): Record<string, string> {
  const wire: Record<string, string> = {
    sender: op.sender,
    nonce: toHex(op.nonce),
    callData: op.callData,
    callGasLimit: toHex(op.callGasLimit),
    verificationGasLimit: toHex(op.verificationGasLimit),
    preVerificationGas: toHex(op.preVerificationGas),
    maxFeePerGas: toHex(op.maxFeePerGas),
    maxPriorityFeePerGas: toHex(op.maxPriorityFeePerGas),
    signature: op.signature,
  };
  if (op.factory) {
    wire.factory = op.factory;
    wire.factoryData = op.factoryData ?? "0x";
  }
  if (op.paymaster) {
    wire.paymaster = op.paymaster;
    wire.paymasterVerificationGasLimit = toHex(op.paymasterVerificationGasLimit ?? 0n);
    wire.paymasterPostOpGasLimit = toHex(op.paymasterPostOpGasLimit ?? 0n);
    wire.paymasterData = op.paymasterData ?? "0x";
  }
  return wire;
}

/** Estimation only; the client never submits operations (the facilitator does). */
async function bundlerRpc(chain: Chain, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(chain.config.bundlerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: { result?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    body = undefined;
  }
  if (body?.error !== undefined && body?.error !== null) {
    throw new Error(`Bundler error ${String(body.error.code)}: ${String(body.error.message)}`);
  }
  if (!res.ok) throw new Error(`Bundler HTTP ${res.status}`);
  if (typeof body !== "object" || body === null) throw new Error("Bundler answered with invalid JSON");
  return body.result;
}

function asBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" || typeof v === "string") return BigInt(v);
  throw new Error(`Cannot parse gas value: ${String(v)}`);
}

// --- Fees and paymaster ------------------------------------------------------

/** `headroomPercent` is how far above the current base fee the fee cap sits (200 = twice the base fee). */
async function getFees(chain: Chain, headroomPercent: bigint) {
  const block = await chain.client.getBlock();
  const base = block.baseFeePerGas ?? 12_600_000_000_000n;
  const tip = 1_000_000_000n;
  return { maxFeePerGas: (base * headroomPercent) / 100n + tip, maxPriorityFeePerGas: tip };
}

interface PaymasterConfig {
  gasEstimateCoefficient: bigint;
  usdcToken: Address;
  usdcPoolFee: number;
  minPaymentUsdc: bigint;
  minTransactionGas: bigint;
  maxVerificationGas: bigint;
}

async function getPaymasterConfig(chain: Chain): Promise<PaymasterConfig> {
  const read = <T,>(functionName: string) =>
    chain.client.readContract({ address: chain.config.paymaster, abi: paymasterAbi, functionName: functionName as never }) as Promise<T>;
  const [gasEstimateCoefficient, usdcToken, usdcPoolFee, minPaymentUsdc, minTransactionGas, maxVerificationGas] = await Promise.all([
    read<bigint>("gasEstimateCoefficient"),
    read<Address>("usdcToken"),
    read<number>("usdcPoolFee"),
    read<bigint>("minPaymentUsdc"),
    read<bigint>("minTransactionGas"),
    read<bigint>("maxVerificationGas"),
  ]);
  return { gasEstimateCoefficient, usdcToken, usdcPoolFee: Number(usdcPoolFee), minPaymentUsdc, minTransactionGas, maxVerificationGas };
}

function requiredCentFor(
  cfg: PaymasterConfig,
  limits: { callGasLimit: bigint; verificationGasLimit: bigint; preVerificationGas: bigint },
  maxFeePerGas: bigint,
): bigint {
  let ver = limits.verificationGasLimit;
  if (cfg.maxVerificationGas !== 0n && ver > cfg.maxVerificationGas) ver = cfg.maxVerificationGas;
  let totalGas = limits.callGasLimit + ver + limits.preVerificationGas;
  if (totalGas < cfg.minTransactionGas) totalGas = cfg.minTransactionGas;
  return (totalGas * maxFeePerGas * cfg.gasEstimateCoefficient) / 10_000n;
}

/** USDC amount whose WCENT quote satisfies the paymaster's gas check and floor. */
async function usdcGasAmount(chain: Chain, cfg: PaymasterConfig, requiredCent: bigint): Promise<bigint> {
  const quoteIn = async (wcentOut: bigint) =>
    ((await chain.client.readContract({
      address: chain.config.quoter,
      abi: quoterAbi,
      functionName: "quoteExactOutputSingle",
      args: [{ tokenIn: cfg.usdcToken, tokenOut: chain.config.wcent, amount: wcentOut, fee: cfg.usdcPoolFee, sqrtPriceLimitX96: 0n }],
    })) as readonly [bigint, ...unknown[]])[0];
  const quoteOut = async (amountIn: bigint) =>
    ((await chain.client.readContract({
      address: chain.config.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: cfg.usdcToken, tokenOut: chain.config.wcent, amountIn, fee: cfg.usdcPoolFee, sqrtPriceLimitX96: 0n }],
    })) as readonly [bigint, ...unknown[]])[0];
  // The paymaster accepts at least minPaymentUsdc, so start from the floor and check that amount.
  let amount = requiredCent === 0n ? 0n : ((await quoteIn(requiredCent)) * 102n) / 100n;
  if (amount < cfg.minPaymentUsdc) amount = cfg.minPaymentUsdc;
  for (let attempt = 0; requiredCent > 0n; attempt++) {
    if ((await quoteOut(amount)) >= requiredCent) break;
    if (attempt === 5) {
      throw new Error('The USDC/WCENT pool cannot quote a gas fee the paymaster would accept; pay gas in CENT instead (wallet: "smart-cent")');
    }
    const step = amount / 20n; // +5%, and at least 1 so a tiny fee still grows
    amount += step > 0n ? step : 1n;
  }
  return amount;
}

// --- Payment user operation --------------------------------------------------

/** The nonce lane for one payment: a 192-bit key derived from the payment id and deadline (SPEC 4.3.2). */
export function paymentNonceKey(paymentId: Hex, validUntil: number): bigint {
  const digest = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [paymentId, BigInt(validUntil)]));
  return BigInt(digest) >> 64n; // top 192 bits
}

/** The smart account address an owner controls (CREATE2; valid before the account is deployed). */
export function smartAccountAddress(chain: Chain, owner: Address, salt = 0n): Promise<Address> {
  return chain.client.readContract({
    address: chain.config.accountFactory,
    abi: accountFactoryAbi,
    functionName: "getAddress",
    args: [owner, [ZERO32, ZERO32], salt],
  });
}

export interface PrepareOptions {
  account: Address;
  owner: Address;
  salt?: bigint;
  asset: Address;
  payTo: Address;
  amount: bigint;
  paymentId: Hex;
  validUntil: number;
  /** "token" pays gas in USDC through the paymaster; "native" pays it in CENT from the account. */
  gas: "token" | "native";
}

export interface PreparedPayment {
  op: UserOp;
  userOpHash: Hex;
}

/** Build and estimate an unsigned payment operation. */
export async function preparePayment(chain: Chain, o: PrepareOptions): Promise<PreparedPayment> {
  if (o.asset.toLowerCase() !== chain.config.usdc.toLowerCase()) throw new Error("Only USDC payments are supported");
  const code = await chain.client.getCode({ address: o.account });
  const deployed = !!code && code !== "0x";
  let init: { factory?: Address; factoryData?: Hex } = {};
  if (!deployed) {
    const derived = await smartAccountAddress(chain, o.owner, o.salt ?? 0n);
    if (derived.toLowerCase() !== o.account.toLowerCase()) throw new Error(`Owner ${o.owner} controls ${derived}, not ${o.account}.`);
    init = {
      factory: chain.config.accountFactory,
      factoryData: encodeFunctionData({ abi: accountFactoryAbi, functionName: "createAccount", args: [o.owner, [ZERO32, ZERO32], o.salt ?? 0n] }),
    };
  }

  const native = o.gas === "native";
  const key = paymentNonceKey(o.paymentId, o.validUntil);
  const [nonce, fees, cfg] = await Promise.all([
    chain.client.readContract({ address: chain.config.entryPoint, abi: entryPointAbi, functionName: "getNonce", args: [o.account, key] }),
    getFees(chain, native ? 130n : 200n),
    native ? undefined : getPaymasterConfig(chain),
  ]);

  const payment = transferCall(o.asset, o.payTo, o.amount);
  const callsWithFee = (fee: bigint): Call[] => (native ? [payment] : [transferCall(o.asset, chain.config.paymaster, fee), payment]);

  let gasFee = 0n;
  if (!native) {
    const seedCent = requiredCentFor(cfg!, { callGasLimit: 600_000n, verificationGasLimit: 100_000n, preVerificationGas: 100_000n }, fees.maxFeePerGas);
    gasFee = await usdcGasAmount(chain, cfg!, seedCent);
  }

  const op: UserOp = {
    sender: o.account,
    nonce,
    ...init,
    callData: encodeExecuteBatch(callsWithFee(gasFee)),
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    ...(native
      ? {}
      : { paymaster: chain.config.paymaster, paymasterVerificationGasLimit: 500_000n, paymasterPostOpGasLimit: 50_000n, paymasterData: "0x" as Hex }),
    signature: "0x",
  };

  // Estimation needs a well-formed signature; this throwaway key never leaves the function.
  const ephemeral = privateKeyToAccount(generatePrivateKey());
  for (let i = 0; i < (native ? 1 : 2); i++) {
    const est: UserOp = {
      sender: op.sender,
      nonce: op.nonce,
      factory: op.factory,
      factoryData: op.factoryData,
      callData: op.callData,
      callGasLimit: 0n,
      verificationGasLimit: 0n,
      preVerificationGas: 0n,
      maxFeePerGas: op.maxFeePerGas,
      maxPriorityFeePerGas: op.maxPriorityFeePerGas,
      signature: "0x",
    };
    est.signature = await ephemeral.signMessage({ message: { raw: computeUserOpHash(est, chain.config.entryPoint, chain.config.chainId) } });
    const r = (await bundlerRpc(chain, "eth_estimateUserOperationGas", [opToWire(est), chain.config.entryPoint])) as Record<string, unknown>;
    op.callGasLimit = (asBigInt(r.callGasLimit) * 120n) / 100n;
    op.verificationGasLimit = (asBigInt(r.verificationGasLimit ?? r.verificationGas) * 110n) / 100n;
    op.preVerificationGas = (asBigInt(r.preVerificationGas) * 105n) / 100n;
    if (!native) {
      op.paymasterVerificationGasLimit = 300_000n;
      if (cfg!.maxVerificationGas !== 0n && op.verificationGasLimit > cfg!.maxVerificationGas) {
        throw new Error(`The operation needs ${op.verificationGasLimit} verification gas, above the paymaster cap of ${cfg!.maxVerificationGas}.`);
      }
      gasFee = await usdcGasAmount(chain, cfg!, requiredCentFor(cfg!, op, op.maxFeePerGas));
      op.callData = encodeExecuteBatch(callsWithFee(gasFee));
    }
  }
  if (native) {
    // The EntryPoint takes the worst-case gas cost up front, from the account's deposit and balance.
    const needed = requiredPrefund(op);
    const have = await centAvailable(chain, o.account);
    if (have < needed) throw new Error(`The account's CENT (deposit plus balance, ${have}) is below the ${needed} the operation may need for gas.`);
  }

  op.signature = "0x";
  return { op, userOpHash: computeUserOpHash(op, chain.config.entryPoint, chain.config.chainId) };
}

/** The most gas the EntryPoint may charge for an operation: all gas limits at the fee cap. */
export function requiredPrefund(op: UserOp): bigint {
  return (op.callGasLimit + op.verificationGasLimit + op.preVerificationGas + (op.paymasterVerificationGasLimit ?? 0n) + (op.paymasterPostOpGasLimit ?? 0n)) * op.maxFeePerGas;
}

/** CENT an account can spend on gas without a paymaster: its EntryPoint deposit plus its balance. */
export async function centAvailable(chain: Chain, account: Address): Promise<bigint> {
  const [deposit, balance] = await Promise.all([
    chain.client.readContract({ address: chain.config.entryPoint, abi: entryPointAbi, functionName: "balanceOf", args: [account] }),
    chain.client.getBalance({ address: account }),
  ]);
  return deposit + balance;
}
